import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("test-output/project-media-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
const documents = path.join(root, "Documents");
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(documents, { recursive: true });
const image = path.join(root, "image.png");
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#71e6b5" },
})
  .png()
  .toFile(image);
const project = {
  format: "troncut",
  version: 1,
  id: "project-media-test",
  name: "项目媒体整理验收",
  canvas: { width: 1920, height: 1080, fps: 30, background: "#000000" },
  tracks: [
    { id: "track", name: "轨道1", hidden: false, locked: false, muted: false },
  ],
  markers: [],
  clips: [],
  assets: Array.from({ length: 6 }, (_, i) => ({
    id: `image-${i}`,
    name: `图片${i}.png`,
    path: image,
    kind: "image",
    duration: 0,
    width: 320,
    height: 180,
    hasAudio: false,
    ...(i === 5 ? { missing: true, path: path.join(root, "missing.png") } : {}),
  })),
};
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project, file: null }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
await app.evaluate(
  ({ app }, directory) => app.setPath("documents", directory),
  documents,
);
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const cards = page.locator(".asset-card");
const card = (i) => page.locator(`[data-asset-id="image-${i}"]`);
const selected = page.locator(".asset-card.selected");
const menu = page.getByRole("menu", { name: "媒体操作", exact: true });
const action = (name) => menu.getByRole("menuitem", { name, exact: true });
const undo = () => page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
const clips = page.locator(".timeline-clip.image");
const grouping = page.getByRole("combobox", { name: "素材分组", exact: true });
const save = async () => {
  const button = page.getByRole("button", { name: "保存", exact: true });
  await button.click();
  await expect(button).toBeEnabled();
  const file = path.join(
    documents,
    "TronCut",
    "Projects",
    project.name,
    `${project.name}.troncut`,
  );
  await expect
    .poll(() =>
      fs.access(file).then(
        () => true,
        () => false,
      ),
    )
    .toBe(true);
  return JSON.parse(await fs.readFile(file, "utf8"));
};
const nameDialog = async (value) => {
  const dialog = page.locator(".asset-library-dialog");
  await dialog
    .getByRole("textbox", { name: "文件夹名称", exact: true })
    .fill(value);
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog).toHaveCount(0);
};
try {
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await expect(cards).toHaveCount(6);
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await card(0).click();
  await card(2).click({ modifiers: ["Control"] });
  await expect(selected).toHaveCount(2);
  await card(2).click({ modifiers: ["Control"] });
  await expect(selected).toHaveCount(1);
  await card(1).click();
  await card(3).click({ modifiers: ["Shift"] });
  await expect(selected).toHaveCount(3);
  await card(5).click({ modifiers: ["Control"] });
  await card(4).click({ modifiers: ["Control", "Shift"] });
  await expect(selected).toHaveCount(5);
  await card(2).click({ button: "right" });
  await expect(selected).toHaveCount(5);
  await expect(action("添加 5 个素材到时间线")).toBeVisible();
  await expect(action("添加 5 个素材到时间线")).toBeDisabled();
  // Restore the file before the later save/persistence checks.
  await fs.copyFile(image, path.join(root, "missing.png"));
  await page.keyboard.press("Escape");
  await card(0).click({ button: "right" });
  await expect(selected).toHaveCount(1);
  await expect(action("替换时间轴上所选的媒体")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator(".ruler").click({ position: { x: 130, y: 15 } });
  await card(1).click();
  await card(3).click({ modifiers: ["Shift"] });
  await card(2).click({ button: "right" });
  await action("添加 3 个素材到时间线").click();
  await expect(clips).toHaveCount(3);
  const added = await save();
  expect(added.clips.map((clip) => clip.assetId)).toEqual([
    "image-1",
    "image-2",
    "image-3",
  ]);
  const first = added.clips[0].start;
  expect(first).toBeGreaterThan(0);
  expect(added.clips.map((clip) => clip.start)).toEqual([
    first,
    first + 5,
    first + 10,
  ]);
  await undo();
  await expect(clips).toHaveCount(0);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(clips).toHaveCount(3);

  await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
  await nameDialog("片头素材");
  await expect(grouping).toHaveValue("folder");
  let folder = page
    .locator(".library-folder-heading")
    .filter({ hasText: "片头素材" });
  await expect(folder).toBeVisible();
  await card(1).click();
  await card(3).click({ modifiers: ["Shift"] });
  await card(2).click({ button: "right" });
  await action("移至文件夹").hover();
  await page
    .getByRole("menu", { name: "移至文件夹", exact: true })
    .getByRole("menuitem", { name: "片头素材", exact: true })
    .click();
  await folder.click();
  await expect(page.locator(".library-folder-content .asset-card")).toHaveCount(
    3,
  );
  await card(1).click();
  await card(3).click({ modifiers: ["Shift"] });
  await card(2).click({ button: "right" });
  await action("删除 3 个素材").click();
  await expect(clips).toHaveCount(0);
  await expect(cards).toHaveCount(3);
  await undo();
  await expect(clips).toHaveCount(3);
  await expect(page.locator(".library-folder-content .asset-card")).toHaveCount(
    3,
  );
  await fs.access(image);

  await folder.click({ button: "right" });
  await action("重命名文件夹…").click();
  await nameDialog("已整理");
  folder = page
    .locator(".library-folder-heading")
    .filter({ hasText: "已整理" });
  await expect(folder).toBeVisible();
  await card(0).click();
  await card(4).click({ modifiers: ["Control"] });
  await card(0).dragTo(folder);
  await expect(page.locator(".library-folder-content .asset-card")).toHaveCount(
    5,
  );
  await undo();
  await expect(page.locator(".library-folder-content .asset-card")).toHaveCount(
    3,
  );
  const saved = await save();
  expect(saved.mediaFolders).toEqual([
    {
      id: saved.mediaFolders[0].id,
      name: "已整理",
      assetIds: ["image-1", "image-2", "image-3"],
    },
  ]);
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page
    .locator(".recent-project")
    .filter({ hasText: project.name })
    .click();
  await expect(folder).toBeVisible();
  await folder.click();
  await expect(page.locator(".library-folder-content .asset-card")).toHaveCount(
    3,
  );
  await page
    .getByRole("textbox", { name: "搜索素材", exact: true })
    .fill("已整理");
  await expect(cards).toHaveCount(3);
  await page.getByRole("textbox", { name: "搜索素材", exact: true }).fill("");
  await folder.click({ button: "right" });
  await action("删除文件夹…").click();
  await page
    .locator(".asset-library-dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(folder).toHaveCount(0);
  await expect(cards).toHaveCount(6);
  await expect(clips).toHaveCount(3);
  await undo();
  await expect(folder).toBeVisible();

  await page.getByRole("tab", { name: "素材库", exact: true }).click();
  await expect(grouping).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "素材类别", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "项目媒体", exact: true }).click();
  await expect(grouping).toHaveValue("folder");
  await page.screenshot({ path: path.join(root, "project-media-folders.png") });
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "Ctrl/Shift/Ctrl+Shift多选、右键保留选区、顺序批量添加/删除和一次撤销、文件夹创建/归档/重命名/删除/搜索、保存重开、素材库无分类控件",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app.close();
}
