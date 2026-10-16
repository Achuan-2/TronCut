import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(
  "test-output/recording-object-ui",
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
const file = path.join(root, "screen.mp4");
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
  file,
]);
const asset = await probeMedia(file);
asset.cursor = {
  samples: [
    { time: 1, x: 0.2, y: 0.5, visible: true, click: true },
    { time: 2, x: 0.2, y: 0.5, visible: true, click: false },
    { time: 3, x: 0.8, y: 0.5, visible: true, click: true },
  ],
};
const project = createProject("录屏对象验收");
project.canvas = { width: 320, height: 180, fps: 10, background: "#000000" };
const bg = await new RecordingStyleStore(root).background(320, 180, "violet");
const grouped = addRecordedAssets(
  project,
  [{ asset, kind: "screen" }],
  { ...defaultRecordingSettings, preset: "violet" },
  0,
  bg,
);
const originalFrames = grouped.clips[0].keyframes;
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
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("dialog", (dialog) => dialog.accept());
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await expect(
    page
      .locator(".recording-object .clip-label")
      .getByRole("img", { name: "录屏组合", exact: true }),
  ).toBeVisible();
  await page.locator(".recording-object").click({ position: { x: 30, y: 10 } });
  await expect(
    page
      .locator(
        ".inspector-selection .selection-icon.recording-object-selection",
      )
      .getByRole("img", { name: "录屏组合", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("tab", { name: "录屏", exact: true })
      .locator("svg.lucide-monitor-dot"),
  ).toBeVisible();
  await expect(page.locator(".recording-object")).toHaveCSS(
    "background-color",
    "rgb(41, 63, 77)",
  );
  await page.screenshot({ path: path.join(root, "recording-object-icon.png") });
  await expect(
    page.getByRole("tab", { name: "录屏", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".inspector-tabs").getByRole("tab")).toHaveText([
    "录屏",
    "画面",
  ]);
  const gap = await page.locator(".inspector-selection").evaluate((heading) => {
    const section = document.querySelector(
      "#inspector-recording .effect-section-heading",
    );
    return (
      section.getBoundingClientRect().top -
      heading.getBoundingClientRect().bottom
    );
  });
  expect(Math.abs(gap)).toBeLessThanOrEqual(1);
  for (const name of ["视频", "鼠标"]) {
    await expect(page.getByRole("tab", { name, exact: true })).toHaveCount(0);
  }
  for (const title of ["录屏样式", "圆角倒角", "鼠标样式", "自动缩放"]) {
    const collapse = page.getByRole("button", {
      name: `收起${title}属性`,
      exact: true,
    });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await collapse.click();
    const expand = page.getByRole("button", {
      name: `展开${title}属性`,
      exact: true,
    });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect(
      page
        .getByRole("region", { name: `${title}属性`, exact: true })
        .locator(".effect-section-body"),
    ).toHaveCount(0);
    await expand.click();
  }
  await page.getByRole("tab", { name: "画面", exact: true }).click();
  await expect(page.getByLabel("缩放 (%)", { exact: true })).toBeVisible();
  await expect(page.getByLabel("录屏对象背景", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "录屏", exact: true }).click();
  const background = page.getByLabel("录屏对象背景", { exact: true });
  await expect(background).toHaveValue("violet");
  await expect(page.getByLabel("背景图库")).toHaveCount(0);
  await background.selectOption("perspective-grid");
  await expect(
    page.getByAltText("透视网格（黑）", { exact: true }),
  ).toBeVisible();
  await background.selectOption("mint");
  await expect(
    page.locator(".recording-background-swatch > div"),
  ).toBeVisible();
  await page.getByLabel("录屏对象留白", { exact: true }).fill("12");
  await page.getByLabel("圆角 (%)", { exact: true }).fill("30");
  await page
    .getByLabel("录屏对象鼠标样式", { exact: true })
    .selectOption("windows11");
  await page.getByLabel("录屏对象鼠标大小", { exact: true }).fill("56");
  const recovery = async () =>
    (await page.evaluate(() => window.framecraft.readRecovery())).project;
  await expect
    .poll(
      async () =>
        (await recovery()).clips.find((clip) => clip.recording)?.cursorStyle
          .size,
    )
    .toBe(56);
  let changed = await recovery();
  const screen = changed.clips.find((clip) => clip.recording);
  expect(screen).toMatchObject({
    mediaFrame: { radius: 30, unit: "percent" },
    cursorStyle: { style: "windows11", size: 56 },
    recording: { padding: 0.12 },
  });
  expect(screen.keyframes.map((frame) => frame.value.contentScale)).toEqual(
    originalFrames.map((frame) => frame.value.contentScale),
  );
  await background.selectOption("none");
  await expect(page.locator(".recording-background-swatch")).toHaveCount(0);
  await background.selectOption("perspective-grid");
  await expect(
    page.getByAltText("透视网格（黑）", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "取消组合", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: path.join(root, "recording-properties.png") });
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, root);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("工程已保存", {
    timeout: 20000,
  });
  const archive = path.join(root, project.name, `${project.name}.troncut`);
  const disk = JSON.parse(await fs.readFile(archive, "utf8"));
  expect(disk.clips.find((clip) => clip.recording).recording.preset).toBe(
    "perspective-grid",
  );
  await page.getByRole("button", { name: "取消组合", exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await expect(
    page.getByRole("img", { name: "录屏组合", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".timeline-clip.video")).toHaveCSS(
    "background-color",
    "rgb(53, 74, 61)",
  );
  await expect(
    page.getByRole("tab", { name: "录屏", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "视频", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "鼠标", exact: true }),
  ).toBeVisible();
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".recording-object")).toHaveCount(1);
  await expect(
    page
      .locator(".recording-object .clip-label")
      .getByRole("img", { name: "录屏组合", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page
    .locator(".recent-project")
    .filter({ hasText: project.name })
    .click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page.locator(".recording-object").click({ position: { x: 30, y: 10 } });
  await expect(background).toHaveValue("perspective-grid");
  await expect(page.getByLabel("圆角 (%)", { exact: true })).toHaveValue("30");
  await expect(
    page.getByLabel("录屏对象鼠标大小", { exact: true }),
  ).toHaveValue("56");
  expect(errors).toEqual([]);
  console.log(
    `录屏对象、背景下拉框、录后样式编辑、取消组合、撤销和保存重开通过：${root}`,
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
