import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/caption-edit-scope-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { appendCaptionCues } from "./shared/captions";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, appendCaptionCues } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const first = appendCaptionCues(createProject("字幕编辑范围"), [
  { start: 0, end: 2, text: "字幕甲" },
  { start: 2, end: 4, text: "字幕乙" },
  { start: 4, end: 6, text: "字幕丙" },
]);
const { project, ids: lockedIds } = appendCaptionCues(
  first.project,
  [{ start: 0, end: 6, text: "其他轨锁定字幕" }],
  { newTrack: true },
);
const trackId = project.clips.find((clip) => clip.id === first.ids[0]).trackId;
const lockedTrack = project.tracks.find(
  (track) =>
    track.id === project.clips.find((clip) => clip.id === lockedIds[0]).trackId,
);
lockedTrack.locked = true;
lockedTrack.hidden = true;
const ordinary = newText("titles", 0, 0, "普通文本");
ordinary.duration = 6;
ordinary.transform.y = 0.3;
project.clips.push(ordinary);
project.canvas = { width: 640, height: 360, fps: 30, background: "#142821" };
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
  const cues = () =>
    page.locator(`.track-lane[data-track="${trackId}"] .timeline-clip.caption`);
  const scope = () =>
    page.getByRole("checkbox", { name: "编辑字幕所有文字", exact: true });
  const font = () => page.getByLabel("字号", { exact: true });
  const save = async () => {
    await page.getByTitle("保存项目 Ctrl+S", { exact: true }).click();
    await expect(page.locator(".busy-overlay")).toHaveCount(0);
    await expect(page.locator(".project-save-state")).not.toContainText("*");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const main = (saved) =>
    first.ids.map((id) => saved.clips.find((clip) => clip.id === id));
  await expect(cues()).toHaveCount(3);
  await cues().nth(1).click();
  await expect(scope()).toBeChecked();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(3);
  const before = await save();
  await scope().uncheck();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(1);
  await expect(page.getByLabel("文本内容", { exact: true })).toHaveValue(
    "字幕乙",
  );
  await expect(page.locator(".project-save-state")).not.toContainText("*");
  await font().fill("52");
  await page.getByRole("switch", { name: "启用背景色", exact: true }).check();
  let saved = await save();
  expect(main(saved).map((clip) => clip.style.fontSize)).toEqual([40, 52, 40]);
  expect(main(saved).map((clip) => clip.style.fillEnabled)).toEqual([
    false,
    true,
    false,
  ]);
  for (const id of [first.ids[0], first.ids[2], lockedIds[0], ordinary.id])
    expect(saved.clips.find((clip) => clip.id === id)).toEqual(
      before.clips.find((clip) => clip.id === id),
    );
  await cues().nth(2).click();
  await expect(scope()).not.toBeChecked();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(1);
  await font().fill("60");
  await page.getByLabel("文本内容", { exact: true }).fill("只改第三句");
  saved = await save();
  expect(main(saved).map((clip) => clip.style.fontSize)).toEqual([40, 52, 60]);
  expect(main(saved).map((clip) => clip.text)).toEqual([
    "字幕甲",
    "字幕乙",
    "只改第三句",
  ]);
  await page.locator(".timeline-clip:not(.caption)").click();
  await expect(scope()).toHaveCount(0);
  // Selecting a cue from the caption list uses the same scope as the timeline.
  await page.getByRole("button", { name: "字幕", exact: true }).click();
  await page
    .locator(`.caption-row[data-clip-id="${first.ids[1]}"] textarea`)
    .click();
  await expect(scope()).not.toBeChecked();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(1);
  await expect(font()).toHaveValue("52");
  const layer = page.locator(
    `.canvas .preview-layer[data-clip-id="${first.ids[1]}"]`,
  );
  await expect(layer).toBeVisible();
  const bounds = await layer.boundingBox();
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 25, y - 25, { steps: 6 });
  await page.mouse.up();
  const moved = await save();
  expect(main(moved)[1].transform.x).toBeGreaterThan(
    main(saved)[1].transform.x,
  );
  expect(main(moved)[1].transform.y).toBeLessThan(main(saved)[1].transform.y);
  for (const clip of saved.clips.filter((clip) => clip.id !== first.ids[1]))
    expect(moved.clips.find((item) => item.id === clip.id)).toEqual(clip);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  expect((await save()).clips).toEqual(saved.clips);
  await expect(scope()).not.toBeChecked();
  await scope().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, "single-caption.png") });
  // Re-enabling linkage changes selection, and does not overwrite styles until an edit.
  await scope().check();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(3);
  expect(main(await save()).map((clip) => clip.style.fontSize)).toEqual([
    40, 52, 60,
  ]);
  await font().fill("48");
  saved = await save();
  expect(main(saved).map((clip) => clip.style.fontSize)).toEqual([48, 48, 48]);
  for (const id of [lockedIds[0], ordinary.id])
    expect(saved.clips.find((clip) => clip.id === id)).toEqual(
      before.clips.find((clip) => clip.id === id),
    );
  await scope().uncheck();
  await page
    .locator(`.caption-row[data-clip-id="${lockedIds[0]}"] .caption-time`)
    .click();
  await expect(scope()).toBeDisabled();
  await expect(font()).toBeDisabled();
  expect((await save()).clips).toEqual(saved.clips);
  await app.close();
  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(cues()).toHaveCount(3);
  await cues().first().click();
  await expect(scope()).toBeChecked();
  await scope().uncheck();
  await font().fill("42");
  expect(main(await save()).map((clip) => clip.style.fontSize)).toEqual([
    42, 48, 48,
  ]);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "默认整轨联动、单条字号与背景、切换字幕与普通文本、字幕列表选择、画布单条移动、撤销、重新联动、轨道隔离、锁定、保存重开",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  if (app)
    await (
      await app.firstWindow()
    )
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => { });
  console.error(root);
  throw error;
} finally {
  await app?.close();
}
