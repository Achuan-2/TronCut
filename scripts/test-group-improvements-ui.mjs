import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimelineZoom, timelineZoom } from "./timeline-zoom.mjs";

const root = path.resolve(
  `test-output/group-improvements-ui/run-${Date.now()}`,
);
const profile = path.join(root, "profile");
const documents = path.join(root, "Documents");
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(documents, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export { createProject, newText, newTrack } from "./shared/model"; export { groupSelection } from "./shared/timeline";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, newTrack, groupSelection } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
let project = createProject("组合轨道与时间区间");
project.tracks.push(
  { ...newTrack(3), id: "spare" },
  { ...newTrack(4), id: "locked", locked: true },
);
for (const track of project.tracks) track.height = 48;
project.clips = [
  { ...newText("titles", 12, 0, "组内甲"), id: "first", duration: 4 },
  { ...newText("video", 15, 0, "组内乙"), id: "second", duration: 5 },
  { ...newText("audio", 26, 0, "组外素材"), id: "outside", duration: 3 },
];
project = groupSelection(project, ["first", "second"]);
const id = project.clips[0].groupId;
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
const page = await app.firstWindow();
await app.evaluate(({ app, BrowserWindow }, directory) => {
  app.setPath("documents", directory);
  BrowserWindow.getAllWindows()[0].setSize(1440, 1000);
}, documents);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const group = () => page.locator(`.clip-group[data-group-id="${id}"]`);
const track = (id) => page.locator(`.track-lane[data-track="${id}"]`);
const anchor = () =>
  group().evaluate((element) => element.closest(".track-lane").dataset.track);
const save = async () => {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(page.locator(".project-save-state")).not.toContainText("*");
  return JSON.parse(await fs.readFile(file, "utf8"));
};
const dragTo = async (id) => {
  const from = await group().boundingBox();
  const to = await track(id).boundingBox();
  await page.mouse.move(from.x + 20, from.y + 15);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, to.y + 15, { steps: 12 });
  await page.mouse.up();
};
const seek = async (time) => {
  const ruler = await page.locator(".ruler").boundingBox();
  await page.mouse.click(
    ruler.x + time * (await timelineZoom(page)),
    ruler.y + 25,
  );
};
const start = page.getByRole("slider", { name: "范围起点", exact: true });
try {
  await expect(group()).toBeVisible();
  await setTimelineZoom(page, 40);
  await dragTo("audio");
  await expect.poll(anchor).toBe("audio");
  let saved = await save();
  expect(saved.clips.find((clip) => clip.id === "first")).toMatchObject({
    start: 12,
    trackId: "audio",
  });
  expect(saved.clips.find((clip) => clip.id === "second")).toMatchObject({
    start: 15,
    trackId: "spare",
  });
  expect(saved.clips.find((clip) => clip.id === "outside")).toEqual(
    project.clips[2],
  );
  await dragTo("locked");
  await expect.poll(anchor).toBe("audio");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect.poll(anchor).toBe("titles");
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect.poll(anchor).toBe("audio");
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "moved-group.png") });
  await group().dblclick();
  await expect(
    page.getByRole("tab", { name: "组合 1", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await setTimelineZoom(page, 40);
  await expect(page.locator(".group-timeline-mask")).toHaveCount(2);
  await expect(page.locator(".group-timeline-mask.before")).toHaveAttribute(
    "data-start",
    "12",
  );
  await expect(page.locator(".group-timeline-mask.after")).toHaveAttribute(
    "data-end",
    "20",
  );
  await expect(start).toHaveAttribute("aria-valuemin", "12");
  await expect(start).toHaveAttribute("aria-valuemax", "20");
  await expect(start).toHaveAttribute("aria-valuenow", "12");
  expect(
    await page
      .locator('.timeline-clip[data-clip-id="first"]')
      .evaluate((element) => parseFloat(element.style.left)),
  ).toBeCloseTo(480, 1);
  expect(
    await page
      .locator('.timeline-clip[data-clip-id="second"]')
      .evaluate((element) => parseFloat(element.style.left)),
  ).toBeCloseTo(600, 1);
  await expect(
    page.locator('.timeline-clip[data-clip-id="outside"]'),
  ).toHaveCount(0);
  await seek(15);
  await expect
    .poll(async () => Number(await start.getAttribute("aria-valuenow")))
    .toBeCloseTo(15, 6);
  const scroll = await page.locator(".timeline-scroll").boundingBox();
  await page.mouse.click(scroll.x + 10, scroll.y + 50);
  await expect
    .poll(async () => Number(await start.getAttribute("aria-valuenow")))
    .toBeCloseTo(15, 6);
  // Both timeline handles and the preview slider stay inside the group range.
  await start.focus();
  await start.press("Home");
  await expect(start).toHaveAttribute("aria-valuenow", "12");
  const end = page.getByRole("slider", { name: "范围终点", exact: true });
  await end.focus();
  await end.press("End");
  await expect(end).toHaveAttribute("aria-valuenow", "20");
  await end.press("ArrowRight");
  await expect(end).toHaveAttribute("aria-valuenow", "20");
  await page.getByRole("button", { name: "播放头", exact: true }).dblclick();
  await expect(start).toHaveAttribute("aria-valuenow", "20");
  const progress = page.getByRole("slider", { name: "播放进度", exact: true });
  await expect(progress).toHaveAttribute("min", "12");
  await expect(progress).toHaveAttribute("max", "20");
  await progress.focus();
  await progress.press("Home");
  await expect(start).toHaveAttribute("aria-valuenow", "12");
  await seek(19.8);
  await page.getByTitle("播放 / 暂停（空格）", { exact: true }).click();
  await expect(start).toHaveAttribute("aria-valuenow", "20");
  await expect(page.locator(".play-button .lucide-play")).toBeVisible();
  await seek(15);
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "group-range.png") });
  await save();
  await page.getByRole("tab", { name: "主时间线", exact: true }).click();
  await setTimelineZoom(page, 40);
  await expect.poll(anchor).toBe("audio");
  await expect(page.locator(".group-timeline-mask")).toHaveCount(0);
  await expect(
    page.locator('.timeline-clip[data-clip-id="outside"]'),
  ).toHaveCount(1);
  await page.reload();
  await page.getByRole("button", { name: new RegExp(project.name) }).click();
  await expect.poll(anchor).toBe("audio");
  await group().dblclick();
  await expect(page.locator(".group-timeline-mask.after")).toHaveAttribute(
    "data-end",
    "20",
  );
  expect(errors).toEqual([]);
  console.log(
    `组合跨轨道拖动、锁定保护、撤销重做、主时间线刻度、灰区禁用、范围/进度/播放限制与保存重开通过：${root}`,
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
