import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { timelineZoom } from "./timeline-zoom.mjs";

const root = path.resolve(`test-output/edit-all-animations/run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: { projectDirectory: path.join(root, "projects") },
  }),
);
await fs.writeFile(
  path.join(root, "image.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#41725b"/></svg>',
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
const project = createProject("编辑所有动画");
project.canvas = { width: 640, height: 360, fps: 30, background: "#151719" };
project.assets = [
  {
    id: "image",
    path: path.join(root, "image.svg"),
    name: "测试图片.svg",
    kind: "image",
    width: 320,
    height: 180,
    duration: 0,
    hasAudio: false,
  },
];
const clip = {
  ...newText("titles", 0),
  id: "animated",
  kind: "image",
  assetId: "image",
  style: undefined,
  text: undefined,
  duration: 6,
  name: "带动画的图片",
};
clip.keyframes = [
  { time: 0, value: { ...clip.transform, x: 0.35, scale: 1 } },
  {
    time: 1,
    value: { ...clip.transform, x: 0.6, scale: 1.5 },
    animation: true,
    easing: "linear",
  },
  { time: 3, value: { ...clip.transform, x: 0.6, scale: 1.5 } },
  {
    time: 4,
    value: { ...clip.transform, x: 0.4, scale: 0.75 },
    animation: true,
  },
];
project.clips = [
  clip,
  {
    ...clip,
    id: "static",
    start: 7,
    duration: 2,
    keyframes: [],
    name: "静态图片",
  },
];
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project, file }),
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
  const timeline = page.locator('.timeline-clip[data-clip-id="animated"]');
  await timeline.click({ position: { x: 20, y: 12 } });
  const toggle = page.getByRole("button", {
    name: "编辑所有动画",
    exact: true,
  });
  const arrows = timeline.locator(".clip-animation");
  const scale = page.getByLabel("缩放 (%)", { exact: true });
  const save = async () => {
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".busy-overlay")).toHaveCount(0);
    await expect(page.locator(".project-save-state")).not.toContainText("*");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(arrows).toHaveCount(2);
  await arrows.first().locator(".animation-point.end").click();
  await expect(scale).toHaveValue("150");
  await expect(page.locator(".keyframe-edit-status")).toBeVisible();
  await page.screenshot({ path: path.join(root, "single-animation.png") });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".keyframe-edit-status")).toHaveCount(0);
  await scale.fill("300");
  await scale.blur();
  const all = (await save()).clips[0];
  expect(all.keyframes.map((frame) => frame.value.scale)).toEqual([
    2, 3, 3, 1.5,
  ]);
  expect(all.keyframes.map(({ value, ...frame }) => frame)).toEqual(
    clip.keyframes.map(({ value, ...frame }) => frame),
  );
  await page.screenshot({ path: path.join(root, "all-animations.png") });
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(scale).toHaveValue("150");
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(scale).toHaveValue("300");
  await toggle.click();
  await expect(page.locator(".keyframe-edit-status")).toBeVisible();
  await scale.fill("350");
  await scale.blur();
  expect(
    (await save()).clips[0].keyframes.map((frame) => frame.value.scale),
  ).toEqual([2, 3.5, 3.5, 1.5]);

  // Whole-clip editing also works between endpoints with automatic animation on.
  await toggle.click();
  await page
    .locator(".tool-rail")
    .getByRole("button", { name: "动画", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "开启自动动画", exact: true })
    .check();
  const zoom = await timelineZoom(page);
  await page.locator(".ruler").click({ position: { x: 2.5 * zoom, y: 29 } });
  await scale.fill("400");
  await scale.blur();
  const beforeDrag = (await save()).clips[0];
  expect(beforeDrag.keyframes.map((frame) => frame.time)).toEqual([0, 1, 3, 4]);
  const holder = await page.locator(".canvas-holder").boundingBox();
  await page.mouse.move(
    holder.x + holder.width / 2,
    holder.y + holder.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    holder.x + holder.width / 2 + 24,
    holder.y + holder.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  const afterDrag = (await save()).clips[0];
  const delta =
    afterDrag.keyframes[0].value.x - beforeDrag.keyframes[0].value.x;
  expect(delta).toBeGreaterThan(0);
  for (let i = 0; i < beforeDrag.keyframes.length; i++)
    expect(
      afterDrag.keyframes[i].value.x - beforeDrag.keyframes[i].value.x,
    ).toBeCloseTo(delta);
  expect(afterDrag.keyframes.map((frame) => frame.time)).toEqual([0, 1, 3, 4]);

  // Static clips hide the switch; changing selection resets the editing scope.
  await page
    .locator('.timeline-clip[data-clip-id="static"]')
    .click({ position: { x: 20, y: 12 } });
  await expect(toggle).toHaveCount(0);
  await timeline.click({ position: { x: 20, y: 12 } });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page
    .locator(`.track-header[data-track-id="${clip.trackId}"]`)
    .getByTitle("锁定 / 解锁轨道", { exact: true })
    .click();
  await expect(toggle).toBeDisabled();
  await page
    .locator(`.track-header[data-track-id="${clip.trackId}"]`)
    .getByTitle("锁定 / 解锁轨道", { exact: true })
    .click();
  await save();
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project").first().click();
  await timeline.click({ position: { x: 20, y: 12 } });
  expect((await save()).clips[0].keyframes).toEqual(afterDrag.keyframes);
  expect(errors).toEqual([]);
  console.log(
    `整段/单动画切换、整体缩放、画布移动、自动动画优先级、撤销重做、锁定及保存重开通过：${root}`,
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
