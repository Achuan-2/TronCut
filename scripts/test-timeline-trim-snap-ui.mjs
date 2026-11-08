import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimelineZoom } from "./timeline-zoom.mjs";

const root = path.resolve(`test-output/timeline-trim-snap/run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
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
const project = createProject("跨轨道裁边吸附");
project.tracks.forEach((track) => {
  track.height = 48;
});
project.clips = [
  { ...newText("video", 2, 0, "调整长度"), id: "trim", duration: 4 },
  { ...newText("titles", 3, 0, "左侧目标"), duration: 2 },
  { ...newText("titles", 8, 0, "右侧目标"), duration: 1 },
];
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: {
      projectDirectory: root,
      backupDirectory: path.join(root, "backups"),
    },
    program: { snapping: true },
  }),
);
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
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1500, 1000),
  );
  const clip = page.locator('.timeline-clip[data-clip-id="trim"]');
  await expect(clip).toHaveCount(1);
  const command = (name) =>
    app.evaluate(({ BrowserWindow }, value) => {
      BrowserWindow.getAllWindows()[0].webContents.send("shortcut", value);
    }, name);
  const edgeTime = (edge, zoom) =>
    clip.evaluate(
      (node, args) =>
        (parseFloat(node.style.left) +
          (args.edge === "right" ? parseFloat(node.style.width) : 0)) /
        args.zoom,
      { edge, zoom },
    );
  async function trim(edge, time, zoom, expected) {
    const originalTime = await edgeTime(edge, zoom);
    const handle = await clip.locator(`.trim-handle.${edge}`).boundingBox();
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (time - originalTime) * zoom, y, { steps: 8 });
    // Preview must use the same snapped value as the final project.
    await expect.poll(() => edgeTime(edge, zoom)).toBeCloseTo(expected, 6);
    await page.mouse.up();
    await expect.poll(() => edgeTime(edge, zoom)).toBeCloseTo(expected, 6);
  }
  for (const zoom of [80, 160]) {
    await setTimelineZoom(page, zoom);
    for (const [edge, target] of [
      ["left", 3],
      ["left", 5],
      ["right", 8],
      ["right", 9],
    ]) {
      await trim(edge, target - 6 / zoom, zoom, target);
      await command("undo");
      await expect
        .poll(() => edgeTime(edge, zoom))
        .toBeCloseTo(edge === "left" ? 2 : 6, 6);
    }
  }
  await setTimelineZoom(page, 80);
  await trim("right", 8 - 12 / 80, 80, 8 - 12 / 80);
  await command("undo");
  await expect.poll(() => edgeTime("right", 80)).toBeCloseTo(6, 6);
  const snap = page.getByRole("button", { name: "吸附", exact: true });
  await snap.click();
  await trim("right", 8 - 6 / 80, 80, 8 - 6 / 80);
  await command("undo");
  await expect.poll(() => edgeTime("right", 80)).toBeCloseTo(6, 6);
  await snap.click();
  await trim("right", 8 - 6 / 80, 80, 8);
  await command("undo");
  await expect.poll(() => edgeTime("right", 80)).toBeCloseTo(6, 6);
  await command("redo");
  await expect.poll(() => edgeTime("right", 80)).toBeCloseTo(8, 6);
  await command("save");
  await expect(page.getByRole("status")).toContainText("项目已保存");
  await expect
    .poll(async () => {
      const saved = JSON.parse(await fs.readFile(file, "utf8"));
      const value = saved.clips.find((item) => item.id === "trim");
      return value.start + value.duration;
    })
    .toBe(8);
  expect(errors).toEqual([]);
  await page.screenshot({ path: path.join(root, "cross-track-snap.png") });
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify(
      {
        checks: [
          "left/right",
          "start/end",
          "zoom",
          "preview/commit",
          "outside-tolerance",
          "toggle",
          "undo",
          "save",
        ],
        rendererErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    `跨轨道裁边吸附、缩放容差、开关、预览提交、撤销和保存通过：${root}`,
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.log(root);
  throw error;
} finally {
  await app.close();
}
