import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { selectPreview } from "./preview-select.mjs";

// All media and preferences belong to this isolated demonstration project.
const root = path.resolve(`test-output/readme-screenshots-${Date.now()}`);
const profile = path.join(root, "profile");
const output = path.resolve("docs/images");
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(output, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: {
      projectDirectory: path.join(root, "projects"),
      backupDirectory: path.join(root, "backups"),
    },
  }),
);
await build({
  stdin: {
    contents: `export { createProject, newText, validateProject } from "./shared/model";
      export { appendCaptionCues } from "./shared/captions";
      export { synthesizeSpeech } from "./electron/synthesis";
      export { probeMedia } from "./electron/media";
      export { findBinary, runProcess } from "./electron/process";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  outfile: path.join(root, "runtime.mjs"),
});
const {
  createProject,
  newText,
  validateProject,
  appendCaptionCues,
  synthesizeSpeech,
  probeMedia,
  findBinary,
  runProcess,
} = await import(pathToFileURL(path.join(root, "runtime.mjs")).href);

const artwork = path.join(root, "创作背景.png");
await sharp(
  Buffer.from(`<svg width="1920" height="1080" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#11292b"/><stop offset=".55" stop-color="#163d48"/><stop offset="1" stop-color="#234e66"/></linearGradient>
  <radialGradient id="glow"><stop stop-color="#71e5bb" stop-opacity=".22"/><stop offset="1" stop-color="#71e5bb" stop-opacity="0"/></radialGradient></defs>
  <rect width="1920" height="1080" fill="url(#bg)"/><ellipse cx="350" cy="250" rx="950" ry="700" fill="url(#glow)"/>
  <g fill="none" stroke="#91e5d2" stroke-opacity=".12"><circle cx="1800" cy="1000" r="430"/><circle cx="1800" cy="1000" r="520"/><circle cx="1800" cy="1000" r="610"/></g>
  <g font-family="Microsoft YaHei" text-anchor="middle"><text x="960" y="210" font-size="46" fill="#76e5b5">TronCut</text>
  <text x="960" y="600" font-size="42" fill="#b8d9d5">录制屏幕 · 标记重点 · 自在表达</text></g>
  <g fill="#b1eedb" fill-opacity=".65" font-family="Microsoft YaHei" font-size="30" text-anchor="middle">
    <text x="650" y="790">录屏</text><text x="960" y="790">剪辑</text><text x="1270" y="790">表达</text>
  </g><g stroke="#71e5bb" stroke-opacity=".5"><path d="M790 770h28M1100 770h28"/></g>
</svg>`),
)
  .png()
  .toFile(artwork);
const movie = path.join(root, "创作演示.mp4");
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-loop",
  "1",
  "-i",
  artwork,
  "-t",
  "18",
  "-r",
  "15",
  "-c:v",
  "libx264",
  "-preset",
  "ultrafast",
  "-pix_fmt",
  "yuv420p",
  movie,
]);
const narrationText =
  "记录屏幕上的每一步操作。用文字、标注和动画，让重点更清楚。添加字幕与配音，把灵感剪成作品。";
const voice = await synthesizeSpeech(
  {
    text: narrationText,
    engine: "windows-sapi",
    voice: "auto",
    speed: 1,
    offline: true,
  },
  {
    workers: path.resolve("workers/onnx"),
    userData: profile,
    resources: path.resolve("resources"),
  },
  new AbortController().signal,
  () => {},
);
let project = createProject("把灵感剪成作品 · 功能演示");
project.tracks = [
  ["titles", "主标题"],
  ["video", "画面"],
  ["audio", "旁白"],
].map(([id, name]) => ({
  id,
  name,
  hidden: false,
  muted: false,
  locked: false,
  height: 40,
}));
const video = { ...(await probeMedia(movie)), name: "创作演示.mp4" };
const image = { ...(await probeMedia(artwork)), name: "创作背景.png" };
voice.name = "教程旁白.wav";
project.assets = [video, image, voice];
const text = (id, trackId, content, y, size, color) => {
  const clip = newText(trackId, 0, 0, content);
  return {
    ...clip,
    id,
    duration: 18,
    textBox: { width: 1500, height: size * 1.65 },
    transform: { ...clip.transform, y },
    style: {
      ...clip.style,
      fontSize: size,
      color,
      outlineWidth: 0,
      bold: size > 50,
      fillEnabled: false,
    },
  };
};
project.clips = [
  text("headline", "titles", "把灵感，剪成作品。", 0.39, 104, "#ecfff7"),
  {
    ...newText("video", 0),
    id: "screen",
    kind: "video",
    name: "创作演示",
    text: undefined,
    style: undefined,
    assetId: video.id,
    duration: 18,
    mediaFrame: { radius: 8, unit: "percent", enabled: true },
    transform: { x: 0.5, y: 0.5, scale: 0.9, opacity: 1 },
  },
  {
    ...newText("audio", 0),
    id: "narration",
    kind: "audio",
    name: "教程旁白",
    text: undefined,
    style: undefined,
    assetId: voice.id,
    duration: voice.duration,
  },
];
project = appendCaptionCues(project, [
  { start: 0, end: 4, text: "记录屏幕上的每一步操作" },
  { start: 4, end: 8.5, text: "用文字、标注和动画，让重点更清楚" },
  { start: 8.5, end: 13, text: "添加字幕与配音，把灵感剪成作品" },
  { start: 13, end: 18, text: "保存项目，下次继续编辑" },
]).project;
project.tracks = project.tracks.map((track) => ({ ...track, height: 40 }));
project.markers = [
  { id: "intro", time: 0, label: "开场" },
  { id: "highlight", time: 8.5, label: "重点说明" },
];
const file = path.join(root, "功能演示.troncut");
const writeProject = async (value) => {
  const portable = {
    ...value,
    assets: await Promise.all(
      value.assets.map(async (asset) => {
        const name = path.basename(asset.path);
        const destination = path.join(root, name);
        if (asset.path !== destination)
          await fs.copyFile(asset.path, destination);
        return { ...asset, path: name };
      }),
    ),
  };
  await fs.writeFile(file, JSON.stringify(validateProject(portable)));
};
await writeProject(project);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [];
const capture = async (name, locator) => {
  await page.mouse.move(5, 48);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  const screenshot = await (locator ?? page).screenshot();
  await sharp(screenshot)
    .resize({ width: 1600, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(path.join(output, name));
  console.log(`已截图：${name}`);
};
const tool = (name) =>
  page.locator(".tool-rail").getByRole("button", { name, exact: true }).click();
const seek = async (time) => {
  await page
    .getByLabel("播放进度", { exact: true })
    .evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, time);
};
const select = async (id) => {
  const target = page.locator(`.preview-layer[data-clip-id="${id}"]`);
  await target.click({ position: { x: 20, y: 20 } });
};
const open = async () => {
  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000),
  );
  await expect(page.locator(".timeline-clip").first()).toBeVisible();
  await seek(5);
  await expect(page.locator(".preview-layer video")).toHaveJSProperty(
    "readyState",
    4,
  );
};
try {
  await open();
  await capture("editor.png");

  await tool("标注");
  await select("headline");
  await page.locator("#inspector-text-tab").click();
  await capture("feature-text.png");

  await tool("行为");
  await page.locator("#behavior-library-media-tab").click();
  await page
    .locator(".behavior-grid")
    .getByRole("button", { name: "漂移", exact: true })
    .dblclick();
  await seek(5);
  await capture("feature-behaviors.png");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();

  await tool("动画");
  await page.locator("#animation-category-presets").click();
  await expect(page.locator("#animation-category-presets")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "自定义动画", exact: true }).click();
  await expect(
    page.locator('.timeline-clip[data-clip-id="headline"] .clip-animation'),
  ).toHaveCount(1);
  await page.locator("#inspector-video-tab").click();
  await capture("feature-animations.png");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();

  await tool("视觉效果");
  await select("screen");
  await page.locator("#inspector-video-tab").click();
  await page.locator('.visual-effect-card[data-effect="border"]').dblclick();
  await page
    .getByRole("spinbutton", { name: "圆角 (%)", exact: true })
    .fill("18");
  await page
    .getByRole("spinbutton", { name: "边框粗细", exact: true })
    .fill("14");
  await page.getByLabel("边框颜色", { exact: true }).fill("#76e5b5");
  await page
    .locator('.visual-effect-properties[aria-label="边框属性"]')
    .scrollIntoViewIfNeeded();
  await capture("feature-effects.png");

  await tool("字幕");
  await expect(page.locator(".caption-row textarea")).toHaveCount(4);
  await page.locator(".caption-row textarea").nth(1).click();
  await capture("feature-captions.png");

  await tool("旁白");
  await page.getByLabel("旁白文稿", { exact: true }).fill(narrationText);
  await page.getByRole("button", { name: "旁白更多选项", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "AI 配音设置", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "试听音色", exact: true }),
  ).toBeEnabled();
  await capture(
    "feature-narration.png",
    page.getByRole("dialog", { name: "AI 配音设置", exact: true }),
  );
  await page.getByRole("button", { name: "关闭配音设置", exact: true }).click();

  await page.getByRole("button", { name: "导出视频", exact: true }).click();
  await page.getByLabel("导出位置", { exact: true }).fill("D:\\TronCut\\作品");
  await page.getByLabel("导出文件名", { exact: true }).fill("把灵感剪成作品");
  await capture(
    "feature-export.png",
    page.getByRole("dialog", { name: "导出视频", exact: true }),
  );
  await page.getByRole("button", { name: "关闭导出设置", exact: true }).click();

  await page.getByTitle("开始录制", { exact: true }).click();
  await expect(page.getByLabel("录屏留白", { exact: true })).toBeEnabled();
  await selectPreview(page, "录屏背景", "blue");
  await page.getByLabel("录屏圆角", { exact: true }).fill("12");
  // Crop to the real beautification controls; desktop/window thumbnails stay private.
  await capture("feature-recording.png", page.locator(".recording-style"));
  await page.getByRole("button", { name: "关闭录制设置", exact: true }).click();
  expect(errors).toEqual([]);
  await fs.writeFile(
    path.join(root, "capture.json"),
    JSON.stringify({ root, output, errors }, null, 2),
  );
  console.log(`README 实际界面截图完成：${root}`);
} catch (error) {
  if (page)
    await page
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
  console.error(root);
  throw error;
} finally {
  if (app) await app.close();
}
