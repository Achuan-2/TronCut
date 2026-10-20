import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import sharp from "sharp";

const root = path.resolve("test-output/frame-capture-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const modelFile = path.join(root, "model.cjs");
await build({
  entryPoints: ["shared/model.ts"],
  outfile: modelFile,
  bundle: true,
  platform: "node",
  format: "cjs",
});
const { createProject, newText } = createRequire(import.meta.url)(modelFile);
const image = path.join(root, "source.png");
await sharp({
  create: { width: 2560, height: 1440, channels: 3, background: "#76e5b5" },
})
  .png()
  .toFile(image);
const project = createProject("截帧交互测试");
project.canvas = { width: 1920, height: 1080, fps: 30, background: "#101319" };
project.assets = [
  {
    id: "source",
    path: image,
    name: "source.png",
    kind: "image",
    width: 2560,
    height: 1440,
    duration: 5,
    hasAudio: false,
  },
];
project.clips = [
  {
    ...newText(project.tracks[0].id, 0),
    kind: "image",
    assetId: "source",
    duration: 5,
  },
];
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project, file: null }),
);
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: { projectDirectory: path.join(root, "projects") },
  }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  const tools = page.locator(".tool-rail");
  await tools.getByRole("button", { name: "标注", exact: true }).click();
  // Record even brief pending states without artificially slowing the backend.
  await page.evaluate(() => {
    window.captureStates = [];
    const button = [...document.querySelectorAll("button")].find((button) =>
      button.textContent.includes("截取当前帧"),
    );
    new MutationObserver(() => {
      window.captureStates.push({
        text: button.textContent,
        disabled: button.disabled,
        busy: button.getAttribute("aria-busy"),
      });
    }).observe(button, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });
  const started = Date.now();
  await page.getByRole("button", { name: "截取当前帧", exact: true }).click();
  await expect(page.locator(".timeline-clip.image")).toHaveCount(2);
  const elapsed = Date.now() - started;
  await expect(
    page.getByRole("button", { name: "截取当前帧", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".workspace-status")).toHaveCount(0);
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(tools.locator(".selected")).toHaveText("标注");
  expect(
    (await page.evaluate(() => window.captureStates)).some(
      (state) =>
        state.text.includes("正在截取") &&
        state.disabled &&
        state.busy === "true",
    ),
  ).toBe(true);
  const frames = await fs.readdir(path.join(profile, "frames"));
  expect(frames).toHaveLength(1);
  const frame = path.join(profile, "frames", frames[0]);
  const metadata = await sharp(frame).metadata();
  expect([metadata.format, metadata.width, metadata.height]).toEqual([
    "png",
    1920,
    1080,
  ]);
  const pixel = await sharp(frame)
    .extract({ left: 960, top: 540, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect([...pixel]).toEqual([118, 229, 181]);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page.getByRole("button", { name: "截取当前帧", exact: true }).click();
  await expect(page.locator(".timeline-clip.image")).toHaveCount(2);
  expect(await fs.readdir(path.join(profile, "frames"))).toHaveLength(2);
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(root, "capture.png") });
  console.log(
    `截帧按钮反馈、原分辨率 PNG、新轨道插入、工具标签保留、撤销后再次截帧通过；首次点击到插入 ${elapsed} ms。${root}`,
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
