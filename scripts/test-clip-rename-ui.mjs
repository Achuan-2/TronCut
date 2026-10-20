import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(`test-output/clip-rename-ui/run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const bundle = await build({
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
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const source = path.join(root, "source.png");
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#437fa8" },
})
  .png()
  .toFile(source);
let project = createProject("素材重命名测试");
project.assets = [
  {
    id: "image",
    path: path.basename(source),
    name: "source.png",
    kind: "image",
    width: 320,
    height: 180,
    duration: 0,
    hasAudio: false,
  },
];
project.clips = [
  {
    ...newText("video", 0),
    id: "first",
    kind: "image",
    assetId: "image",
    name: "source.png",
    duration: 3,
  },
  {
    ...newText("video", 4),
    id: "second",
    kind: "image",
    assetId: "image",
    name: "source.png",
    duration: 3,
  },
  { ...newText("titles", 0, 0, "画面文字"), id: "text", duration: 3 },
  { ...newText("audio", 0, 0, "锁定素材"), id: "locked", duration: 3 },
  { ...newText("titles", 5, 0, "组内文字"), id: "grouped", duration: 2 },
  { ...newText("titles", 8, 0, "组内文字二"), id: "grouped-two", duration: 2 },
];
project.tracks.find((track) => track.id === "audio").locked = true;
project = groupSelection(project, ["grouped", "grouped-two"]);
const groupId = project.clips.find((clip) => clip.id === "grouped").groupId;
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
await app.evaluate(
  ({ app }, directory) => app.setPath("documents", directory),
  path.join(root, "Documents"),
);
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const clip = (id) => page.locator(`.timeline-clip[data-clip-id="${id}"]`);
const dialog = page.getByRole("dialog", { name: "重命名素材", exact: true });
const input = dialog.getByLabel("素材名称", { exact: true });
const open = async (id) => {
  await clip(id).click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await expect(input).toBeFocused();
};
const save = async () => {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(page.locator(".project-save-state")).not.toContainText("*");
  return JSON.parse(await fs.readFile(file, "utf8"));
};
try {
  await expect(clip("first")).toBeVisible();
  await clip("first").click();
  await clip("second").click({ modifiers: ["Control"] });
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(2);
  await open("first");
  await expect(input).toHaveValue("source.png");
  expect(
    await input.evaluate(
      (element) => element.selectionEnd - element.selectionStart,
    ),
  ).toBe(10);
  await input.fill("   ");
  await expect(
    dialog.getByRole("button", { name: "保存名称", exact: true }),
  ).toBeDisabled();
  await input.fill("  开场画面  ");
  await input.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(clip("first").locator(".clip-label")).toContainText("开场画面");
  let saved = await save();
  expect(saved.clips).toEqual(
    project.clips.map((clip) =>
      clip.id === "first" ? { ...clip, name: "开场画面" } : clip,
    ),
  );
  expect(saved.assets).toEqual(
    project.assets.map((asset) => ({
      ...asset,
      path: "media/image-source.png",
    })),
  );
  expect(await fs.readFile(source)).toEqual(
    await fs.readFile(path.join(root, saved.assets[0].path)),
  );
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(clip("first").locator(".clip-label")).toContainText(
    "source.png",
  );
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(clip("first").locator(".clip-label")).toContainText("开场画面");
  // Saving the existing name must not consume an undo step.
  await open("first");
  await input.press("Enter");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(clip("first").locator(".clip-label")).toContainText(
    "source.png",
  );
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await open("first");
  await input.fill("取消的名称");
  await input.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(clip("first").locator(".clip-label")).toContainText("开场画面");
  await open("first");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await open("text");
  await input.fill("标题素材");
  await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(clip("text").locator(".clip-label")).toContainText("标题素材");
  await clip("locked").click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "重命名", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.locator(`.clip-group[data-group-id="${groupId}"]`).dblclick();
  await open("grouped");
  await input.fill("组内素材别名");
  await input.press("Enter");
  await expect(clip("grouped").locator(".clip-label")).toContainText(
    "组内素材别名",
  );
  saved = await save();
  expect(saved.clips.find((clip) => clip.id === "grouped")).toEqual({
    ...project.clips.find((clip) => clip.id === "grouped"),
    name: "组内素材别名",
  });
  expect(saved.clips.find((clip) => clip.id === "text").text).toBe("画面文字");
  await page.reload();
  await page.getByRole("button", { name: new RegExp(project.name) }).click();
  await expect(clip("first").locator(".clip-label")).toContainText("开场画面");
  await expect(clip("text").locator(".clip-label")).toContainText("标题素材");
  await page.locator(`.clip-group[data-group-id="${groupId}"]`).dblclick();
  await expect(clip("grouped").locator(".clip-label")).toContainText(
    "组内素材别名",
  );
  expect(errors).toEqual([]);
  console.log(
    `右键重命名、空白校验、取消、多选目标、锁定、撤销重做、组内编辑及保存重开通过：${root}`,
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
