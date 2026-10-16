import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/track-height-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundled = await build({
  stdin: {
    contents:
      'export { createProject, newText, newTrack } from "./shared/model"; export { createBehavior } from "./shared/behaviors";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, newTrack, createBehavior } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const project = createProject("轨道高度与单行文本");
project.tracks = Array.from({ length: 6 }, (_, index) => newTrack(index));
const text =
  "这是一段很长的文本，用来检查时间轴只显示一行并且正确省略。\n第二行仍保留在画布内容中。";
project.clips = project.tracks.map((track) => newText(track.id, 0, 0, text));
project.clips[0].behaviors = [
  createBehavior("fade", 5),
  createBehavior("pop", 5),
];
project.clips[2].keyframes = [
  { time: 0, value: { ...project.clips[2].transform } },
  { time: 1, value: { ...project.clips[2].transform, x: 0.8 } },
];
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  app = await electron.launch({ args: [".", file], env });
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".track-header")).toHaveCount(6);
  const header = page.locator(".track-header").first();
  const lane = page.locator(".track-lane").first();
  const handle = header.getByRole("separator");
  const height = async (locator) =>
    Math.round((await locator.boundingBox()).height);
  await expect.poll(() => height(header)).toBe(118);
  const drag = async (delta) => {
    const bounds = await handle.boundingBox();
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2 + delta,
      { steps: 5 },
    );
  };
  await drag(40);
  await expect.poll(() => height(lane)).toBe(158);
  await expect.poll(() => height(header)).toBe(158);
  await page.mouse.up();
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect.poll(() => height(header)).toBe(118);
  await drag(40);
  await page.mouse.up();
  // Cancel returns to the saved height and must not add an undo step.
  await drag(15);
  await handle.dispatchEvent("pointercancel");
  await page.mouse.up();
  await expect.poll(() => height(header)).toBe(158);
  await expect(page.locator(".timeline-clip.text .clip-detail")).toHaveCount(0);
  await expect(lane.locator(".clip-label")).toHaveCount(1);
  await expect(lane.locator(".clip-label > span")).toHaveText(
    text.replace(/\s+/g, " "),
  );
  const label = await lane.locator(".clip-label > span").evaluate((node) => ({
    overflow: getComputedStyle(node).textOverflow,
    nowrap: getComputedStyle(node).whiteSpace,
    truncated: node.scrollWidth > node.clientWidth,
  }));
  expect(label).toEqual({
    overflow: "ellipsis",
    nowrap: "nowrap",
    truncated: true,
  });
  const effects = await lane
    .locator(".clip-behavior-effect")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const bounds = node.getBoundingClientRect();
        const clip = node.closest(".timeline-clip").getBoundingClientRect();
        const content = node
          .closest(".timeline-clip")
          .querySelector(".clip-content")
          .getBoundingClientRect();
        return bounds.top >= content.bottom && bounds.bottom <= clip.bottom;
      }),
    );
  expect(effects).toEqual([true, true]);
  await page.getByTitle("保存工程 Ctrl+S", { exact: true }).click();
  await expect
    .poll(
      async () => JSON.parse(await fs.readFile(file, "utf8")).tracks[0].height,
    )
    .toBe(110);
  await page
    .locator(".timeline-body")
    .screenshot({ path: path.join(root, "resized.png") });
  await app.close();
  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const reopened = page.locator(".track-header").first();
  await expect.poll(() => height(reopened)).toBe(158);
  await reopened.getByRole("separator").dblclick();
  await expect.poll(() => height(reopened)).toBe(118);
  const second = page.locator(".track-header").nth(1);
  await second.getByRole("separator").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => height(second)).toBe(54);
  await page.keyboard.press("Shift+ArrowUp");
  await expect.poll(() => height(second)).toBe(32);
  await page.keyboard.press("Home");
  await expect.poll(() => height(second)).toBe(70);
  await page.locator(".timeline-scroll").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const headers = [...document.querySelectorAll(".track-header")];
        const lanes = [...document.querySelectorAll(".track-lane")];
        return Math.max(
          ...headers.map((node, index) =>
            Math.abs(
              node.getBoundingClientRect().top -
                lanes[index].getBoundingClientRect().top,
            ),
          ),
        );
      }),
    )
    .toBeLessThanOrEqual(1);
  const shrink = page.getByRole("button", { name: "缩小轨道高度", exact: true });
  for (let i = 0; i < 8 && await shrink.isEnabled(); i++) await shrink.click();
  await expect(shrink).toBeDisabled();
  await expect.poll(() => height(page.locator(".track-header").nth(1))).toBe(32);
  await expect.poll(() => height(page.locator(".track-header").nth(2))).toBe(32);
  const contained = await page.locator(".track-lane").evaluateAll((lanes) =>
    lanes.every((lane) => {
      const bounds = lane.getBoundingClientRect();
      return [...lane.querySelectorAll(".timeline-clip, .animation-point")].every((node) => {
        const clip = node.getBoundingClientRect();
        return clip.top >= bounds.top && clip.bottom <= bounds.bottom;
      });
    }),
  );
  expect(contained).toBe(true);
  const controlsFit = await page.locator(".track-controls").evaluateAll((controls) =>
    controls.every((node) => {
      const bounds = node.getBoundingClientRect();
      const header = node.closest(".track-header").getBoundingClientRect();
      return bounds.top >= header.top && bounds.bottom <= header.bottom;
    }),
  );
  expect(controlsFit).toBe(true);
  await page.locator(".timeline-body").screenshot({ path: path.join(root, "compact.png") });
  await page.getByTitle("保存工程 Ctrl+S", { exact: true }).click();
  await expect.poll(async () =>
    JSON.parse(await fs.readFile(file, "utf8")).tracks.every((track) => track.height === 32),
  ).toBe(true);
  await app.close();
  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect.poll(() => height(page.locator(".track-header").nth(2))).toBe(32);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "拖动实时预览、单步撤销、取消、双击重置、键盘调节、单行省略、效果条包含、保存重开、滚动对齐",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  if (app)
    await (
      await app.firstWindow()
    )
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app?.close();
}
