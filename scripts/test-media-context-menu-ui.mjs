import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(
  "test-output/media-context-menu",
  `run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const paths = await Promise.all(
  ["red", "green", "blue"].map(async (color) => {
    const file = path.join(root, `${color}.png`);
    await sharp({
      create: { width: 320, height: 180, channels: 3, background: color },
    })
      .png()
      .toFile(file);
    return file;
  }),
);
const assets = paths.slice(0, 2).map((file, index) => ({
  id: `image-${index}`,
  path: file,
  name: path.basename(file),
  kind: "image",
  width: 320,
  height: 180,
  duration: 0,
  hasAudio: false,
}));
const project = {
  format: "troncut",
  version: 1,
  id: "media-menu",
  name: "媒体菜单验收",
  canvas: { width: 1920, height: 1080, fps: 30, background: "#000000" },
  tracks: [
    { id: "video", name: "轨道1", hidden: false, locked: false, muted: false },
  ],
  markers: [],
  assets,
  clips: [],
};
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project, file: null }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const card = (id) => page.locator(`.asset-card[data-asset-id="${id}"]`);
const menu = page.getByRole("menu", { name: "媒体操作", exact: true });
const action = (name) => menu.getByRole("menuitem", { name, exact: true });
const choose = async (id, name) => {
  await card(id).click({ button: "right" });
  await action(name).click();
};
const clips = page.locator(".timeline-clip.image");
const save = async () => {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "正在处理…", exact: true }),
  ).toBeHidden();
  return JSON.parse(
    await fs.readFile(
      path.join(root, project.name, `${project.name}.troncut`),
      "utf8",
    ),
  );
};
try {
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await card("image-0").click({ button: "right" });
  await expect(menu.getByRole("menuitem")).toHaveCount(5);
  await expect(action("替换时间轴上所选的媒体")).toBeDisabled();
  await expect(action("在时间线上选择")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await page.locator(".ruler").click({ position: { x: 130, y: 15 } });
  await choose("image-0", "添加到时间轴播放头所处位置");
  await expect(clips).toHaveCount(1);
  await expect(clips.first()).toHaveClass(/selected/);
  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    },
    path.join(root, `${project.name}.troncut`),
  );
  let saved = await save();
  expect(saved.clips[0].start).toBe(2);
  const initial = saved.clips[0];
  await choose("image-1", "替换时间轴上所选的媒体");
  saved = await save();
  expect(saved.clips[0]).toEqual({
    ...initial,
    assetId: "image-1",
    name: "green.png",
  });
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  saved = await save();
  expect(saved.clips[0].assetId).toBe("image-0");
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await page.locator(".ruler").click({ position: { x: 8 * 65, y: 15 } });
  await choose("image-1", "添加到时间轴播放头所处位置");
  await expect(clips).toHaveCount(2);
  await choose("image-1", "在时间线上选择");
  await expect(page.locator(".timeline-clip.image.selected")).toHaveCount(2);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, paths[2]);
  await choose("image-1", "更新");
  await expect(
    page.locator(".asset-name").filter({ hasText: "blue.png" }),
  ).toHaveCount(1);
  saved = await save();
  const updated = saved.assets.find((asset) => asset.name === "blue.png");
  expect(updated.id).not.toBe("image-1");
  expect(saved.clips.every((clip) => clip.assetId === updated.id)).toBe(true);
  expect(saved.clips.map((clip) => clip.start)).toEqual([2, 8]);
  await expect(page.locator(".preview-layer.image img").last()).toHaveAttribute(
    "src",
    new RegExp(updated.id),
  );
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(card("image-1")).toBeVisible();
  saved = await save();
  expect(saved.clips.every((clip) => clip.assetId === "image-1")).toBe(true);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await choose(updated.id, "删除");
  await expect(clips).toHaveCount(0);
  await expect(card(updated.id)).toHaveCount(0);
  await fs.access(paths[2]);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(clips).toHaveCount(2);
  await expect(card(updated.id)).toBeVisible();
  saved = await save();
  expect(saved.clips.every((clip) => clip.assetId === updated.id)).toBe(true);
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await card(updated.id).click({ button: "right" });
  await expect(menu).toBeVisible();
  await page.screenshot({ path: path.join(root, "media-context-menu.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page
    .locator(".recent-project")
    .filter({ hasText: project.name })
    .click();
  await expect(clips).toHaveCount(2);
  await expect(card(updated.id)).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "五项菜单、禁用状态、播放头添加、仅替换所选、更新全部引用、删除保留原文件、撤销重做、列表视图、保存重开",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app.close();
}
