import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

const root = path.resolve(
  "test-output/effects-annotations-ui",
  `run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const video = path.join(root, "视频.mp4");
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
    "color=c=blue:s=320x180:r=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=6",
    "-t",
    "6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    video,
  ],
  { windowsHide: true },
);
const base = { x: 0.5, y: 0.5, scale: 1, opacity: 1 };
const clip = {
  id: "video",
  trackId: "main",
  assetId: "asset",
  kind: "video",
  name: "视频",
  start: 2,
  duration: 6,
  sourceIn: 0,
  speed: 1,
  volume: 1,
  podcast: false,
  transform: base,
  keyframes: [
    { time: 1, value: { ...base, x: 0.4 } },
    { time: 4, value: { ...base, x: 0.6 }, easing: "linear" },
  ],
};
const project = {
  format: "troncut",
  version: 1,
  id: "effects-ui",
  name: "视觉效果与标注",
  canvas: { width: 640, height: 360, fps: 30, background: "#5432b2" },
  markers: [],
  assets: [
    {
      id: "asset",
      path: video,
      name: "视频.mp4",
      kind: "video",
      duration: 6,
      width: 320,
      height: 180,
      hasAudio: true,
    },
  ],
  tracks: ["blank", "main", "locked", "empty"].map((id, i) => ({
    id,
    name: `轨道${4 - i}`,
    hidden: false,
    muted: false,
    locked: id === "locked",
  })),
  clips: [
    clip,
    {
      ...clip,
      id: "locked",
      trackId: "locked",
      name: "锁定视频",
      keyframes: [],
    },
  ],
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
const packaged = process.env.FRAMECRAFT_PACKAGED_SMOKE === "1";
const app = await electron.launch({
  ...(packaged
    ? { executablePath: path.resolve(process.env.FRAMECRAFT_PACKAGED_APP) }
    : {}),
  args: packaged ? [] : ["."],
  env,
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  const seek = async (time) => {
    await page.locator(".timeline-scroll").evaluate((element) => {
      element.scrollLeft = 0;
    });
    await page.locator(".ruler").click({ position: { x: time * 65, y: 15 } });
  };
  const drag = async (locator, dx, dy) => {
    await locator.hover();
    const bounds = await locator.boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + dx,
      bounds.y + bounds.height / 2 + dy,
      { steps: 5 },
    );
    await page.mouse.up();
  };
  await seek(3);
  await page.getByRole("button", { name: "视觉效果", exact: true }).click();
  const main = page.locator('.track-lane[data-track="main"] .timeline-clip');
  const card = page.locator('.visual-effect-card[data-effect="clip-speed"]');
  await card.dragTo(main, { targetPosition: { x: 40, y: 15 } });
  const speed = page.getByLabel("剪辑速度（倍）", { exact: true });
  const strip = page.locator(
    '.track-lane[data-track="main"] .clip-speed-effect',
  );
  await expect(speed).toHaveValue("1");
  await expect(strip).toHaveClass(/selected/);
  await speed.fill("2");
  await expect(main).toHaveCSS("width", "195px");
  await expect(main).toHaveCSS("left", "130px");
  await expect(
    page.getByLabel("剪辑持续时间（秒）", { exact: true }),
  ).toHaveValue("3");
  await expect(main.locator(".clip-animation").last()).toHaveAttribute(
    "data-start",
    "2.5",
  );
  await expect(main.locator(".clip-animation").last()).toHaveAttribute(
    "data-end",
    "4",
  );
  await page.getByLabel("剪辑持续时间（秒）", { exact: true }).fill("4");
  await expect(speed).toHaveValue("1.5");
  await page.getByLabel("剪辑持续时间（帧）", { exact: true }).fill("15");
  await expect(speed).toHaveValue("1.3333");
  await page.getByLabel("剪辑速度选项", { exact: true }).click();
  await page.getByRole("button", { name: "恢复正常速度", exact: true }).click();
  await expect(speed).toHaveValue("1");
  await main
    .getByRole("button", { name: "收起剪辑速度效果", exact: true })
    .click();
  await expect(strip).toHaveCount(0);
  await main
    .getByRole("button", { name: "展开剪辑速度效果", exact: true })
    .click();
  await drag(strip.locator(".speed-effect-handle"), -195, 0);
  await expect(speed).toHaveValue("2");
  await expect(main).toHaveCSS("width", "195px");
  const laneIndex = await page
    .locator(".track-lane")
    .evaluateAll((lanes) =>
      lanes.findIndex((lane) => lane.dataset.track === "main"),
    );
  const header = await page
    .locator(".track-header")
    .nth(laneIndex)
    .boundingBox();
  const lane = await page
    .locator('.track-lane[data-track="main"]')
    .boundingBox();
  expect(header.height).toBe(lane.height);
  expect(lane.height).toBe(98);
  await page.screenshot({ path: path.join(root, "speed-effect.png") });
  await drag(main.locator(".trim-handle.right"), -65, 0);
  await expect(main).toHaveCSS("width", "130px");
  await expect(speed).toHaveValue("2");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await page.getByLabel("剪辑速度选项", { exact: true }).click();
  await page.getByRole("button", { name: "移除剪辑速度", exact: true }).click();
  await expect(speed).toHaveCount(0);
  await expect(strip).toHaveCount(0);
  await expect(main).toHaveCSS("width", "390px");
  await main.click({ position: { x: 30, y: 15 } });
  await page
    .getByRole("button", { name: "应用到所选片段", exact: true })
    .click();
  await speed.fill("2");
  const locked = page.locator(
    '.track-lane[data-track="locked"] .timeline-clip',
  );
  await card.dragTo(locked, { targetPosition: { x: 30, y: 15 } });
  await expect(locked.locator(".clip-effects-toggle")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => window.framecraft.readRecovery())
        )?.project.clips.find((clip) => clip.id === "video")?.speed,
    )
    .toBe(2);
  const state = (await page.evaluate(() => window.framecraft.readRecovery()))
    .project;
  expect(state.clips.find((clip) => clip.id === "video")).toMatchObject({
    speed: 2,
    duration: 3,
    sourceIn: 0,
    speedEffect: true,
  });
  expect(
    state.clips.find((clip) => clip.id === "locked").speedEffect,
  ).toBeUndefined();

  // Expanded effect rows must not reintroduce cross-track flicker.
  await main.click({ position: { x: 30, y: 15 } });
  const moving = await main.boundingBox();
  const upper = await page
    .locator('.track-lane[data-track="blank"]')
    .boundingBox();
  await page.mouse.move(moving.x + 30, moving.y + 15);
  await page.mouse.down();
  await page.mouse.move(moving.x + 30, upper.y + 25, { steps: 4 });
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(moving.x + 30 + (i % 2), upper.y + 25);
    await expect(main).toHaveCSS("translate", "0px -70px");
  }
  await page.mouse.up();
  await expect(
    page.locator('.track-lane[data-track="blank"] .timeline-clip.video'),
  ).toHaveCount(1);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(main).toHaveCSS("width", "195px");

  await page.getByRole("button", { name: "标注", exact: true }).click();
  await expect(
    page
      .locator(".tool-rail")
      .getByRole("button", { name: "文本", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("标注文本样式", { exact: true }).selectOption("basic");
  const canvas = page.locator(".preview-panel .canvas"),
    box = await canvas.boundingBox();
  await page
    .getByRole("button", { name: "纯文本", exact: true })
    .dragTo(canvas, {
      targetPosition: { x: box.width * 0.25, y: box.height * 0.25 },
    });
  const text = page.locator(".preview-panel .preview-layer.text");
  await expect(text).toBeVisible();
  expect(
    Number(await page.getByLabel("位置 X (px)", { exact: true }).inputValue()),
  ).toBeCloseTo(25, 0);
  await text.dblclick();
  const input = page.getByLabel("画布文本内容", { exact: true });
  await expect(input).toBeFocused();
  await input.fill("合并后的文本标注");
  await input.press("Control+Enter");
  await expect(page.getByLabel("文本内容", { exact: true })).toHaveValue(
    "合并后的文本标注",
  );
  await page.getByRole("tab", { name: "形状标注", exact: true }).click();
  await page.getByRole("button", { name: "椭圆", exact: true }).click();
  const shape = page.locator(".preview-panel .preview-layer.shape");
  await expect(shape.locator(".resize-handle")).toHaveCount(8);
  const before = await shape.boundingBox();
  await drag(shape.locator(".resize-handle.se"), 25, 12);
  expect((await shape.boundingBox()).width).toBeGreaterThan(before.width);
  await page.getByRole("tab", { name: "箭头标注", exact: true }).click();
  const empty = page.locator('.track-lane[data-track="empty"]');
  await empty.scrollIntoViewIfNeeded();
  await page
    .getByRole("button", { name: "箭头", exact: true })
    .dragTo(empty, { targetPosition: { x: 650, y: 30 } });
  await expect(empty.locator(".timeline-clip.shape")).toHaveCSS(
    "left",
    "650px",
  );
  await seek(11);
  await expect(
    page.locator(".preview-panel .preview-layer.shape"),
  ).toBeVisible();
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
  }, root);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("项目已保存", {
    timeout: 20000,
  });
  const file = path.join(root, "视觉效果与标注", "视觉效果与标注.troncut"),
    saved = JSON.parse(await fs.readFile(file, "utf8"));
  expect(saved.clips.find((clip) => clip.id === "video")).toMatchObject({
    speed: 2,
    duration: 3,
    speedEffect: true,
  });
  expect(saved.clips.filter((clip) => clip.kind === "text")).toHaveLength(1);
  expect(saved.clips.filter((clip) => clip.kind === "shape")).toHaveLength(2);
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project").first().click();
  await main.click({ position: { x: 30, y: 15 } });
  await expect(speed).toHaveValue("2");
  await expect(main).toHaveCSS("width", "195px");
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => window.framecraft.readRecovery())
        )?.project.clips.filter((clip) => clip.kind === "shape").length,
    )
    .toBe(2);
  const reopened = (await page.evaluate(() => window.framecraft.readRecovery()))
    .project;
  const frame = await page.evaluate(
    (project) => window.framecraft.captureFrame(project, 3),
    reopened,
  );
  const pixels = await sharp(frame.path).removeAlpha().raw().toBuffer();
  let white = 0,
    green = 0;
  for (let i = 0; i < pixels.length; i += 3) {
    if (pixels[i] > 225 && pixels[i + 1] > 225 && pixels[i + 2] > 225) white++;
    if (
      pixels[i] > 90 &&
      pixels[i] < 135 &&
      pixels[i + 1] > 210 &&
      pixels[i + 2] > 160 &&
      pixels[i + 2] < 200
    )
      green++;
  }
  expect(white).toBeGreaterThan(100);
  expect(green).toBeGreaterThan(500);
  await fs.copyFile(frame.path, path.join(root, "annotations-export.png"));
  await page.getByRole("button", { name: "标注", exact: true }).click();
  await page.getByRole("tab", { name: "文字标注", exact: true }).click();
  await page.getByLabel("标注文本样式", { exact: true }).selectOption("fancy");
  await expect(page.locator(".preset-card").first()).toContainText("花字");
  await page.screenshot({ path: path.join(root, "annotations.png") });
  expect(errors).toEqual([]);
  console.log(
    `剪辑速度拖入、效果条/倍速/时长联动、复位/删除/锁定/撤销、文本形状合并与拖放/缩放、保存重开通过：${root}`,
  );
} catch (error) {
  await app
    .windows()[0]
    ?.screenshot({ path: path.join(root, "failure.png") })
    .catch(() => { });
  console.error(`失败截图：${path.join(root, "failure.png")}`);
  throw error;
} finally {
  await app.close().catch(() => { });
}
