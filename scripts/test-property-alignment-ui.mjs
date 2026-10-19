import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(
  "test-output/property-alignment-ui",
  `run-${Date.now()}`,
);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export { createProject, newText, validateProject } from "./shared/model"; export { defaultVisualEffect, additionalVisualEffectPresets } from "./shared/visual-effects"; export { createBehavior } from "./shared/behaviors";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  createProject,
  validateProject,
  newText,
  defaultVisualEffect,
  additionalVisualEffectPresets,
  createBehavior,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = createProject("属性滑条对齐检查");
const behavior = createBehavior("float", 30);
behavior.during = { ...behavior.incoming };
project.clips = [
  {
    ...newText("titles", 0),
    id: "text",
    duration: 30,
    mediaFrame: { radius: 20, unit: "percent", enabled: true },
    visualEffects: Object.fromEntries(
      additionalVisualEffectPresets.map(({ id }) => [
        id,
        defaultVisualEffect(id),
      ]),
    ),
    behaviors: [behavior],
  },
];
const audio = path.join(root, "audio.wav");
execFileSync(
  path.resolve(
    "resources/bin",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  ),
  ["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=1", audio],
  { stdio: "ignore", windowsHide: true },
);
project.assets = [
  {
    id: "audio",
    name: "声音",
    path: "audio.wav",
    kind: "audio",
    width: 0,
    height: 0,
    duration: 1,
    hasAudio: true,
  },
];
project.clips.push({
  ...newText("audio", 0),
  id: "audio",
  assetId: "audio",
  kind: "audio",
  duration: 1,
});
const file = path.join(root, "project.troncut");
validateProject(project);
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const measurements = [];
  const check = async (name) => {
    const rows = await page
      .locator('.inspector input[type="range"]')
      .evaluateAll((inputs) =>
        inputs
          .filter((input) => input.checkVisibility())
          .map((input) => {
            const row = input.closest(".property-slider-row, .field");
            const label =
              [...row.childNodes].find(
                (node) =>
                  node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
              ) ?? row.querySelector(":scope > span");
            const range = document.createRange();
            range.selectNodeContents(label);
            return {
              label: label.textContent.trim(),
              offset:
                range.getBoundingClientRect().left -
                row.getBoundingClientRect().left,
              align: getComputedStyle(
                label.nodeType === Node.TEXT_NODE ? row : label,
              ).textAlign,
            };
          }),
      );
    expect(rows.length, name).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Math.abs(row.offset), `${name}: ${row.label}`).toBeLessThan(0.1);
      expect(row.align).not.toBe("right");
    }
    measurements.push({ name, rows });
  };
  for (const width of [1440, 1200]) {
    await page.setViewportSize({ width, height: 1000 });
    await page
      .locator('.timeline-clip[data-clip-id="text"]')
      .click({ position: { x: 30, y: 5 } });
    await page.locator("#inspector-video-tab").click();
    await check(`画面、圆角及七项视觉效果-${width}`);
    await page.locator(".inspector-body").evaluate((node) => {
      node.scrollTop = 0;
    });
    await page
      .locator(".inspector")
      .screenshot({ path: path.join(root, `frame-${width}.png`) });
    const radius = page.getByLabel("圆角 (%)", { exact: true });
    await radius.fill("35");
    await radius.press("Tab");
    await expect(
      page.getByLabel("圆角半径百分比滑条", { exact: true }),
    ).toHaveValue("35");
    await page.locator("#inspector-text-tab").click();
    await check(`文字背景-${width}`);
    await page.locator("#inspector-behaviors-tab").click();
    for (const phase of ["进", "期间", "出"]) {
      await page.getByRole("tab", { name: phase, exact: true }).click();
      await check(`行为${phase}-${width}`);
    }
    await page
      .locator('.timeline-clip[data-clip-id="audio"]')
      .click({ position: { x: 20, y: 5 } });
    await page.locator("#inspector-audio-tab").click();
    await check(`声音-${width}`);
  }
  expect(errors).toEqual([]);
  await fs.writeFile(
    path.join(root, "measurements.json"),
    JSON.stringify(measurements, null, 2),
  );
  console.log(
    `画面、圆角、七项视觉效果、文字、声音及行为三阶段滑条左对齐通过（两种窗口宽度）：${root}`,
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
