import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const root = path.resolve("test-output/canvas-camera-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const helpers = path.join(root, "helpers.cjs");
await build({
  stdin: {
    contents: `export { createProject } from './shared/model'; export { cameraAnimationClip } from './shared/canvas-camera';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  outfile: helpers,
});
const { createProject, cameraAnimationClip } = createRequire(import.meta.url)(
  helpers,
);
const project = createProject("全局画布运镜验收");
const savedFile = path.join(root, "验收.troncut");
project.clips = [0.3, 0.7].map((x, index) => ({
  ...cameraAnimationClip(project),
  id: `shape-${index}`,
  trackId: project.tracks[index].id,
  duration: 10,
  shape: "rectangle",
  shapeSize: { width: 200, height: 150 },
  fill: "#00ff00",
  transform: { x, y: 0.5, scale: 1, opacity: 1 },
}));
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project, file: savedFile }),
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
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await expect(page.locator(".timeline-camera-header")).toHaveCount(0);
  await expect(page.locator(".timeline-camera")).toHaveCount(0);
  const firstLane = page.locator(".track-lane").first();
  const emptyTop = (await firstLane.boundingBox()).y;
  await page.getByRole("button", { name: "动画", exact: true }).click();
  await page
    .getByRole("button", { name: "添加画布缩放与平移", exact: true })
    .click();
  const arrows = page.locator(".timeline-camera .clip-animation");
  await expect(arrows).toHaveCount(1);
  await expect(arrows.locator(".animation-arrow svg path")).toHaveCount(1);
  await expect(arrows.locator(".animation-point-dot")).toHaveCount(2);
  await expect(page.locator(".timeline-camera-header")).toHaveCount(1);
  expect((await firstLane.boundingBox()).y - emptyTop).toBeCloseTo(44, 0);
  const canvasGeometry = () =>
    page.locator(".canvas").evaluate((node) => {
      const box = node.getBoundingClientRect(),
        holder = node.closest(".canvas-holder");
      return [
        box.x,
        box.y,
        box.width,
        box.height,
        holder.scrollWidth,
        holder.scrollHeight,
        holder.scrollLeft,
        holder.scrollTop,
      ];
    });
  const settled = () =>
    page.evaluate(async () => {
      for (let frame = 0; frame < 6; frame++)
        await new Promise(requestAnimationFrame);
    });
  await settled();
  const beforeZoom = await canvasGeometry();
  const zoom = page.getByLabel("画布缩放百分比", { exact: true });
  await zoom.fill("200");
  await zoom.press("Tab");
  await expect(zoom).toHaveValue("200");
  await settled();
  const afterZoom = await canvasGeometry();
  afterZoom.forEach((value, index) =>
    expect(value).toBeCloseTo(beforeZoom[index], 0),
  );
  await expect
    .poll(() =>
      page
        .locator(".canvas > .canvas-scene")
        .evaluate((node) => node.style.transform),
    )
    .toContain("scale(2)");
  const scene = page.locator(".canvas > .canvas-scene");
  const beforePan = await scene.evaluate((node) => node.style.transform);
  const frame = await page.locator(".camera-viewport").boundingBox();
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    frame.x + frame.width / 2 + 15,
    frame.y + frame.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(() => scene.evaluate((node) => node.style.transform))
    .not.toBe(beforePan);
  await settled();
  (await canvasGeometry()).forEach((value, index) =>
    expect(value).toBeCloseTo(beforeZoom[index], 0),
  );
  await expect(page.locator(".timeline-clip .clip-animation")).toHaveCount(0);
  const endpoint = arrows.locator(".animation-point.end");
  const point = await endpoint.boundingBox();
  const originalEnd = Number(await arrows.getAttribute("data-end"));
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    point.x + point.width / 2 + 20,
    point.y + point.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  expect(Number(await arrows.getAttribute("data-end"))).toBeGreaterThan(
    originalEnd,
  );
  await expect(zoom).toHaveValue("200");
  await page.screenshot({ path: path.join(root, "canvas-camera.png") });
  await arrows.click({ button: "right" });
  await page.getByRole("menuitem", { name: "启用缓冲", exact: true }).hover();
  await page.getByRole("menuitemradio", { name: "线性", exact: true }).click();
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, root);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("项目已保存", {
    timeout: 20000,
  });
  const saved = JSON.parse(await fs.readFile(savedFile, "utf8"));
  expect(saved.camera.keyframes.at(-1).value.scale).toBe(2);
  expect(saved.camera.keyframes.at(-1).easing).toBe("linear");
  expect(saved.clips.map((clip) => clip.keyframes)).toEqual([[], []]);
  expect(saved.clips.map((clip) => clip.transform)).toEqual(
    project.clips.map((clip) => clip.transform),
  );
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page
    .locator(".recent-project")
    .filter({ hasText: project.name })
    .click();
  await expect(arrows).toHaveCount(1);
  await arrows.locator(".animation-point.end").click();
  await expect(zoom).toHaveValue("200");
  await arrows.locator(".animation-arrow").focus();
  await page.keyboard.press("Delete");
  await expect(arrows).toHaveCount(0);
  await expect(page.locator(".timeline-camera-header")).toHaveCount(0);
  await expect(page.locator(".timeline-camera")).toHaveCount(0);
  expect((await firstLane.boundingBox()).y).toBeCloseTo(emptyTop, 0);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(arrows).toHaveCount(1);
  await expect(page.locator(".timeline-camera-header")).toHaveCount(1);
  await arrows.locator(".animation-point.end").click();
  await arrows.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^复制/ }).click();
  const progress = page.getByRole("slider", { name: "播放进度", exact: true });
  await progress.fill("5");
  await progress.blur();
  await page.keyboard.press("Control+v");
  await expect(arrows).toHaveCount(2);
  await expect(arrows.last()).toHaveAttribute("data-start", "5");
  await arrows.last().locator(".animation-point.end").click();
  await arrows.last().locator(".animation-arrow").focus();
  await page.keyboard.press("Delete");
  await expect(arrows).toHaveCount(1);
  await arrows.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^剪切/ }).click();
  await expect(arrows).toHaveCount(0);
  await expect(page.locator(".timeline-camera-header")).toHaveCount(0);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(arrows).toHaveCount(1);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ root, savedFile, result: "passed" }));
} finally {
  await app.close();
}
