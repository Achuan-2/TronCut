import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/track-menu-ui/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { appendCaptionCues } from "./shared/captions";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, appendCaptionCues } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = appendCaptionCues(createProject("轨道菜单测试"), [
  { start: 0, end: 2, text: "字幕甲" },
  { start: 2, end: 4, text: "字幕乙" },
]).project;
project.clips.push(
  newText("titles", 0, 0, "主标题甲"),
  newText("titles", 3, 0, "主标题乙"),
  newText("video", 0, 0, "其他轨内容"),
);
project.clips.find((clip) => clip.trackId === "video").transform.y = 0.3;
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
  const header = (id) => page.locator(`.track-header[data-track-id="${id}"]`);
  const openMenu = async (id = "titles") => {
    await header(id).scrollIntoViewIfNeeded();
    await header(id).click({ button: "right" });
    await expect(
      page.getByRole("menu", { name: "轨道操作", exact: true }),
    ).toBeVisible();
  };
  const action = (name) => page.getByRole("menuitem", { name, exact: true });
  const checkbox = (name) =>
    page.getByRole("menuitemcheckbox", { name, exact: true });
  const save = async () => {
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".busy-overlay")).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("工程已保存");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  await openMenu();
  for (const name of [
    "插入轨道",
    "移动轨道",
    "移除轨道",
    "移除所有空轨道",
    "重命名轨道",
    "选择轨道上的所有媒体",
  ])
    await expect(action(name)).toBeVisible();
  await page.screenshot({ path: path.join(root, "track-menu.png") });
  await action("重命名轨道").click();
  await page.getByLabel("轨道名称", { exact: true }).fill("主标题");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(header("titles").locator(".track-name")).toHaveText("主标题");
  await openMenu();
  await action("插入轨道").hover();
  await action("在上方插入").click();
  await expect(page.locator(".track-header")).toHaveCount(5);
  let order = await page
    .locator(".track-header")
    .evaluateAll((items) => items.map((item) => item.dataset.trackId));
  assert.equal(order.indexOf("titles"), 2);
  await openMenu();
  await action("插入轨道").click();
  await action("在下方插入").click();
  await expect(page.locator(".track-header")).toHaveCount(6);
  for (const [move, target] of [
    ["移到顶部", 0],
    ["下移轨道", 1],
    ["移到底部", 5],
    ["上移轨道", 4],
  ]) {
    await openMenu();
    await action("移动轨道").hover();
    await action(move).click();
    order = await page
      .locator(".track-header")
      .evaluateAll((items) => items.map((item) => item.dataset.trackId));
    assert.equal(order.indexOf("titles"), target);
    await expect(header("titles").locator(".track-name")).toHaveText("主标题");
  }
  await openMenu();
  await action("移除所有空轨道").click();
  await expect(page.locator(".track-header")).toHaveCount(3);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".track-header")).toHaveCount(6);
  await openMenu();
  await action("移除所有空轨道").click();
  await openMenu();
  await action("选择轨道上的所有媒体").click();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(2);
  assert(
    (
      await page
        .locator(".timeline-clip.selected")
        .evaluateAll((clips) =>
          clips.map((clip) => clip.parentElement.dataset.track),
        )
    ).every((id) => id === "titles"),
  );
  await openMenu();
  await checkbox("关闭轨道（隐藏）").click();
  await expect(
    page.locator(".preview-layer").filter({ hasText: "主标题甲" }),
  ).toHaveCount(0);
  await openMenu();
  await checkbox("显示轨道").click();
  await expect(
    page.locator(".preview-layer").filter({ hasText: "主标题甲" }),
  ).toBeVisible();
  await openMenu();
  await checkbox("启用独奏轨道").click();
  await expect(page.locator(".preview-layer")).toHaveCount(1);
  await expect(page.locator(".preview-layer")).toContainText("主标题甲");
  await expect(header("titles")).toHaveClass(/solo-track/);
  const saved = await save();
  assert(saved.tracks.find((track) => track.id === "titles").solo);
  assert.equal(
    saved.tracks.find((track) => track.id === "titles").name,
    "主标题",
  );
  await page.screenshot({ path: path.join(root, "solo.png") });
  await openMenu();
  await expect(checkbox("启用独奏轨道")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await checkbox("启用独奏轨道").click();
  await expect(page.locator(".preview-layer")).toHaveCount(3);
  await openMenu();
  await checkbox("锁定轨道").click();
  await openMenu();
  await expect(action("移除轨道")).toBeDisabled();
  await expect(checkbox("锁定轨道")).toHaveAttribute("aria-checked", "true");
  await checkbox("锁定轨道").click();
  await openMenu("video");
  await action("移除轨道").click();
  await expect(header("video")).toHaveCount(0);
  await expect(page.locator(".timeline-clip")).toHaveCount(4);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(header("video")).toHaveCount(1);
  await expect(page.locator(".timeline-clip")).toHaveCount(5);
  // The empty lane also opens the track menu, and Escape dismisses it.
  const lane = page.locator('.track-lane[data-track="video"]');
  await lane.click({ button: "right", position: { x: 600, y: 20 } });
  await expect(
    page.getByRole("menu", { name: "轨道操作", exact: true }),
  ).toBeVisible();
  const bounds = await page.locator(".track-context-menu").boundingBox();
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
  await page.keyboard.press("Escape");
  await expect(page.locator(".track-context-menu")).toHaveCount(0);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ root, errors }, null, 2),
  );
  console.log(
    "轨道插入、移动、移除、空轨清理、重命名、全选媒体、隐藏、独奏、锁定、保存与撤销通过",
  );
} finally {
  await app.close();
}
