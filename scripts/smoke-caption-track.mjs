import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/caption-track-ui/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
// Use the production constructors for a project with independent caption tracks.
const bundled = await build({
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
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const first = appendCaptionCues(createProject("字幕轨道测试"), [
  { start: 0, end: 2, text: "字幕甲" },
  { start: 2, end: 4, text: "字幕乙" },
  { start: 4, end: 6, text: "字幕丙" },
]);
const second = appendCaptionCues(
  first.project,
  [{ start: 0, end: 6, text: "其他轨字幕" }],
  { newTrack: true },
);
const { project } = appendCaptionCues(
  second.project,
  [{ start: 0, end: 6, text: "锁定轨字幕" }],
  { newTrack: true },
);
const trackId = project.clips.find((clip) => clip.id === first.ids[0]).trackId;
for (const track of project.tracks.filter(
  (track) => track.captionTrack && track.id !== trackId,
)) {
  track.hidden = true;
  track.locked = project.clips.some(
    (clip) => clip.trackId === track.id && clip.text === "锁定轨字幕",
  );
}
const ordinary = newText("titles", 0, 0, "普通文本");
ordinary.transform.y = 0.3;
project.clips.push(ordinary);
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, file);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  const clips = page.locator(
    `.track-lane[data-track="${trackId}"] .timeline-clip.caption`,
  );
  await expect(clips).toHaveCount(3);
  await clips.nth(1).click();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(3);
  await expect(page.getByLabel("文本内容")).toHaveValue("字幕乙");
  await expect(page.getByLabel("字号", { exact: true })).toHaveValue("30");
  await page.getByLabel("字号", { exact: true }).fill("48");
  const save = async () => {
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("工程已保存");
    await expect(page.locator(".busy-overlay")).toHaveCount(0);
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const styled = await save();
  assert(
    styled.clips
      .filter((clip) => first.ids.includes(clip.id))
      .every((clip) => clip.style.fontSize === 48),
  );
  for (const clip of project.clips.filter(
    (clip) => !first.ids.includes(clip.id),
  ))
    assert.deepEqual(
      styled.clips.find((item) => item.id === clip.id),
      clip,
    );

  // Clicking another selected cue changes the current text without losing the track selection.
  await clips.nth(2).click();
  await expect(page.getByLabel("文本内容")).toHaveValue("字幕丙");
  await page.getByLabel("文本内容").fill("只修改丙");
  const edited = await save();
  assert.deepEqual(
    edited.clips
      .filter((clip) => first.ids.includes(clip.id))
      .map((clip) => clip.text),
    ["字幕甲", "字幕乙", "只修改丙"],
  );

  // Seek to the first cue, deselect, then select and move it directly on canvas.
  const ruler = await page.locator(".ruler").boundingBox();
  await page.mouse.click(ruler.x + 65, ruler.y + 15);
  await page.locator(".timeline-clip:not(.caption)").click();
  const layer = page
    .locator(".preview-layer.text")
    .filter({ hasText: "字幕甲" });
  await layer.click();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(3);
  const bounds = await layer.boundingBox();
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y - 35, { steps: 8 });
  await page.mouse.up();
  const moved = await save();
  const captions = moved.clips.filter((clip) => first.ids.includes(clip.id));
  assert(
    captions.every(
      (clip) =>
        clip.transform.x === captions[0].transform.x &&
        clip.transform.y === captions[0].transform.y,
    ),
  );
  assert(captions[0].transform.x > 0.5);
  assert(captions[0].transform.y < 0.92);
  assert(captions.every((clip) => clip.keyframes.length === 0));
  for (const clip of edited.clips.filter(
    (clip) => !first.ids.includes(clip.id),
  ))
    assert.deepEqual(
      moved.clips.find((item) => item.id === clip.id),
      clip,
    );
  await page.screenshot({ path: path.join(root, "track-moved.png") });
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  assert.deepEqual((await save()).clips, edited.clips);

  // A track header also selects the entire track; ordinary text still selects individually.
  await page.locator(".timeline-clip:not(.caption)").click();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(1);
  await page
    .locator(".track-header.caption-track")
    .nth(2)
    .locator(".track-name")
    .click();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(3);
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ root, errors, position: captions[0].transform }, null, 2),
  );
  console.log(
    "字幕整轨选择、默认样式、批量样式、独立文字编辑、画布整轨移动、撤销及轨道隔离通过",
  );
} finally {
  await app.close();
}
