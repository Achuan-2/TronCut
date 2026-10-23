import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { execFileSync } from "node:child_process";

const root = path.resolve(`test-output/timeline-effect-edit-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: { projectDirectory: path.join(root, "Documents", "Projects") },
  }),
);
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#36a87a" },
})
  .png()
  .toFile(path.join(root, "image.png"));
execFileSync(
  path.resolve("resources/bin/ffmpeg.exe"),
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:duration=8",
    path.join(root, "audio.wav"),
  ],
  { windowsHide: true },
);
const bundled = await build({
  stdin: {
    contents:
      'export { createProject, newText, newTrack } from "./shared/model"; export { defaultVisualEffect } from "./shared/visual-effects";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, newTrack, defaultVisualEffect } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const project = createProject("效果编辑验收");
project.canvas = { width: 320, height: 180, fps: 10, background: "#18212c" };
project.tracks = [newTrack(0), { ...newTrack(1), locked: true }, newTrack(2)];
project.assets = [
  {
    id: "image",
    name: "image.png",
    path: "image.png",
    kind: "image",
    width: 320,
    height: 180,
    duration: 0,
    hasAudio: false,
  },
];
project.assets.push({
  id: "audio",
  name: "audio.wav",
  path: "audio.wav",
  kind: "audio",
  width: 0,
  height: 0,
  duration: 8,
  hasAudio: true,
});
const image = (id, start, duration, trackId = project.tracks[0].id) => ({
  ...newText(trackId, start),
  id,
  name: id,
  kind: "image",
  assetId: "image",
  duration,
  transform: { x: 0.5, y: 0.5, scale: 0.8, opacity: 1 },
});
project.clips = [
  {
    ...image("source", 0, 4),
    mediaFrame: { radius: 35, unit: "percent", enabled: true },
    visualEffects: {
      mask: {
        ...defaultVisualEffect("mask"),
        width: 0.42,
        height: 0.8,
        window: { start: 1, end: 3 },
      },
      shadow: defaultVisualEffect("shadow"),
    },
  },
  image("target", 4, 8),
  {
    ...image("locked", 0, 4, project.tracks[1].id),
    visualEffects: { tint: defaultVisualEffect("tint") },
  },
  {
    ...newText(project.tracks[2].id, 0),
    id: "speed-source",
    name: "speed-source",
    kind: "audio",
    assetId: "audio",
    duration: 2,
    speed: 2,
    speedEffect: true,
  },
  {
    ...newText(project.tracks[2].id, 4),
    id: "speed-target",
    name: "speed-target",
    kind: "audio",
    assetId: "audio",
    duration: 4,
  },
];
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  app = await electron.launch({ args: [".", file], env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const clip = (id) => page.locator(`.timeline-clip[data-clip-id="${id}"]`);
  const effect = (clipId, id) =>
    clip(clipId).locator(
      `.clip-visual-effect-row[data-effect="${id}"] .clip-visual-effect`,
    );
  const effectMenu = page.getByRole("menu", { name: "效果操作", exact: true });
  const objectMenu = page.getByRole("menu", {
    name: "时间轴对象操作",
    exact: true,
  });
  const command = (menu, name) =>
    menu.getByRole("menuitem", { name: new RegExp(`^${name}`) });
  const objectClick = (id, button = "left") =>
    clip(id).click({ button, position: { x: 20, y: 12 } });
  const save = async () => {
    await page.getByTitle("保存项目 Ctrl+S", { exact: true }).click();
    await expect(page.locator(".busy-overlay")).toHaveCount(0);
    await expect(page.locator(".project-save-state")).not.toContainText("*");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const savedClip = async (id) =>
    (await save()).clips.find((clip) => clip.id === id);
  await expect(effect("source", "mask")).toBeVisible();
  await effect("source", "mask").click();
  await page.keyboard.press("Delete");
  await expect(effect("source", "mask")).toHaveCount(0);
  await expect(clip("source")).toHaveCount(1);
  await expect(effect("source", "shadow")).toBeVisible();
  await page.keyboard.press("Control+z");
  await expect(effect("source", "mask")).toBeVisible();
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(effect("source", "mask")).toHaveCount(0);
  await page.keyboard.press("Control+z");

  await effect("source", "mask").click({ button: "right" });
  await command(effectMenu, "复制效果").click();
  await objectClick("target", "right");
  await command(objectMenu, "粘贴效果").click();
  await expect(effect("target", "mask")).toHaveAttribute("data-start", "2");
  await expect(effect("target", "mask")).toHaveAttribute("data-end", "6");
  expect((await savedClip("target")).visualEffects.mask.width).toBe(0.42);
  await effect("target", "mask").click({ button: "right" });
  await command(effectMenu, "移除效果").click();
  await expect(effect("target", "mask")).toHaveCount(0);
  await expect(clip("target")).toHaveCount(1);

  // Keyboard copy and cut must operate on the selected effect, never its clip.
  await effect("source", "rounded-corners").click();
  await page.keyboard.press("Control+c");
  await objectClick("target");
  await page.keyboard.press("Control+v");
  await expect(effect("target", "rounded-corners")).toBeVisible();
  expect((await savedClip("target")).mediaFrame.radius).toBe(35);
  await effect("target", "rounded-corners").click();
  await page.keyboard.press("Control+x");
  await expect(effect("target", "rounded-corners")).toHaveCount(0);
  await expect(clip("target")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(effect("target", "rounded-corners")).toBeVisible();

  await effect("locked", "tint").click({ button: "right" });
  await expect(command(effectMenu, "移除效果")).toBeDisabled();
  await expect(command(effectMenu, "复制效果")).toBeEnabled();
  await page.keyboard.press("Delete");
  await expect(effect("locked", "tint")).toBeVisible();
  await expect(clip("locked")).toHaveCount(1);
  await effect("locked", "tint").click({ button: "right" });
  await command(effectMenu, "复制效果").click();
  await objectClick("target", "right");
  await command(objectMenu, "粘贴效果").click();
  await expect(effect("target", "tint")).toBeVisible();

  // The same paste action is available on the visible canvas object.
  await effect("target", "tint").click({ button: "right" });
  await command(effectMenu, "移除效果").click();
  await page.locator(".ruler").click({ position: { x: 6 * 65, y: 12 } });
  await page
    .locator('.preview-layer[data-clip-id="target"]')
    .click({ button: "right" });
  await command(
    page.getByRole("menu", { name: "画布对象操作", exact: true }),
    "粘贴效果",
  ).click();
  await expect(effect("target", "tint")).toBeVisible();

  // Speed effects share the same selection and clipboard commands.
  const speed = (id) => clip(id).locator(".clip-speed-effect");
  await page.locator(".track-lane").last().scrollIntoViewIfNeeded();
  await speed("speed-source").click();
  await page.keyboard.press("Control+c");
  await objectClick("target", "right");
  await expect(command(objectMenu, "粘贴效果")).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.locator(".track-lane").last().scrollIntoViewIfNeeded();
  await objectClick("speed-target", "right");
  await command(objectMenu, "粘贴效果").click();
  await expect(speed("speed-target")).toBeVisible();
  expect(await savedClip("speed-target")).toMatchObject({
    speed: 2,
    duration: 2,
  });
  await speed("speed-target").click();
  await page.keyboard.press("Delete");
  await expect(speed("speed-target")).toHaveCount(0);
  expect(await savedClip("speed-target")).toMatchObject({
    speed: 1,
    duration: 4,
  });

  // Copying an object replaces the effect clipboard.
  await page.locator(".track-lane").first().scrollIntoViewIfNeeded();
  await objectClick("target");
  await page.keyboard.press("Control+c");
  await objectClick("source", "right");
  await expect(command(objectMenu, "粘贴效果")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const saved = await save();
  expect(saved.clips).toHaveLength(5);
  expect(
    saved.clips.find((clip) => clip.id === "target").visualEffects.tint,
  ).toBeTruthy();
  await page.reload();
  await page
    .getByRole("button", { name: /效果编辑验收.*project\.troncut/ })
    .click();
  await expect(effect("target", "tint")).toBeVisible();
  await expect(effect("target", "rounded-corners")).toBeVisible();
  await expect(clip("source")).toHaveCount(1);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      ok: true,
      root,
      checks: [
        "Delete preserves clip",
        "effect menu remove/copy",
        "object paste",
        "canvas paste",
        "range scaling",
        "keyboard copy/paste/cut",
        "undo/redo",
        "locked track",
        "speed copy/remove and compatibility",
        "clipboard replacement",
        "save/reopen",
      ],
    }),
  );
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: path.join(root, "failure.png") });
    await fs.writeFile(path.join(root, "failure.html"), await page.content());
  }
  throw error;
} finally {
  await app?.close();
}
