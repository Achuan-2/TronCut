import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { selectPreview } from "./preview-select.mjs";

const root = path.resolve(
  "test-output/custom-recording-background-ui",
  `run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const helper = path.join(root, "helper.cjs");
await build({
  stdin: {
    contents: `export { createProject } from "./shared/model";
    export { addRecordedAssets, defaultRecordingSettings } from "./shared/recording";
    export { RecordingStyleStore } from "./electron/recording-style";
    export { probeMedia } from "./electron/media";
    export { runProcess, findBinary } from "./electron/process";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  outfile: helper,
});
const {
  createProject,
  addRecordedAssets,
  defaultRecordingSettings,
  RecordingStyleStore,
  probeMedia,
  runProcess,
  findBinary,
} = createRequire(import.meta.url)(helper);
const video = path.join(root, "自定义视频.mp4");
const image = path.join(root, "自定义图片.png");
await sharp({
  create: { width: 300, height: 400, channels: 3, background: "#78b9ee" },
})
  .png()
  .toFile(image);
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=320x180:r=15:d=2",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  video,
]);
const project = createProject("自定义背景验收");
project.canvas = { width: 320, height: 180, fps: 15, background: "#000000" };
const backdrop = await new RecordingStyleStore(profile).background(
  320,
  180,
  "dark",
);
const grouped = addRecordedAssets(
  project,
  [{ asset: await probeMedia(video), kind: "screen" }],
  { ...defaultRecordingSettings, preset: "dark", autoZoom: false },
  0,
  backdrop,
);
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project: grouped, file: null }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app = await electron.launch({ args: ["."], env });
const errors = [];
try {
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await page.locator(".recording-object").click({ position: { x: 30, y: 10 } });
  await selectPreview(page, "录屏对象背景", "blue");
  await expect(page.locator(".recording-background-swatch > div")).toHaveCSS(
    "background-image",
    "linear-gradient(135deg, rgb(161, 196, 253), rgb(194, 233, 251))",
  );
  await page.screenshot({ path: path.join(root, "blue.png") });
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page.getByRole("button", { name: "自定义背景", exact: true }).click();
  await expect(
    page.getByLabel("录屏对象背景", { exact: true }),
  ).toHaveAttribute("data-value", "blue");
  for (const file of [image, video]) {
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, file);
    await page.getByRole("button", { name: "自定义背景", exact: true }).click();
    await expect(
      page.getByLabel("录屏对象背景", { exact: true }),
    ).toHaveAttribute("data-value", "custom");
    const isVideo = file === video;
    const preview = page.locator(
      `.recording-background-swatch > ${isVideo ? "video" : "img"}`,
    );
    await expect(preview).toBeVisible();
    await expect
      .poll(() =>
        preview.evaluate((node) =>
          node.tagName === "VIDEO"
            ? node.readyState >= 2 &&
              !node.paused &&
              node.loop &&
              node.muted &&
              node.currentTime > 0.1
            : node.complete && node.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const remembered = await page.evaluate(() =>
      window.framecraft.recordingSettings(),
    );
    expect(remembered.preset).toBe("custom");
    expect(remembered.customBackground.name).toBe(path.basename(file));
    expect(remembered.customBackground.path).not.toBe(file);
    expect(await fs.readFile(remembered.customBackground.path)).toEqual(
      await fs.readFile(file),
    );
    await page.screenshot({
      path: path.join(root, isVideo ? "custom-video.png" : "custom-image.png"),
    });
    await selectPreview(page, "录屏对象背景", "dark");
    await selectPreview(page, "录屏对象背景", "custom");
    await expect(preview).toBeVisible();
  }
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => window.framecraft.readRecovery())
        )?.project.clips.find((clip) => clip.recording)?.recording?.preset,
    )
    .toBe("custom");
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, root);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("工程已保存");
  await app.close();
  app = await electron.launch({ args: ["."], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  // Open a fresh recording first: remembered media must work before recovery registers project assets.
  await page.getByRole("button", { name: "新建录制", exact: true }).click();
  await expect(page.getByLabel("录屏背景", { exact: true })).toHaveAttribute(
    "data-value",
    "custom",
  );
  await expect
    .poll(() =>
      page
        .locator(".recording-style-preview > video")
        .evaluate((node) => node.readyState >= 2 && node.currentTime > 0.1),
    )
    .toBe(true);
  await page.screenshot({ path: path.join(root, "remembered-recorder.png") });
  await page.getByRole("button", { name: "关闭录制设置", exact: true }).click();
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page
    .locator(".recent-project")
    .filter({ hasText: project.name })
    .click();
  await page.locator(".recording-object").click({ position: { x: 30, y: 10 } });
  await expect(
    page.getByLabel("录屏对象背景", { exact: true }),
  ).toHaveAttribute("data-value", "custom");
  await expect
    .poll(() =>
      page
        .locator(".recording-background-swatch > video")
        .evaluate((node) => node.readyState >= 2),
    )
    .toBe(true);
  expect(errors).toEqual([]);
  console.log(
    `蓝色渐变、自定义图片/视频、取消选择、切换恢复和重启记忆通过：${root}`,
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close().catch(() => {});
}
