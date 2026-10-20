import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/group-timeline/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const documents = path.join(root, "Documents");
await fs.mkdir(documents, { recursive: true });
const bundled = await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { groupSelection } from "./shared/timeline";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, groupSelection } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
let project = createProject("组合时间线测试");
for (const track of project.tracks) track.height = 48;
project.clips = [
  { ...newText("titles", 4, 0, "组内甲"), duration: 4 },
  { ...newText("video", 5, 0, "组内乙"), duration: 4 },
  { ...newText("audio", 14, 0, "组外素材"), duration: 3 },
];
project = groupSelection(
  project,
  project.clips.slice(0, 2).map((clip) => clip.id),
);
const groupId = project.clips[0].groupId;
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let app;
try {
  app = await electron.launch({ args: [".", file], env });
  let page = await app.firstWindow();
  await app.evaluate(({ app }, directory) => app.setPath("documents", directory), documents);
  page.on("pageerror", (error) => errors.push(error.message));
  const command = (name) =>
    app.evaluate(({ BrowserWindow }, command) => {
      BrowserWindow.getAllWindows()[0].webContents.send("shortcut", command);
    }, name);
  const group = () => page.locator(`.clip-group[data-group-id="${groupId}"]`);
  const main = () => page.getByRole("tab", { name: "主时间线", exact: true });
  await expect(group()).toHaveCount(1);
  await expect(page.locator('.timeline-tabs [role="tab"]')).toHaveCount(0);
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await expect(group()).toContainText("2 个媒体");
  const groupBounds = await group().boundingBox();
  await page.mouse.move(groupBounds.x + 20, groupBounds.y + 18);
  await page.mouse.down();
  await page.mouse.move(groupBounds.x + 85, groupBounds.y + 18, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() => group().evaluate((element) => parseFloat(element.style.left)))
    .toBe(325);

  await page.locator(".timeline-scroll").evaluate((element) => {
    element.scrollLeft = 100;
  });
  await group().dblclick();
  await expect
    .poll(() =>
      page
        .locator(".timeline-scroll")
        .evaluate((element) => element.scrollLeft),
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByRole("tab", { name: "组合 1", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await expect(page.locator(".clip-group")).toHaveCount(0);
  const first = page.locator(
    `.timeline-clip[data-clip-id="${project.clips[0].id}"]`,
  );
  // Undoing a main-timeline move keeps the group's document time coordinates.
  await command("undo");
  await expect
    .poll(() =>
      page
        .locator(`.timeline-clip[data-clip-id="${project.clips[1].id}"]`)
        .evaluate((element) => parseFloat(element.style.left)),
    )
    .toBe(325);
  await expect
    .poll(() => first.evaluate((element) => parseFloat(element.style.left)))
    .toBe(260);
  await first.click();
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(1);
  await page.getByLabel("文本内容", { exact: true }).fill("已编辑的组内甲");

  // Saving from a group tab must serialize the complete document in global time.
  await command("save");
  await expect(page.getByRole("status")).toContainText("项目已保存");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(saved.clips.length, 3);
  assert.equal(
    saved.clips.find((clip) => clip.id === project.clips[0].id).start,
    4,
  );
  assert.equal(
    saved.clips.find((clip) => clip.id === project.clips[0].id).text,
    "已编辑的组内甲",
  );
  assert.equal(
    saved.clips.find((clip) => clip.id === project.clips[2].id).text,
    "组外素材",
  );

  await main().click();
  await expect(group()).toHaveCount(1);
  await group().click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名组", exact: true }).click();
  await page.getByLabel("组合名称", { exact: true }).fill("开场画面");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(group()).toContainText("开场画面");
  await expect(
    page.getByRole("tab", { name: "开场画面", exact: true }),
  ).toHaveCount(1);
  await command("undo");
  await expect(group()).toContainText("组合 1");
  await command("redo");
  await expect(group()).toContainText("开场画面");

  await group().click({ button: "right" });
  await page.getByRole("menuitem", { name: "打开组", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "开场画面", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await page
    .getByRole("button", { name: "关闭开场画面时间线", exact: true })
    .click();
  await expect(page.locator('.timeline-tabs [role="tab"]')).toHaveCount(0);
  await expect(group()).toHaveCount(1);
  await group().dblclick();
  await expect(page.locator('.timeline-tabs [role="tab"]')).toHaveCount(2);
  await command("save");
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(file, "utf8")).groups.find(
          (group) => group.id === groupId,
        ).name,
    )
    .toBe("开场画面");
  await page.screenshot({ path: path.join(root, "group-timeline.png") });
  await app.close();

  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  await app.evaluate(({ app }, directory) => app.setPath("documents", directory), documents);
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(group()).toContainText("开场画面");
  await group().dblclick();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await page
    .locator(`.timeline-clip[data-clip-id="${project.clips[0].id}"]`)
    .click();
  await expect(page.getByLabel("文本内容", { exact: true })).toHaveValue(
    "已编辑的组内甲",
  );
  await main().click();
  await page.screenshot({ path: path.join(root, "main-timeline.png") });
  assert.deepEqual(errors, []);
  console.log(
    `组合折叠、双击打开、独立编辑、右键打开与重命名、撤销重做、关闭及保存重开通过：${root}`,
  );
} catch (error) {
  if (app)
    await (
      await app.firstWindow()
    )
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => { });
  console.log(root);
  throw error;
} finally {
  if (app) await app.close();
}
