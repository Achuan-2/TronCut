import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(
  `test-output/recording-scene-viewport-ui/run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: {
      projectDirectory: root,
      backupDirectory: path.join(root, "backups"),
    },
    program: { previewZoom: "fit" },
  }),
);
const bundle = await build({
  stdin: {
    contents: `export { createProject } from "./shared/model";
      export { addRecordedAssets, defaultRecordingSettings } from "./shared/recording";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, addRecordedAssets, defaultRecordingSettings } =
  await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
execFileSync(
  path.resolve("resources/bin/ffmpeg.exe"),
  [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=red:s=320x180:r=10:d=8,drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    path.join(root, "screen.mp4"),
  ],
  { windowsHide: true },
);
await fs.writeFile(
  path.join(root, "background.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#00ff00"/></svg>',
);
const asset = {
  id: "screen",
  name: "录屏",
  path: "screen.mp4",
  kind: "video",
  width: 320,
  height: 180,
  duration: 8,
  hasAudio: false,
  cursor: {
    samples: [
      [0, 0.2, false],
      [1, 0.2, true],
      [1.1, 0.2, false],
      [2, 0.2, true],
      [2.1, 0.2, false],
      [2.5, 0.2, false],
      [3, 0.8, true],
      [3.1, 0.8, false],
      [4, 0.8, true],
      [4.1, 0.8, false],
    ].map(([time, x, click]) => ({ time, x, y: 0.5, click, visible: true })),
  },
};
const project = addRecordedAssets(
  createProject("录屏整体缩放视口验收"),
  [{ asset, kind: "screen" }],
  {
    ...defaultRecordingSettings,
    zoomBackground: true,
    zoom: 2,
  },
  0,
  {
    ...asset,
    id: "bg",
    path: "background.svg",
    kind: "image",
    cursor: undefined,
  },
);
project.canvas = { width: 1280, height: 720, fps: 30, background: "#000000" };
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".recording-object")).toHaveCount(1);
  const progress = page.getByRole("slider", { name: "播放进度", exact: true });
  const canvas = page.locator(".canvas");
  const screen = canvas.locator(
    `.preview-layer[data-clip-id="${project.clips[0].id}"]`,
  );
  const seek = async (time) => {
    await progress.fill(String(time));
    await page.evaluate(async () => {
      for (let frame = 0; frame < 8; frame++)
        await new Promise(requestAnimationFrame);
    });
  };
  const geometry = () =>
    canvas.evaluate((node) => {
      const bounds = node.getBoundingClientRect(),
        holder = node.closest(".canvas-holder");
      return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        scrollWidth: holder.scrollWidth,
        scrollHeight: holder.scrollHeight,
        scrollLeft: holder.scrollLeft,
        scrollTop: holder.scrollTop,
      };
    });
  for (const zoom of ["fit", "1"]) {
    await page.getByLabel("画布显示比例", { exact: true }).selectOption(zoom);
    await seek(0);
    const baseline = await geometry();
    const pose = () =>
      screen.evaluate((node) =>
        [node.style.left, node.style.top, node.style.transform].join(" "),
      );
    const initialTransform = await pose();
    const poses = [];
    for (const time of [2.3, 3.8, 5.5, 0]) {
      await seek(time);
      const actual = await geometry();
      for (const key of Object.keys(baseline))
        expect(
          Math.abs(actual[key] - baseline[key]),
          `${zoom} ${time}s ${key}`,
        ).toBeLessThan(1);
      poses.push(await pose());
      await page.screenshot({
        path: path.join(root, `frame-${zoom}-${time}.png`),
      });
    }
    expect(poses[0]).not.toBe(initialTransform);
    expect(poses[1]).not.toBe(poses[0]);
    expect(poses.at(-1)).toBe(initialTransform);
  }
  expect(errors).toEqual([]);
  console.log(`录屏和背景缩放平移时画布尺寸、位置与滚动范围固定：${root}`);
} finally {
  await app.close();
}
