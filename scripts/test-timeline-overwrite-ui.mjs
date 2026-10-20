import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(
  `test-output/timeline-overwrite-ui/run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: {
      projectDirectory: path.join(root, "projects"),
      backupDirectory: path.join(root, "backups"),
    },
    program: { snapping: false },
  }),
);
const bundle = await build({
  stdin: {
    contents:
      'export {createProject, newText} from "./shared/model"; export {hasProjectTimelineOverlap} from "./shared/timeline-collision"; export {createClipGroup, groupedTimeline} from "./shared/clip-groups";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  createProject,
  newText,
  hasProjectTimelineOverlap,
  createClipGroup,
  groupedTimeline,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const source = path.join(root, "source.mp4");
execFileSync(
  path.resolve("resources/bin/ffmpeg.exe"),
  [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=10:duration=20",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:duration=20",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ],
  { windowsHide: true },
);
const initial = createProject("覆盖拖拽");
initial.canvas = { width: 160, height: 90, fps: 30, background: "#000000" };
initial.tracks.forEach((track) => (track.height = 70));
initial.assets = [
  {
    id: "source",
    name: "source",
    path: "source.mp4",
    kind: "video",
    duration: 20,
    width: 160,
    height: 90,
    hasAudio: true,
  },
];
initial.clips = [
  ["A", 0, 8, "video"],
  ["B", 10, 2, "video"],
  ["C", 15, 2, "video"],
  ["D", 0, 8, "titles"],
].map(([id, start, duration, trackId]) => ({
  ...newText(trackId, start),
  id,
  name: id,
  kind: "video",
  assetId: "source",
  sourceIn: start,
  duration,
}));
const file = path.join(root, "fixture.troncut");
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch(project) {
  if (project) await fs.writeFile(file, JSON.stringify(project));
  app = await electron.launch({ args: [".", file], env });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1700, 1000),
  );
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error(message.text());
  });
  await expect(page.locator(".timeline-clip")).toHaveCount(
    project ? groupedTimeline(project).clips.length : 5,
  );
  return page;
}
const command = (name) =>
  app.evaluate(
    ({ BrowserWindow }, name) =>
      BrowserWindow.getAllWindows()[0].webContents.send("shortcut", name),
    name,
  );
const item = (page, id) => page.locator(`.timeline-clip[data-clip-id="${id}"]`);
async function saveWhere(predicate) {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(page.locator(".project-save-state")).not.toContainText("*");
  await expect
    .poll(async () => predicate(JSON.parse(await fs.readFile(file, "utf8"))))
    .toBe(true);
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  expect(hasProjectTimelineOverlap(saved)).toBe(false);
  for (const clip of saved.clips) {
    const frame = clip.start * saved.canvas.fps;
    expect(frame).toBeCloseTo(Math.round(frame), 8);
  }
  // DOM layout reports finite precision; compare persisted times within 1 ms.
  return JSON.parse(
    JSON.stringify(saved, (_, value) =>
      typeof value === "number" ? Number(value.toFixed(3)) : value,
    ),
  );
}
async function drag(
  page,
  id,
  start,
  duration,
  targetTrack = "video",
  beforeRelease,
) {
  const clip = item(page, id);
  const bounds = await clip.boundingBox();
  const zoom =
    (await clip.evaluate((element) => parseFloat(element.style.width))) /
    duration;
  const lane = await page
    .locator(`.track-lane[data-track="${targetTrack}"]`)
    .boundingBox();
  await page.mouse.move(bounds.x + 18, bounds.y + 22);
  await page.mouse.down();
  await page.mouse.move(lane.x + start * zoom + 18, lane.y + 22, { steps: 12 });
  await beforeRelease?.();
  await page.mouse.up();
}
try {
  let page = await launch(initial);
  await drag(page, "B", 5, 2, "video", async () => {
    await expect
      .poll(() =>
        item(page, "B").evaluate(
          (element) =>
            (parseFloat(element.style.left) / parseFloat(element.style.width)) *
            2,
        ),
      )
      .toBeCloseTo(5, 2);
    await expect(page.locator(".timeline-clip")).toHaveCount(4);
  });
  await expect(page.locator(".timeline-clip")).toHaveCount(5);
  let saved = await saveWhere(
    (project) =>
      Math.abs(project.clips.find((clip) => clip.id === "B")?.start - 5) <
      0.001,
  );
  expect(
    saved.clips
      .filter((clip) => clip.name === "A")
      .map((clip) => [clip.start, clip.duration, clip.sourceIn]),
  ).toEqual([
    [0, 5, 0],
    [7, 1, 7],
  ]);
  await page.screenshot({ path: path.join(root, "middle-overwrite.png") });
  await command("undo");
  await expect(page.locator(".timeline-clip")).toHaveCount(4);
  await command("redo");
  await expect(page.locator(".timeline-clip")).toHaveCount(5);
  await command("undo");
  await expect
    .poll(() =>
      item(page, "B").evaluate(
        (element) =>
          (parseFloat(element.style.left) / parseFloat(element.style.width)) *
          2,
      ),
    )
    .toBeCloseTo(10, 2);
  await drag(page, "B", 6, 2);
  await expect(page.locator(".timeline-clip")).toHaveCount(4);
  saved = await saveWhere(
    (project) =>
      Math.abs(project.clips.find((clip) => clip.id === "B")?.start - 6) <
      0.001,
  );
  expect(saved.clips.find((clip) => clip.id === "A").duration).toBe(6);
  await command("undo");
  await expect
    .poll(() =>
      item(page, "B").evaluate(
        (element) =>
          (parseFloat(element.style.left) / parseFloat(element.style.width)) *
          2,
      ),
    )
    .toBeCloseTo(10, 2);
  await drag(page, "C", 3, 2, "titles");
  saved = await saveWhere(
    (project) =>
      project.clips.find((clip) => clip.id === "C")?.trackId === "titles",
  );
  expect(
    saved.clips
      .filter((clip) => clip.name === "D")
      .map((clip) => [clip.start, clip.duration]),
  ).toEqual([
    [0, 3],
    [5, 3],
  ]);
  expect(saved.clips.find((clip) => clip.id === "A").duration).toBe(8);
  await page.screenshot({ path: path.join(root, "cross-track-overwrite.png") });
  await app.close();
  page = await launch();
  expect(
    await item(page, "C").evaluate(
      (element) =>
        (parseFloat(element.style.left) / parseFloat(element.style.width)) * 2,
    ),
  ).toBeCloseTo(3, 2);
  await app.close();

  page = await launch(initial);
  await drag(page, "B", 4, 2, "video", async () => {
    await item(page, "B").dispatchEvent("pointercancel", { pointerId: 1 });
  });
  await expect
    .poll(() =>
      item(page, "B").evaluate(
        (element) =>
          (parseFloat(element.style.left) / parseFloat(element.style.width)) *
          2,
      ),
    )
    .toBeCloseTo(10, 2);
  await expect(page.locator(".timeline-clip")).toHaveCount(4);
  const fastClip = item(page, "B");
  const fastBounds = await fastClip.boundingBox();
  const fastZoom =
    (await fastClip.evaluate((element) => parseFloat(element.style.width))) / 2;
  await page.mouse.move(fastBounds.x + 18, fastBounds.y + 22);
  await page.mouse.down();
  // Both events run in one task, before the pending RAF preview can render.
  await fastClip.evaluate(
    (element, point) => {
      for (const type of ["pointermove", "pointerup"])
        element.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            button: 0,
            buttons: type === "pointermove" ? 1 : 0,
            clientX: point.x,
            clientY: point.y,
          }),
        );
    },
    { x: fastBounds.x + 18 - 5 * fastZoom, y: fastBounds.y + 22 },
  );
  await page.mouse.up();
  await expect(page.locator(".timeline-clip")).toHaveCount(5);
  await saveWhere(
    (project) =>
      Math.abs(project.clips.find((clip) => clip.id === "B")?.start - 5) <
      0.001,
  );
  await app.close();

  // The collapsed group's occupied interval overwrites as one item.
  const grouped = createClipGroup(initial, new Set(["B", "C"]));
  page = await launch(grouped);
  await expect(page.locator(".clip-group")).toHaveCount(1);
  await drag(page, "B", 4, 7);
  saved = await saveWhere(
    (project) =>
      Math.abs(project.clips.find((clip) => clip.id === "B")?.start - 4) <
      0.001,
  );
  expect(saved.clips.find((clip) => clip.id === "A").duration).toBe(4);
  expect(saved.clips.find((clip) => clip.id === "C").start).toBe(9);
  await command("undo");
  await expect
    .poll(() =>
      item(page, "B").evaluate(
        (element) =>
          (parseFloat(element.style.left) / parseFloat(element.style.width)) *
          7,
      ),
    )
    .toBeCloseTo(10, 2);
  await page.screenshot({ path: path.join(root, "group-undo.png") });
  expect(errors).toEqual([]);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify(
      {
        root,
        rendererErrors: errors,
        checks: [
          "preview",
          "middle",
          "tail",
          "cross-track",
          "undo-redo",
          "save-reopen",
          "collapsed-group",
          "cancel",
          "rapid-release",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    `覆盖拖动、尾部截断、中间裁分、跨轨、组合、撤销重做和保存重开通过：${root}`,
  );
} catch (error) {
  const page = await app?.firstWindow();
  if (page) {
    await page
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
    console.log(await page.locator("body").innerText());
  }
  console.log(root);
  throw error;
} finally {
  await app?.close();
}
