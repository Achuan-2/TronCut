import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimelineZoom, timelineZoom } from "./timeline-zoom.mjs";

const root = path.resolve(`test-output/auto-stitch-ui/run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: { projectDirectory: path.join(root, "projects") },
  }),
);
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
    "testsrc2=s=160x90:r=30:d=10",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    source,
  ],
  { windowsHide: true },
);
const bundle = await build({
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
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = createProject("范围删除自动拼接");
project.assets = [
  {
    id: "source",
    name: "源视频",
    path: source,
    kind: "video",
    duration: 10,
    width: 160,
    height: 90,
    hasAudio: false,
  },
];
project.clips = [
  {
    ...newText("video", 0),
    id: "video",
    kind: "video",
    assetId: "source",
    duration: 10,
  },
];
const projectFile = path.join(root, "project.troncut");
await fs.writeFile(projectFile, JSON.stringify(project));
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project, file: projectFile }),
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
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 950),
  );
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await setTimelineZoom(page, 60);
  const clips = page.locator(".timeline-clip");
  const seam = page.locator(".stitch-seam");
  const command = (name) =>
    app.evaluate(({ BrowserWindow }, name) => {
      BrowserWindow.getAllWindows()[0].webContents.send("shortcut", name);
    }, name);
  const seek = async (time) => {
    await page.getByLabel("播放进度", { exact: true }).fill(String(time));
    await expect
      .poll(async () =>
        Number(await page.getByLabel("播放进度", { exact: true }).inputValue()),
      )
      .toBeCloseTo(time, 2);
  };
  const selectRange = async (start, end) => {
    await seek(start);
    const handle = page.getByRole("slider", { name: "范围终点", exact: true });
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + (end - start) * (await timelineZoom(page)),
      box.y + 5,
      { steps: 12 },
    );
    await page.mouse.up();
    await expect(page.locator(".timeline-range-overlay")).toHaveAttribute(
      "data-start",
      String(start),
    );
    await expect(page.locator(".timeline-range-overlay")).toHaveAttribute(
      "data-end",
      String(end),
    );
  };
  const preferences = async () => {
    await command("preferences");
    return page.getByRole("dialog", { name: "首选项", exact: true });
  };
  let dialog = await preferences();
  await expect(
    dialog.getByRole("checkbox", { name: "自动拼接", exact: true }),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await selectRange(2, 4);
  await page.keyboard.press("Shift+Delete");
  await expect(clips).toHaveCount(2);
  await expect(seam).toHaveCount(0);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(clips).toHaveCount(1);

  dialog = await preferences();
  await dialog.getByRole("checkbox", { name: "自动拼接", exact: true }).check();
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    JSON.parse(
      await fs.readFile(path.join(profile, "preferences.json"), "utf8"),
    ).program.autoStitch,
  ).toBe(true);
  await selectRange(2, 4);
  await page.keyboard.press("Shift+Delete");
  await expect(clips).toHaveCount(1);
  await expect(seam).toHaveCount(1);
  await expect(clips).toContainText("2 段拼接");
  await expect(
    page.getByRole("slider", { name: "范围起点", exact: true }),
  ).toHaveAttribute("aria-valuenow", "2");
  for (const [time, sourceTime] of [
    [1, 1],
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
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(clips).toHaveCount(1);
  await expect(seam).toHaveCount(0);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(seam).toHaveCount(1);
  await selectRange(3, 4);
  await page.keyboard.press("Shift+Delete");
  await expect(clips).toHaveCount(1);
  await expect(seam).toHaveCount(2);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(page.locator(".project-save-state")).not.toContainText("*");
  const saved = JSON.parse(await fs.readFile(projectFile, "utf8"));
  expect(saved.clips[0].stitch).toEqual([
    { sourceIn: 0, duration: 2 },
    { sourceIn: 4, duration: 1 },
    { sourceIn: 6, duration: 4 },
  ]);
  dialog = await preferences();
  await expect(
    dialog.getByRole("checkbox", { name: "自动拼接", exact: true }),
  ).toBeChecked();
  await dialog
    .getByRole("checkbox", { name: "自动拼接", exact: true })
    .uncheck();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  dialog = await preferences();
  await expect(
    dialog.getByRole("checkbox", { name: "自动拼接", exact: true }),
  ).toBeChecked();
  await dialog
    .getByRole("checkbox", { name: "自动拼接", exact: true })
    .uncheck();
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await selectRange(1, 2);
  await page.keyboard.press("Shift+Delete");
  await expect(clips).toHaveCount(2);
  await page.screenshot({ path: path.join(root, "auto-stitch.png") });
  expect(errors).toEqual([]);
  console.log(
    `自动拼接默认关闭、保存/取消、双端标记波纹删除、源时间跳跃、连续拼接、撤销重做及关闭开关通过：${root}`,
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
