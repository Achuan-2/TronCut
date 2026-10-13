import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const file = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !(await fs.stat(file)).isFile())
  throw new Error("请传入实际的 .tscproj 文件路径");
const evidence = JSON.parse(
  await fs.readFile("test-output/camtasia-import/latest.json", "utf8"),
);
if (evidence.originalFile !== file)
  throw new Error("请先执行该工程的结构导入测试");
const root = evidence.root;
const before = createHash("sha256")
  .update(await fs.readFile(file))
  .digest("hex");
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "desktop-profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: path.resolve("release/win-unpacked/TronCut.exe"),
  args: [],
  env,
  timeout: 30000,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByText("画布预览", { exact: true })).toBeVisible();
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await page.getByRole("button", { name: "工程", exact: true }).click();
  await page
    .locator(".project-menu")
    .getByRole("button", { name: "导入 Camtasia 工程", exact: true })
    .click();
  await expect(page.locator(".report-modal")).toBeVisible({ timeout: 30000 });
  const report = await page.locator(".report-lines p").allTextContents();
  await page.screenshot({ path: path.join(root, "desktop-import-report.png") });
  await page.getByRole("button", { name: "进入编辑器", exact: true }).click();
  await expect(page.locator(".timeline-clip.audio")).toHaveCount(1);
  await expect(page.locator(".timeline-clip.video")).toHaveCount(0);
  await expect(page.locator(".asset-card")).toHaveCount(1);
  await expect(page.locator(".track-header")).toHaveCount(4);
  await page.screenshot({ path: path.join(root, "desktop-imported.png") });
  const original = JSON.parse(await fs.readFile(file, "utf8"));
  const recording = original.sourceBin.find((s) => /\.trec$/i.test(s.src));
  let rawTrecPreview = null;
  if (recording) {
    await app.evaluate(
      ({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      },
      path.resolve(path.dirname(file), recording.src),
    );
    rawTrecPreview = await page.evaluate(async () => {
      const [asset] = await window.framecraft.importMedia();
      const video = document.createElement("video");
      video.preload = "metadata";
      video.style.display = "none";
      const result = new Promise((resolve) => {
        const finish = (data) => {
          clearTimeout(timer);
          video.remove();
          resolve(data);
        };
        const timer = setTimeout(() => finish({ status: "timeout" }), 7000);
        video.onloadedmetadata = () =>
          finish({
            status: "metadata-loaded",
            duration: video.duration,
            width: video.videoWidth,
          });
        video.onerror = () =>
          finish({
            status: "error",
            code: video.error?.code,
            message: video.error?.message,
          });
      });
      video.src = await window.framecraft.mediaUrl(asset.id);
      document.body.append(video);
      return result;
    });
  }
  const after = createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
  const result = {
    executable: "release/win-unpacked/TronCut.exe",
    originalUnchanged: before === after,
    tracks: await page.locator(".track-header").count(),
    assets: await page.locator(".asset-card").count(),
    audioClips: await page.locator(".timeline-clip.audio").count(),
    videoClips: await page.locator(".timeline-clip.video").count(),
    report,
    rendererErrors: errors,
    rawTrecPreview,
    checkedAt: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(root, "desktop-result.json"),
    JSON.stringify(result, null, 2),
  );
  if (errors.length || before !== after)
    throw new Error("桌面运行错误或原工程发生变化");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await app.close();
}
