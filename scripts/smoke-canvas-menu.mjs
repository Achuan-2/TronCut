import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const timelineMode = process.argv.includes("--timeline");
const surface = timelineMode ? "时间轴" : "画布";
const root = path.resolve(
  `test-output/${timelineMode ? "timeline" : "canvas"}-menu-ui/run-${Date.now()}`,
);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export { createProject, newText, validateProject } from "./shared/model";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, validateProject } = await import(
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
if (timelineMode) sameTrack.caption = true;
const locked = newText("audio", 0, 0, "锁定对象");
locked.transform.y = 0.85;
locked.textBox = { width: 600, height: 140 };
project.tracks.find((track) => track.id === "audio").locked = true;
project.clips = [source, target, sameTrack, locked];
validateProject(project);
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
  const canvasLayer = (id) =>
    page.locator(`.canvas-holder .preview-layer[data-clip-id="${id}"]`);
  const layer = (id) =>
    timelineMode
      ? page.locator(`.timeline-clip[data-clip-id="${id}"]`)
      : canvasLayer(id);
  const menu = page.getByRole("menu", {
    name: `${surface}对象操作`,
    exact: true,
  });
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
    ...(timelineMode ? ["组合", "取消组合"] : ["排列"]),
  ])
    await expect(action(name)).toBeVisible();
  await expect(action("粘贴属性")).toBeDisabled();
  if (!timelineMode) {
    await expect(action("对齐")).toBeDisabled();
    await action("排列").hover();
    for (const name of ["置于顶层", "上移一层", "下移一层", "置于底层"])
      await expect(action(name)).toBeVisible();
  } else {
    await expect(action("组合")).toBeDisabled();
    await expect(action("取消组合")).toBeDisabled();
    await expect(action("波纹删除")).toBeVisible();
    const labels = await menu.locator(":scope > button").allTextContents();
    assert.equal(
      labels.findIndex((text) => text.startsWith("波纹删除")),
      labels.findIndex((text) => text.startsWith("删除")) + 1,
    );
  }
  await page.screenshot({ path: path.join(root, "menu.png") });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  // Locked objects still expose copy, while all mutations are unavailable.
  await open(locked.id);
  for (const name of [
    "剪切",
    "拷贝",
    "删除",
    "自适应缩放",
    ...(timelineMode ? ["组合", "取消组合"] : ["排列", "对齐"]),
  ])
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
  if (!timelineMode) {
    const copy = saved.clips.find((clip) => clip.text === source.text && clip.id !== source.id);
    assert.equal(copy.start, source.start);
    assert.equal(copy.trackId, saved.tracks[0].id);
    assert.deepEqual(copy.keyframes, source.keyframes);
  }
  await undo();
  await expect(page.locator(".timeline-clip")).toHaveCount(4);

  for (const name of [
    "拷贝",
    "删除",
    ...(timelineMode ? ["波纹删除"] : []),
    "剪切",
  ]) {
    await open();
    await action(name).click();
    await expect(page.locator(".timeline-clip")).toHaveCount(
      name === "拷贝" ? 5 : 3,
    );
    saved = await save();
    if (name === "拷贝")
      assert(
        saved.clips.some(
          (clip) =>
            clip.id !== source.id &&
            clip.text === source.text &&
            clip.duration === source.duration &&
            (timelineMode ? clip.start >= source.duration : clip.start === source.start),
        ),
      );
    else assert(!saved.clips.some((clip) => clip.id === source.id));
    await undo();
    await expect(page.locator(".timeline-clip")).toHaveCount(4);
  }

  if (!timelineMode) {
    // Native shortcuts must use the same placement as the canvas context menu.
    for (const shortcut of ["Control+d", "Control+c"]) {
      await open();
      await page.keyboard.press("Escape");
      await page.keyboard.press(shortcut);
      if (shortcut === "Control+c") await page.keyboard.press("Control+v");
      await expect(page.locator(".timeline-clip")).toHaveCount(5);
      saved = await save();
      const copy = saved.clips.find((clip) => clip.text === source.text && clip.id !== source.id);
      assert.equal(copy.start, source.start);
      assert.equal(copy.trackId, saved.tracks[0].id);
      await undo();
      await expect(page.locator(".timeline-clip")).toHaveCount(4);
    }
    // Free the top track's first interval; its later clip must stay in place.
    await open();
    await action("删除").click();
    await expect(page.locator(".timeline-clip")).toHaveCount(3);
    await open(target.id);
    await action("拷贝").click();
    saved = await save();
    const copy = saved.clips.find((clip) => clip.text === target.text && clip.id !== target.id);
    assert.equal(saved.tracks.length, project.tracks.length);
    assert.equal(copy.trackId, saved.tracks[0].id);
    assert.equal(copy.start, target.start);
    assert.equal(saved.clips.find((clip) => clip.id === sameTrack.id).start, sameTrack.start);
    await undo();
    await undo();
    await expect(page.locator(".timeline-clip")).toHaveCount(4);
  }

  if (!timelineMode) {
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
  }

  if (!timelineMode) {
    const bounds = async () =>
      Promise.all([
        canvasLayer(source.id).boundingBox(),
        canvasLayer(target.id).boundingBox(),
      ]);
    const edge = (box, alignment) =>
      ({
        left: box.x,
        center: box.x + box.width / 2,
        right: box.x + box.width,
        top: box.y,
        middle: box.y + box.height / 2,
        bottom: box.y + box.height,
      })[alignment];
    for (const [alignment, label] of [
      ["left", "左对齐"],
      ["center", "水平居中"],
      ["right", "右对齐"],
      ["top", "顶端对齐"],
      ["middle", "垂直居中"],
      ["bottom", "底端对齐"],
    ]) {
      await layer(source.id).click();
      await layer(target.id).click({ modifiers: ["Shift"] });
      const before = await bounds();
      await open();
      await expect(action("对齐")).toBeEnabled();
      await action("对齐").hover();
      const alignmentMenu = page.getByRole("menu", {
        name: "对齐",
        exact: true,
      });
      await expect(alignmentMenu).toBeVisible();
      if (alignment === "left") {
        await action("对齐").focus();
        await page.keyboard.press("ArrowRight");
        await expect(action("左对齐")).toBeFocused();
        await page.keyboard.press("ArrowLeft");
        await expect(action("对齐")).toBeFocused();
        await page.keyboard.press("ArrowRight");
        await page.screenshot({ path: path.join(root, "alignment-menu.png") });
      }
      await action(label).click();
      await expect(menu).toHaveCount(0);
      await expect
        .poll(async () => {
          const boxes = await bounds();
          return Math.abs(
            edge(boxes[0], alignment) - edge(boxes[1], alignment),
          );
        })
        .toBeLessThan(1);
      const after = await bounds();
      const horizontal = ["left", "center", "right"].includes(alignment);
      for (const index of [0, 1])
        assert(
          Math.abs(
            edge(after[index], horizontal ? "middle" : "center") -
              edge(before[index], horizontal ? "middle" : "center"),
          ) < 1,
        );
      saved = await save();
      assert.deepEqual(
        saved.clips.find((clip) => clip.id === locked.id).transform,
        locked.transform,
      );
      assert.deepEqual(
        saved.clips.find((clip) => clip.id === sameTrack.id).transform,
        sameTrack.transform,
      );
      await undo();
      await expect
        .poll(async () => {
          const boxes = await bounds();
          return Math.max(
            ...boxes.map(
              (box, index) =>
                Math.abs(box.x - before[index].x) +
                Math.abs(box.y - before[index].y),
            ),
          );
        })
        .toBeLessThan(1);
      await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
      await expect
        .poll(async () => {
          const boxes = await bounds();
          return Math.abs(
            edge(boxes[0], alignment) - edge(boxes[1], alignment),
          );
        })
        .toBeLessThan(1);
      await undo();
    }
    // The blank canvas also retains the selected objects for context actions.
    await layer(source.id).click();
    await layer(target.id).click({ modifiers: ["Shift"] });
    await page
      .locator(".canvas-holder .canvas")
      .click({ button: "right", position: { x: 5, y: 5 } });
    await expect(page.locator(".timeline-clip.selected")).toHaveCount(2);
    await expect(action("对齐")).toBeEnabled();
    await page.keyboard.press("Escape");
  }

  // Right click preserves a multi-selection, and one undo restores all objects.
  await layer(source.id).click();
  await layer(target.id).click({ modifiers: ["Shift"] });
  await open();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(2);
  await action("删除").click();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await undo();
  await expect(page.locator(".timeline-clip")).toHaveCount(4);

  if (timelineMode) {
    await layer(source.id).click();
    await layer(target.id).click({ modifiers: ["Shift"] });
    await open();
    await expect(action("组合")).toBeEnabled();
    await action("组合").click();
    saved = await save();
    const grouped = saved.clips.filter((clip) =>
      [source.id, target.id].includes(clip.id),
    );
    assert(grouped[0].groupId && grouped[0].groupId === grouped[1].groupId);
    await open();
    await expect(action("组合")).toBeDisabled();
    await expect(action("取消组合")).toBeEnabled();
    await action("取消组合").click();
    saved = await save();
    assert(saved.clips.every((clip) => !clip.groupId));
    await undo();
    await open();
    await expect(action("取消组合")).toBeEnabled();
    await page.keyboard.press("Escape");
    await undo();
  }

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

  if (timelineMode) {
    // Attributes travel in both directions between the two surfaces.
    await canvasLayer(source.id).click({ button: "right" });
    await page.getByRole("menuitem", { name: "复制属性", exact: true }).click();
    await open(target.id);
    await action("粘贴属性").click();
    saved = await save();
    assert.equal(
      saved.clips.find((clip) => clip.id === target.id).style.color,
      source.style.color,
    );
    await undo();
    await open();
    await action("复制属性").click();
    await canvasLayer(target.id).click({ button: "right" });
    await page.getByRole("menuitem", { name: "粘贴属性", exact: true }).click();
    saved = await save();
    assert.equal(
      saved.clips.find((clip) => clip.id === target.id).style.color,
      source.style.color,
    );
    await undo();
  }

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
  if (!timelineMode) {
    await page.keyboard.press("ArrowRight");
    await expect(
      menu.getByRole("menu", { name: "排列", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(action("排列")).toBeFocused();
  } else {
    await expect(
      menu.getByRole("button", { name: /^在播放头拆分/ }),
    ).not.toBeFocused();
    await page.keyboard.press("Home");
    await expect(action("剪切")).toBeFocused();
  }
  await page.keyboard.press("Escape");
  await open();
  await page.locator(".canvas-toolbar").click({ position: { x: 3, y: 3 } });
  await expect(menu).toHaveCount(0);
  if (timelineMode) {
    await open(sameTrack.id);
    for (const name of [
      "剪切",
      "复制",
      "粘贴",
      "拷贝",
      "删除",
      "复制属性",
      "粘贴属性",
      "自适应缩放",
      "组合",
      "取消组合",
    ])
      await expect(action(name)).toBeVisible();
    for (const name of [
      "编辑字幕文本",
      "与上一字幕合并",
      "拆分字幕",
      "清除字幕文本",
      "转换为普通文本",
    ])
      await expect(
        menu.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    await menu
      .getByRole("button", { name: "清除字幕文本", exact: true })
      .click();
    saved = await save();
    assert.equal(saved.clips.find((clip) => clip.id === sameTrack.id).text, "");
    await undo();
    saved = await save();
    assert.equal(
      saved.clips.find((clip) => clip.id === sameTrack.id).text,
      sameTrack.text,
    );
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ root, errors }, null, 2),
  );
  console.log(
    `${surface}右键菜单、剪贴板、拷贝、属性、自适应、${timelineMode ? "组合、跨区域属性" : "六向对齐、排列"}、多选、锁定、撤销和保存验证通过：${root}`,
  );
} finally {
  await app.close();
}
