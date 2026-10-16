import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/canvas-menu-ui/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents: 'export { createProject, newText } from "./shared/model";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = createProject("画布右键菜单测试");
const source = newText("titles", 0, 0, "属性来源");
source.transform = { ...source.transform, x: 0.25, y: 0.3, scale: 0.8 };
source.textBox = { width: 600, height: 160 };
source.style.color = "#ffaa44";
const target = newText("video", 0, 0, "属性目标");
target.transform = { ...target.transform, x: 0.75, y: 0.6 };
target.textBox = { width: 600, height: 160 };
const sameTrack = newText("titles", 5, 0, "同轨其他片段");
const locked = newText("audio", 0, 0, "锁定对象");
locked.transform.y = 0.85;
locked.textBox = { width: 600, height: 140 };
project.tracks.find((track) => track.id === "audio").locked = true;
project.clips = [source, target, sameTrack, locked];
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  const layer = (id) =>
    page.locator(`.canvas-holder .preview-layer[data-clip-id="${id}"]`);
  const menu = page.getByRole("menu", { name: "画布对象操作", exact: true });
  const action = (name) => menu.getByRole("menuitem", { name, exact: true });
  const open = async (id = source.id) => {
    await layer(id).click({ button: "right" });
    await expect(menu).toBeVisible();
  };
  const save = async () => {
    const before = (await fs.stat(file)).mtimeMs;
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect
      .poll(async () => (await fs.stat(file)).mtimeMs)
      .toBeGreaterThan(before);
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const undo = async () => {
    await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  };
  await open();
  for (const name of [
    "剪切",
    "复制",
    "粘贴",
    "拷贝",
    "删除",
    "复制属性",
    "粘贴属性",
    "自适应缩放",
    "排列",
  ])
    await expect(action(name)).toBeVisible();
  await expect(action("粘贴属性")).toBeDisabled();
  await action("排列").hover();
  for (const name of ["置于顶层", "上移一层", "下移一层", "置于底层"])
    await expect(action(name)).toBeVisible();
  await page.screenshot({ path: path.join(root, "menu.png") });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Locked objects still expose copy, while all mutations are unavailable.
  await open(locked.id);
  for (const name of ["剪切", "拷贝", "删除", "自适应缩放", "排列"])
    await expect(action(name)).toBeDisabled();
  await expect(action("复制")).toBeEnabled();
  await page.keyboard.press("Escape");

  await open();
  await action("复制").click();
  await open(target.id);
  await action("粘贴").click();
  await expect(page.locator(".timeline-clip")).toHaveCount(5);
  let saved = await save();
  assert.equal(
    saved.clips.filter((clip) => clip.text === source.text).length,
    2,
  );
  await undo();
  await expect(page.locator(".timeline-clip")).toHaveCount(4);

  for (const name of ["拷贝", "删除", "剪切"]) {
    await open();
    await action(name).click();
    await expect(page.locator(".timeline-clip")).toHaveCount(
      name === "拷贝" ? 5 : 3,
    );
    saved = await save();
    if (name === "拷贝")
      assert(
        saved.clips.some(
          (clip) => clip.text === source.text && clip.start === source.duration,
        ),
      );
    else assert(!saved.clips.some((clip) => clip.id === source.id));
    await undo();
    await expect(page.locator(".timeline-clip")).toHaveCount(4);
  }

  // A shared source track must retain unrelated clips and their track IDs.
  await open();
  await action("排列").hover();
  await action("置于底层").click();
  saved = await save();
  const moved = saved.clips.find((clip) => clip.id === source.id);
  assert.equal(moved.trackId, saved.tracks.at(-1).id);
  assert.equal(
    saved.clips.find((clip) => clip.id === sameTrack.id).trackId,
    sameTrack.trackId,
  );
  assert.equal(moved.start, source.start);
  await undo();

  // Right click preserves a multi-selection, and one undo restores all objects.
  await layer(source.id).click();
  await layer(target.id).click({ modifiers: ["Shift"] });
  await open();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(2);
  await action("删除").click();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await undo();
  await expect(page.locator(".timeline-clip")).toHaveCount(4);

  await open();
  await action("复制属性").click();
  await open(target.id);
  await action("粘贴属性").click();
  saved = await save();
  const pasted = saved.clips.find((clip) => clip.id === target.id);
  assert.equal(pasted.text, target.text);
  assert.equal(pasted.style.color, source.style.color);
  assert.equal(pasted.transform.x, source.transform.x);
  await undo();

  await open(target.id);
  await action("自适应缩放").click();
  saved = await save();
  const fitted = saved.clips.find((clip) => clip.id === target.id);
  assert.equal(fitted.transform.x, 0.5);
  assert.equal(fitted.transform.y, 0.5);
  assert.equal(fitted.transform.scale, 3.2);
  await undo();

  // Menus remain inside the viewport, support keyboard navigation and dismiss outside.
  await layer(target.id).dispatchEvent("contextmenu", {
    clientX: 5000,
    clientY: 5000,
    button: 2,
  });
  const bounds = await menu.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  assert(
    bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.x + bounds.width <= viewport.width &&
      bounds.y + bounds.height <= viewport.height,
  );
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowRight");
  await expect(
    menu.getByRole("menu", { name: "排列", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(action("排列")).toBeFocused();
  await page.keyboard.press("Escape");
  await open();
  await page.locator(".canvas-toolbar").click({ position: { x: 3, y: 3 } });
  await expect(menu).toHaveCount(0);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ root, errors }, null, 2),
  );
  console.log(
    `画布右键菜单、剪贴板、拷贝、属性、自适应、排列、多选、锁定、撤销和保存验证通过：${root}`,
  );
} finally {
  await app.close();
}
