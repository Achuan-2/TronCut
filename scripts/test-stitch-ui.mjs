import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/stitch-ui/run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const source = path.join(root, "source.mp4");
await promisify(execFile)(
  path.resolve(
    "resources/bin",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  ),
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=160x90:r=30:d=6",
    "-vf",
    "drawbox=c=lime:t=fill:enable='between(t,2,3.99)',drawbox=c=blue:t=fill:enable='gte(t,4)'",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    source,
  ],
  { windowsHide: true },
);
const bundled = await build({
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
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const project = createProject("片段拼接测试");
project.assets = [
  {
    id: "source",
    name: "源视频",
    path: source,
    kind: "video",
    duration: 6,
    width: 160,
    height: 90,
    hasAudio: false,
  },
];
project.clips = [0, 2, 4].map((sourceIn, index) => ({
  ...newText("video", index),
  kind: "video",
  id: `part-${index}`,
  assetId: "source",
  sourceIn,
  duration: 1,
}));
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
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  const clips = page.locator(".timeline-clip");
  const command = (name) =>
    app.evaluate(({ BrowserWindow }, name) => {
      BrowserWindow.getAllWindows()[0].webContents.send("shortcut", name);
    }, name);
  const seek = async (time) => {
    const pane = await page.locator(".timeline-scroll").boundingBox();
    const ruler = await page.locator(".ruler").boundingBox();
    // The top of the ruler now contains draggable range handles.
    await page.mouse.click(pane.x + time * 65, ruler.y + 29);
    await expect
      .poll(async () => Number(await page.getByLabel("播放进度").inputValue()))
      .toBeCloseTo(time, 1);
  };
  const openMenu = async () => {
    await clips.first().click({ button: "right", position: { x: 20, y: 18 } });
  };
  await command("selectAll");
  await openMenu();
  await expect(
    page.getByRole("menuitem", { name: "拼接所选媒体", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("menuitem", { name: "拼接所选媒体", exact: true })
    .click();
  await expect(clips).toHaveCount(1);
  await expect(page.locator(".stitch-seam")).toHaveCount(2);
  await expect(clips.first()).toContainText("3 段拼接");
  // Scrubbing must jump over discarded source ranges at both internal seams.
  for (const [time, sourceTime] of [
    [0.5, 0.5],
    [1.5, 2.5],
    [2.5, 4.5],
  ]) {
    await seek(time);
    await expect
      .poll(() =>
        page
          .locator(".preview-layer video")
          .evaluate((video) => video.currentTime),
      )
      .toBeCloseTo(sourceTime, 1);
  }
  await clips.first().click({ position: { x: 20, y: 18 } });
  await page.getByLabel("缩放 (%)", { exact: true }).fill("70");
  await page.getByLabel("缩放 (%)", { exact: true }).blur();
  await seek(2.5);
  await page.getByRole("button", { name: "添加动画", exact: true }).click();
  await page.getByLabel("缩放 (%)", { exact: true }).fill("110");
  await page.getByLabel("缩放 (%)", { exact: true }).blur();
  await expect(page.locator(".timeline-clip .clip-animation")).toHaveCount(1);
  await page.screenshot({ path: path.join(root, "stitched-animation.png") });

  await page.locator(".stitch-seam").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "移除拼接", exact: true }).click();
  await expect(clips).toHaveCount(2);
  await expect(page.locator(".stitch-seam")).toHaveCount(1);
  await command("undo");
  await expect(clips).toHaveCount(1);
  await expect(page.locator(".stitch-seam")).toHaveCount(2);
  await openMenu();
  await page
    .getByRole("menuitem", { name: "移除全部拼接", exact: true })
    .click();
  await expect(clips).toHaveCount(3);
  await expect(page.locator(".stitch-seam")).toHaveCount(0);
  await command("undo");
  await expect(clips).toHaveCount(1);
  await seek(2);
  await clips.first().click({ position: { x: 20, y: 18 } });
  await page.keyboard.press("Control+k");
  await expect(clips).toHaveCount(2);
  await expect(page.locator(".stitch-seam")).toHaveCount(1);
  await command("undo");
  await expect(clips).toHaveCount(1);
  await clips.first().click({ position: { x: 20, y: 18 } });
  await page.keyboard.press("Control+Shift+Backslash");
  await expect(clips).toHaveCount(3);
  await expect(page.locator(".stitch-seam")).toHaveCount(0);
  // Re-stitch the separated pieces using the keyboard shortcut.
  await command("selectAll");
  await page.keyboard.press("Control+Alt+i");
  await expect(clips).toHaveCount(1);
  await expect(page.locator(".stitch-seam")).toHaveCount(2);
  await seek(1.5);
  await clips.first().click({ position: { x: 20, y: 18 } });
  await page.screenshot({ path: path.join(root, "stitched.png") });
  expect(errors).toEqual([]);
  console.log(
    `片段拼接 UI 验证通过：右键拼接、逐缝拆开、全部拆开、Ctrl+K、拼接快捷键、跨缝预览和整体动画。${root}`,
  );
} catch (error) {
  await app.windows()[0]?.screenshot({ path: path.join(root, "failure.png") });
  throw error;
} finally {
  await app.close();
}
