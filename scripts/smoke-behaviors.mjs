import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

const root = path.resolve(`test-output/behaviors-ui-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
await sharp({
  create: { width: 80, height: 60, channels: 3, background: "#6cb890" },
})
  .png()
  .toFile(path.join(root, "image.png"));
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-i",
    path.join(root, "image.png"),
    "-t",
    "5",
    "-r",
    "10",
    "-pix_fmt",
    "yuv420p",
    path.join(root, "video.mp4"),
  ],
  { windowsHide: true },
);
const tracks = ["text", "image", "video"].map((id, index) => ({
  id,
  name: `轨道${3 - index}`,
  hidden: false,
  muted: false,
  locked: false,
}));
const clips = ["text", "image", "video"].map((kind) => ({
  id: kind,
  trackId: kind,
  kind,
  name: kind,
  ...(kind === "text"
    ? {
      text: "ABC 文字动效",
      style: {
        fontSize: 68,
        color: "#ffffff",
        outline: "#111111",
        outlineWidth: 2,
        fontFamily: "Microsoft YaHei",
      },
    }
    : { assetId: kind }),
  start: 0,
  duration: 5,
  sourceIn: 0,
  speed: 1,
  transform: { x: 0.5, y: 0.5, scale: kind === "text" ? 1 : 0.3, opacity: 1 },
  keyframes: [],
  volume: 1,
  podcast: false,
}));
const project = {
  format: "troncut",
  version: 1,
  id: "behavior-test",
  name: "行为交互验证",
  canvas: { width: 1920, height: 1080, fps: 30, background: "#101319" },
  tracks,
  clips,
  assets: ["image", "video"].map((kind) => ({
    id: kind,
    name: kind,
    path: kind === "image" ? "image.png" : "video.mp4",
    kind,
    width: 80,
    height: 60,
    duration: kind === "image" ? 0 : 5,
    hasAudio: false,
  })),
  markers: [],
};
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env, timeout: 30000 });
const errors = [];
async function checkEffectsInsideClips(page) {
  const effects = await page
    .locator(".clip-speed-effect, .clip-behavior-effect")
    .evaluateAll((elements) =>
      elements.map((effect) => {
        const clip = effect.closest(".timeline-clip");
        if (!clip) return { contained: false };
        const bounds = effect.getBoundingClientRect(),
          parent = clip.getBoundingClientRect();
        const content = clip
          .querySelector(".clip-content")
          .getBoundingClientRect();
        const lane = clip.closest(".track-lane").getBoundingClientRect();
        return {
          contained:
            bounds.left >= parent.left &&
            bounds.right <= parent.right &&
            bounds.top >= content.bottom &&
            bounds.bottom <= parent.bottom &&
            parent.bottom <= lane.bottom,
        };
      }),
    );
  expect(effects.length).toBeGreaterThan(0);
  expect(effects.every((effect) => effect.contained)).toBe(true);
}
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".timeline-clip")).toHaveCount(3);
  await page.getByRole("button", { name: "行为", exact: true }).click();
  await page.locator(".timeline-clip.text").click();
  await page
    .locator(".behavior-card")
    .filter({ hasText: "文字逐个显示-显示" })
    .dblclick();
  await expect(
    page.getByRole("tab", { name: "行为", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(1);
  await page.getByLabel("行为速度（%）").fill("60");
  await page.getByLabel("逐字偏移（秒）").fill("0.15");
  await page.getByLabel("行为类型", { exact: true }).click();
  await page.getByRole("menuitemradio", { name: "对象", exact: true }).click();
  await expect(page.getByLabel("逐字偏移（秒）")).toBeDisabled();
  await page.getByLabel("行为类型", { exact: true }).click();
  await page.getByRole("menuitem", { name: "文本", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "最后一个到第一个", exact: true })
    .click();
  await page.getByRole("tab", { name: "期间", exact: true }).click();
  await page.getByLabel("行为样式").selectOption("pulse");
  await page.getByLabel("永远循环").uncheck();
  await page.getByLabel("行为循环次数").fill("2");
  await page.getByLabel("行为循环延迟（秒）").fill("0.2");
  await page.getByRole("tab", { name: "出", exact: true }).click();
  await page.getByLabel("行为样式").selectOption("none");
  await page.getByRole("switch").uncheck();
  await expect(page.locator(".clip-behavior-effect")).toHaveClass(/disabled/);
  await page.getByRole("switch").check();
  await checkEffectsInsideClips(page);
  await page.screenshot({ path: path.join(root, "text-behavior.png") });
  // Drag onto each visual media kind, then independently edit the effect.
  for (const kind of ["image", "video"]) {
    if (kind === "image")
      await page
        .getByRole("button", { name: "弹出", exact: true })
        .dragTo(page.locator(".timeline-clip.image"));
    else {
      const transfer = await page.evaluateHandle(() => {
        const value = new DataTransfer();
        value.setData("troncut-behavior", "pop");
        return value;
      });
      await page
        .locator(`.timeline-clip.${kind}`)
        .dispatchEvent("drop", { dataTransfer: transfer });
    }
    await expect(page.getByLabel("行为类型", { exact: true })).toHaveText(
      "对象",
    );
    await page.getByLabel("行为类型", { exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "文本", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(3);
  await page.locator(".clip-behavior-effect").first().click();
  await page.keyboard.press("ControlOrMeta+c");
  await page.locator(".timeline-clip.video").click();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(4);
  await page.locator(".clip-behavior-effect.selected").click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(3);
  await page
    .locator(".clip-behavior-effect")
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "复制效果", exact: true }).click();
  await page.locator(".timeline-clip.image").click({ button: "right" });
  await page.getByRole("menuitem", { name: "粘贴效果", exact: true }).click();
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(4);
  await page.locator(".clip-behavior-effect.selected").click();
  await page.keyboard.press("Delete");
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(3);
  await expect(page.locator(".timeline-clip")).toHaveCount(3);
  await page.getByTitle("撤销 Ctrl+Z").click();
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(4);
  await page.getByTitle("保存项目 Ctrl+S").click();
  await expect(page.locator(".toast")).toContainText("项目已保存");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  expect(
    saved.clips.find((clip) => clip.id === "image").behaviors,
  ).toHaveLength(2);
  expect(
    saved.clips.find((clip) => clip.id === "text").behaviors[0].during.loops,
  ).toBe(2);
  // Both effect kinds share the object's internal tray. Changing clip speed
  // from its own handle must not start a clip-move or source-trim gesture.
  const videoClip = page.locator(".timeline-clip.video");
  const speedTransfer = await page.evaluateHandle(() => {
    const value = new DataTransfer();
    value.setData("troncut-effect", "clip-speed");
    return value;
  });
  await videoClip.dispatchEvent("drop", { dataTransfer: speedTransfer });
  await expect(videoClip.locator(".clip-speed-effect")).toHaveCount(1);
  await expect(videoClip.locator(".clip-behavior-effect")).toHaveCount(1);
  await checkEffectsInsideClips(page);
  const expandedHeight = (await videoClip.boundingBox()).height;
  await videoClip
    .getByRole("button", { name: "收起片段效果", exact: true })
    .click();
  await expect(videoClip.locator(".clip-effects-tray")).toHaveCount(0);
  expect((await videoClip.boundingBox()).height).toBeLessThan(expandedHeight);
  await videoClip
    .getByRole("button", { name: "展开片段效果", exact: true })
    .click();
  const originalBounds = await videoClip.boundingBox();
  const speedHandle = await videoClip
    .getByRole("button", { name: "拖动末端调整剪辑速度", exact: true })
    .boundingBox();
  await page.mouse.move(
    speedHandle.x + speedHandle.width / 2,
    speedHandle.y + speedHandle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    speedHandle.x - 65,
    speedHandle.y + speedHandle.height / 2,
    { steps: 6 },
  );
  await page.mouse.up();
  expect((await videoClip.boundingBox()).x).toBeCloseTo(originalBounds.x);
  expect((await videoClip.boundingBox()).width).toBeLessThan(
    originalBounds.width - 30,
  );
  await checkEffectsInsideClips(page);
  await videoClip.locator(".clip-behavior-effect").dblclick();
  await expect(videoClip.locator(".clip-behavior-effect")).toHaveClass(
    /selected/,
  );
  await expect(videoClip.locator(".clip-speed-effect")).not.toHaveClass(
    /selected/,
  );
  await expect(videoClip.locator(".clip-behavior-effect")).toHaveCSS(
    "background-color",
    "rgb(230, 190, 86)",
  );
  await page.screenshot({ path: path.join(root, "effects-inside-clip.png") });
  const shiftingTransfer = await page.evaluateHandle(() => {
    const value = new DataTransfer();
    value.setData("troncut-behavior", "cut");
    return value;
  });
  await videoClip.dispatchEvent("drop", { dataTransfer: shiftingTransfer });
  await page.getByRole("tab", { name: "进", exact: true }).click();
  await expect(page.getByLabel("行为张力", { exact: true })).toHaveValue(
    "7.00",
  );
  await expect(page.getByLabel("行为类型", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("行为速度（%）", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("行为移动")).toHaveValue("spring");
  await page.screenshot({ path: path.join(root, "shifting-video-in.png") });
  await page.getByLabel("行为张力", { exact: true }).fill("9.50");
  await page.getByLabel("行为移动").selectOption("quad-out");
  await expect(page.getByLabel("行为张力", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("行为速度（%）", { exact: true })).toHaveValue(
    "77",
  );
  await page.getByLabel("行为移动").selectOption("spring");
  await expect(page.getByLabel("行为张力", { exact: true })).toHaveValue(
    "9.50",
  );
  await page.getByRole("tab", { name: "期间", exact: true }).click();
  await expect(page.getByLabel("行为平移", { exact: true })).toHaveValue(
    "5.00",
  );
  await expect(
    page.getByLabel("行为循环时间（秒）", { exact: true }),
  ).toHaveValue("3.17");
  await expect(page.getByLabel("行为循环次数", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("逐字偏移（秒）", { exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({ path: path.join(root, "shifting-video-during.png") });
  await page.getByLabel("永远循环", { exact: true }).uncheck();
  await page.getByLabel("行为循环次数", { exact: true }).fill("2");
  await page.getByRole("tab", { name: "出", exact: true }).click();
  await expect(page.getByLabel("行为移动")).toHaveValue("exponential-out");
  await expect(page.getByLabel("行为速度（%）", { exact: true })).toHaveValue(
    "93",
  );
  await expect(page.getByLabel("行为张力", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(root, "shifting-video-out.png") });
  await page
    .locator(".timeline-clip.text")
    .dispatchEvent("drop", { dataTransfer: shiftingTransfer });
  await expect(page.getByLabel("行为类型", { exact: true })).toHaveText(
    "文本 - 中心向外",
  );
  await expect(page.getByLabel("逐字偏移（秒）", { exact: true })).toHaveValue(
    "0.033",
  );
  await page.screenshot({ path: path.join(root, "shifting-text-out.png") });
  await page.getByRole("tab", { name: "进", exact: true }).click();
  await expect(page.getByLabel("行为张力", { exact: true })).toHaveValue(
    "7.00",
  );
  await expect(page.getByLabel("逐字偏移（秒）", { exact: true })).toHaveValue(
    "0.020",
  );
  await page.screenshot({ path: path.join(root, "shifting-text-in.png") });
  await page.getByRole("tab", { name: "期间", exact: true }).click();
  await expect(page.getByLabel("行为类型", { exact: true })).toHaveText(
    "文本 - 同时",
  );
  await expect(page.getByLabel("逐字偏移（秒）", { exact: true })).toHaveValue(
    "0.000",
  );
  await page.getByLabel("行为类型", { exact: true }).click();
  await page.getByRole("menuitem", { name: "文本", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "中心向外", exact: true })
    .click();
  await page.getByLabel("逐字偏移（秒）", { exact: true }).fill("0.015");
  await page.getByLabel("行为类型", { exact: true }).click();
  await page.getByRole("menuitem", { name: "文本", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "同时", exact: true }).click();
  await page.screenshot({ path: path.join(root, "shifting-text-during.png") });
  await checkEffectsInsideClips(page);
  await page.getByTitle("保存项目 Ctrl+S").click();
  await expect(page.locator(".toast")).toContainText("项目已保存");
  await expect
    .poll(async () => {
      const project = JSON.parse(await fs.readFile(file, "utf8"));
      return project.clips
        .find((clip) => clip.id === "video")
        .behaviors.find((behavior) => behavior.preset === "cut")?.incoming
        .tension;
    })
    .toBe(9.5);
  await page.screenshot({ path: path.join(root, "media-behaviors.png") });
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "文字/图片/视频、效果条在对象内部、速度条拖动、对象/文本分级、切换三阶段与张力/速度动态字段、循环、开关、复制粘贴、Delete、撤销与保存",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  const page = await app.firstWindow();
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => { });
  console.error("行为交互检查失败，截图目录：", root);
  throw error;
} finally {
  await app.close();
}
