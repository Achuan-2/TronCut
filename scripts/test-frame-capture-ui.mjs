import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = path.resolve("test-output/frame-capture-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const source = path.join(root, "色块.png");
await sharp(
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><path fill="#c80000" d="M0 0H160V180H0Z"/><path fill="#00c800" d="M160 0H320V180H160Z"/></svg>',
  ),
)
  .png()
  .toFile(source);
const sound = path.join(root, "声音.wav");
await promisify(execFile)(
  path.resolve("resources/bin", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
  ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", sound],
  { windowsHide: true },
);
const base = { x: 0.5, y: 0.5, scale: 1, opacity: 1 };
const common = {
  start: 0,
  duration: 5,
  sourceIn: 0,
  speed: 1,
  volume: 1,
  podcast: false,
  transform: base,
  keyframes: [],
};
const project = {
  format: "troncut",
  version: 1,
  id: "frame-capture-ui",
  name: "截帧验证",
  canvas: { width: 320, height: 180, fps: 30, background: "#5432b2" },
  markers: [],
  tracks: ["text", "image", "audio"].map((id, i) => ({
    id,
    name: `轨道${3 - i}`,
    hidden: false,
    locked: false,
    muted: false,
  })),
  assets: [
    {
      id: "image",
      name: "色块.png",
      path: source,
      kind: "image",
      duration: 5,
      width: 320,
      height: 180,
      hasAudio: false,
    },
    {
      id: "audio",
      name: "声音.wav",
      path: sound,
      kind: "audio",
      duration: 5,
      width: 0,
      height: 0,
      hasAudio: true,
    },
  ],
  clips: [
    {
      ...common,
      id: "image",
      trackId: "image",
      assetId: "image",
      kind: "image",
      name: "色块",
      transform: { ...base, scale: 0.6 },
      keyframes: [
        {
          time: 1,
          value: { ...base, scale: 0.6, contentScale: 1, cropLeft: 0 },
        },
        {
          time: 2,
          value: { ...base, scale: 0.6, contentScale: 2, cropLeft: 0.2 },
          easing: "linear",
          animation: true,
        },
      ],
    },
    {
      ...common,
      id: "text",
      trackId: "text",
      kind: "text",
      name: "截帧文字",
      text: "当前帧",
      transform: { ...base, y: 0.15 },
      textBox: { width: 180, height: 40 },
      style: {
        fontSize: 24,
        color: "#ffffff",
        outline: "#111111",
        outlineWidth: 0,
        fontFamily: "Microsoft YaHei",
      },
    },
    {
      ...common,
      id: "audio",
      trackId: "audio",
      assetId: "audio",
      kind: "audio",
      name: "声音",
    },
  ],
};
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project, file: null }),
);
// Saving now uses the configured project directory without a directory dialog.
// Keep the regression's archived media and project in its isolated fixture.
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({ storage: { projectDirectory: root } }),
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
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  const toolbar = page.locator(".timeline-toolbar");
  await expect(
    toolbar.getByRole("button", { name: "组合", exact: true }),
  ).toHaveCount(0);
  const capture = toolbar.getByRole("button", {
    name: "截取当前帧",
    exact: true,
  });
  await expect(capture).toBeEnabled();
  for (const kind of ["image", "text", "audio"]) {
    await page.locator(`.timeline-clip.${kind}`).click();
    await expect(
      page.getByRole("tab", { name: "片段", exact: true }),
    ).toHaveCount(0);
  }
  await expect(
    page.getByRole("tab", { name: "声音", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("slider", { name: /^音量/ })).toBeVisible();
  await page.locator(".timeline-clip.image").click();
  await page.locator(".animation-point.end").click();
  await page.getByRole("button", { name: "裁剪模式", exact: true }).click();
  await expect(page.locator(".crop-handle")).toHaveCount(8);
  const tools = page.locator(".tool-rail");
  await tools.getByRole("button", { name: "行为", exact: true }).click();
  await capture.click();
  await expect(page.locator(".timeline-clip.image")).toHaveCount(2, {
    timeout: 20000,
  });
  await expect(page.locator(".track-header")).toHaveCount(4);
  await expect(page.locator(".timeline-clip.image.selected")).toContainText(
    "当前帧 2.00s.png",
  );
  await expect(page.locator(".timeline-clip.image.selected")).toHaveCSS(
    "left",
    "130px",
  );
  await expect(page.locator(".timeline-clip.image.selected")).toHaveCSS(
    "width",
    "325px",
  );
  await expect(tools.locator(".selected")).toHaveText("行为");
  await tools.getByRole("button", { name: "媒体", exact: true }).click();
  await expect(page.locator(".asset-card")).toHaveCount(3);
  await expect(page.locator(".toast")).toContainText(
    "当前帧已作为图片插入新轨道",
  );
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.framecraft.readRecovery()))?.project
          .clips.length,
    )
    .toBe(4);
  const capturedProject = (
    await page.evaluate(() => window.framecraft.readRecovery())
  ).project;
  const image = capturedProject.assets.find((asset) =>
    asset.name.startsWith("当前帧"),
  );
  expect([image.width, image.height, image.kind]).toEqual([320, 180, "image"]);
  const pixel = async (x, y) => [
    ...(await sharp(image.path)
      .extract({ left: x, top: y, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
  expect(await pixel(0, 0)).toEqual([84, 50, 178]);
  expect((await pixel(170, 90))[1]).toBeGreaterThan(185);
  expect(await pixel(65, 90)).toEqual([84, 50, 178]);
  expect(
    capturedProject.clips.find((clip) => clip.id === "image").keyframes,
  ).toEqual(project.clips[0].keyframes);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
  await expect(page.locator(".track-header")).toHaveCount(3);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(page.locator(".timeline-clip.image")).toHaveCount(2);
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
  const file = path.join(root, "截帧验证", "截帧验证.troncut");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  const archived = saved.assets.find((asset) => asset.id === image.id);
  expect(archived.path).toMatch(/^media\//);
  expect(
    (await sharp(path.join(path.dirname(file), archived.path)).metadata())
      .width,
  ).toBe(320);
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page
    .getByRole("button", { name: /截帧验证/, exact: false })
    .last()
    .click();
  await expect(page.locator(".timeline-clip.image")).toHaveCount(2);
  await page
    .locator(".timeline-clip.image")
    .filter({ hasText: "当前帧 2.00s.png" })
    .click();
  await expect(
    page.getByRole("tab", { name: "片段", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: path.join(root, "frame-capture.png") });
  expect(errors).toEqual([]);
  console.log(
    `属性标签、工具栏、实际截帧、新轨道定位、撤销重做和保存重开通过：${root}`,
  );
} catch (error) {
  const page = app.windows()[0];
  await page
    ?.screenshot({ path: path.join(root, "failure.png") })
    .catch(() => { });
  console.error(`失败截图：${path.join(root, "failure.png")}`);
  throw error;
} finally {
  await app.close().catch(() => { });
}
