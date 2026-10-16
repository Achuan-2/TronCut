import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve("test-output/recording-zoom-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
// Exercise the actual recording importer with a deterministic cursor trace.
const helpers = path.join(root, "helpers.cjs");
await build({
  stdin: {
    contents: `export { createProject } from "./shared/model";
      export { addRecordedAssets, defaultRecordingSettings } from "./shared/recording";
      export { probeMedia } from "./electron/media";
      export { findBinary, runProcess } from "./electron/process";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  outfile: helpers,
});
const {
  createProject,
  addRecordedAssets,
  defaultRecordingSettings,
  probeMedia,
  findBinary,
  runProcess,
} = createRequire(import.meta.url)(helpers);
const source = path.join(root, "screen.mp4");
await runProcess(findBinary("ffmpeg"), [
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=s=320x180:r=10:d=8",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  source,
]);
const asset = await probeMedia(source);
asset.cursor = {
  samples: [{ time: 2, x: 0.7, y: 0.5, click: true, visible: true }],
};
const project = addRecordedAssets(
  createProject("录屏缩放编辑验收"),
  [{ asset, kind: "screen" }],
  { ...defaultRecordingSettings, background: false, zoom: 2 },
  0,
);
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
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  const video = page.locator(".timeline-clip.video");
  const arrows = video.locator(".clip-animation");
  const zoom = page.getByLabel("缩放 (%)", { exact: true });
  const pan = page.getByLabel("内容位置 X (%)", { exact: true });
  const cropMode = page.getByRole("button", { name: "裁剪模式", exact: true });
  const arrowCount = await arrows.count();
  expect(arrowCount).toBe(2);
  await video.click();
  for (const name of ["编辑缩放与移动", "根据鼠标重新生成缩放", "移除自动缩放"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await expect(page.getByText("自动缩放", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("选中时间线上的动画起点或终点", { exact: false }),
  ).toHaveCount(0);
  await arrows.first().locator(".animation-point.end").click();
  await expect(cropMode).toHaveAttribute("aria-pressed", "true");
  const originalZoom = await zoom.inputValue();
  const originalPan = await pan.inputValue();
  expect(Number(originalZoom)).toBeGreaterThan(140);
  const layer = page.locator(".preview-panel .preview-layer.video");
  const bounds = await layer.boundingBox();
  await zoom.fill("250");
  await pan.fill("-30");
  const changed = await layer.boundingBox();
  for (const key of ["x", "y", "width", "height"])
    expect(changed[key]).toBeCloseTo(bounds[key], 0);
  await expect(arrows).toHaveCount(arrowCount);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(pan).toHaveValue(originalPan);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(pan).toHaveValue("-30");
  await arrows.first().locator(".animation-point.start").click({ force: true });
  await expect(zoom).toHaveValue("100");
  await arrows.last().locator(".animation-point.end").click();
  await expect(zoom).toHaveValue("100");
  // Retiming uses the same editable arrows as manually created animations.
  const endpoint = arrows.first().locator(".animation-point.end");
  const point = await endpoint.boundingBox();
  const originalEnd = Number(await arrows.first().getAttribute("data-end"));
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    point.x + point.width / 2 + 13,
    point.y + point.height / 2,
    { steps: 4 },
  );
  await page.mouse.up();
  expect(Number(await arrows.first().getAttribute("data-end"))).toBeGreaterThan(
    originalEnd,
  );
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, root);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("工程已保存", {
    timeout: 20000,
  });
  const saved = JSON.parse(
    await fs.readFile(
      path.join(root, project.name, `${project.name}.troncut`),
      "utf8",
    ),
  );
  const zoomEnd = saved.clips[0].keyframes.find(
    (frame) => frame.value.contentScale === 2.5,
  );
  expect(zoomEnd.value.contentScale).toBe(2.5);
  expect(zoomEnd.value.contentX).toBe(-0.3);
  expect(
    saved.clips[0].keyframes.every((frame) => frame.value.scale === 1),
  ).toBe(true);
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page
    .locator(".recent-project")
    .filter({ hasText: project.name })
    .click();
  await arrows.first().locator(".animation-point.end").click();
  await expect(cropMode).toHaveAttribute("aria-pressed", "true");
  await expect(zoom).toHaveValue("250");
  await expect(pan).toHaveValue("-30");
  await page.screenshot({
    path: path.join(root, "editable-recording-zoom.png"),
  });
  expect(errors).toEqual([]);
  console.log(
    `录屏自动缩放端点编辑、固定外框、撤销重做、时间调整及保存重开通过：${root}`,
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
