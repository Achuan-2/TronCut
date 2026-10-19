import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { unzipSync } from "fflate";

const root = path.resolve("test-output/asset-library-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const image = path.join(root, "片头.png");
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#71e6b5" },
})
  .png()
  .toFile(image);
const project = {
  format: "troncut",
  version: 1,
  id: "asset-library-ui",
  name: "素材库验收",
  canvas: { width: 1920, height: 1080, fps: 30, background: "#000000" },
  tracks: [
    { id: "video", name: "轨道1", hidden: false, locked: false, muted: false },
  ],
  markers: [],
  clips: [],
  assets: [
    {
      id: "image",
      path: image,
      name: "片头.png",
      kind: "image",
      width: 320,
      height: 180,
      duration: 0,
      hasAudio: false,
    },
  ],
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
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const menu = page.getByRole("menu", { name: "媒体操作", exact: true });
const cards = page.locator(".asset-card");
const currentLibrary = page.getByRole("combobox", {
  name: "当前素材库",
  exact: true,
});
const libraries = () => page.evaluate(() => window.framecraft.assetLibraries());
const choose = async (target, action) => {
  await target.click({ button: "right" });
  await menu.getByRole("menuitem", { name: action, exact: true }).click();
};
const nameDialog = async (label, name) => {
  const dialog = page.locator(".asset-library-dialog");
  await dialog.getByRole("textbox", { name: label, exact: true }).fill(name);
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog).toHaveCount(0);
};
const dropInto = async (target, assetId) => {
  await target.evaluate((element, id) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(
      "troncut-library-asset",
      JSON.stringify({ libraryId: "default", assetId: id }),
    );
    element.dispatchEvent(
      new DragEvent("dragover", {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      }),
    );
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
    );
  }, assetId);
};
try {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 850),
  );
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await choose(cards.first(), "添加到素材库…");
  await page
    .locator(".asset-library-dialog")
    .getByRole("button", { name: "确定", exact: true })
    .click();
  await expect(page.locator(".asset-library-dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: "素材库", exact: true }).click();
  await expect(cards).toHaveCount(1);
  const source = (await libraries())[0].assets[0];
  await expect(
    page.getByRole("combobox", { name: "素材类别", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "素材分组", exact: true }),
  ).toHaveCount(0);

  // Blank-space menu, duplicate-name validation and nested folders.
  await choose(page.locator(".media-browser-items"), "新建文件夹…");
  await nameDialog("文件夹名称", "背景音");
  const parent = page.getByRole("button", {
    name: "展开文件夹 背景音",
    exact: true,
  });
  await expect(parent).toBeVisible();
  await page.getByRole("button", { name: "新建文件夹", exact: true }).click();
  await page
    .getByRole("textbox", { name: "文件夹名称", exact: true })
    .fill("背景音");
  await page
    .locator(".asset-library-dialog")
    .getByRole("button", { name: "确定", exact: true })
    .click();
  await expect(
    page.locator(".asset-library-dialog [role=alert]"),
  ).toContainText("同名");
  await page
    .locator(".asset-library-dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await choose(parent, "新建子文件夹…");
  await nameDialog("文件夹名称", "片头");
  await parent.click();
  const child = page.getByRole("button", {
    name: "展开文件夹 片头",
    exact: true,
  });
  await dropInto(child, source.id);
  await expect(page.locator(".library-folder-content .asset-card")).toHaveCount(
    1,
  );
  await expect
    .poll(
      async () =>
        (await libraries())[0].folders.find((folder) => folder.name === "片头")
          .assetIds,
    )
    .toEqual([source.id]);
  await choose(
    page.getByRole("button", { name: "折叠文件夹 片头", exact: true }),
    "重命名文件夹…",
  );
  await nameDialog("文件夹名称", "常用标题");
  await page
    .getByRole("textbox", { name: "搜索素材", exact: true })
    .fill("片头.png");
  await expect(cards).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "折叠文件夹 常用标题", exact: true }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "搜索素材", exact: true }).fill("");

  await choose(cards.first(), "重命名…");
  await nameDialog("素材名称", "常用片头");
  await expect(cards.first()).toContainText("常用片头");
  const assetArchive = path.join(root, "asset.zip");
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, assetArchive);
  await choose(cards.first(), "导出资产…");
  await expect
    .poll(() =>
      fs.stat(assetArchive).then(
        () => true,
        () => false,
      ),
    )
    .toBe(true);
  expect(Object.keys(unzipSync(await fs.readFile(assetArchive)))).toHaveLength(
    2,
  );

  // Add through the context menu at the current playhead, then preserve that project copy.
  await page.locator(".ruler").click({ position: { x: 130, y: 15 } });
  await choose(cards.first(), "添加到时间轴播放头所处位置");
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
  await expect
    .poll(() => fs.readdir(path.join(profile, "library-imports")))
    .toHaveLength(1);
  const projectCopy = path.join(
    profile,
    "library-imports",
    (await fs.readdir(path.join(profile, "library-imports")))[0],
  );

  await page.getByLabel("管理库", { exact: true }).click();
  await page.getByRole("menuitem", { name: "创建新库…", exact: true }).click();
  await nameDialog("库名称", "副库");
  const targetId = await currentLibrary.inputValue();
  await currentLibrary.selectOption("default");
  // New source mounts with folders collapsed; searching reveals descendants.
  await page
    .getByRole("textbox", { name: "搜索素材", exact: true })
    .fill("常用片头");
  await cards.first().click({ button: "right" });
  await menu.getByRole("menuitem", { name: "复制到", exact: true }).hover();
  await page.screenshot({ path: path.join(root, "folders-and-copy-menu.png") });
  await page
    .getByRole("menu", { name: "复制到库", exact: true })
    .getByRole("menuitem", { name: "副库", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await libraries()).find((item) => item.id === targetId).assets.length,
    )
    .toBe(1);
  expect((await libraries())[0].assets).toHaveLength(1);
  await cards.first().click({ button: "right" });
  await menu.getByRole("menuitem", { name: "移动至", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page
      .getByRole("menu", { name: "移动至库", exact: true })
      .getByRole("menuitem", { name: "副库", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(cards).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await libraries()).find((item) => item.id === targetId).assets.length,
    )
    .toBe(2);
  expect(
    (await libraries())[0].folders.every((folder) => !folder.assetIds.length),
  ).toBe(true);
  expect(await fs.readFile(projectCopy)).toEqual(await fs.readFile(image));

  // Import individual asset archive using the library importer.
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, assetArchive);
  await page.getByRole("textbox", { name: "搜索素材", exact: true }).fill("");
  await choose(page.locator(".media-browser-items"), "导入压缩库…");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("常用片头");
  await choose(cards.first(), "删除");
  await page
    .locator(".asset-library-dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(cards).toHaveCount(0);

  await currentLibrary.selectOption("default");
  await page
    .getByRole("button", { name: "展开文件夹 背景音", exact: true })
    .click();
  const titleFolder = page.getByRole("button", {
    name: "展开文件夹 常用标题",
    exact: true,
  });
  // Import directly into the library, then drag in and back to the root.
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, image);
  await page.getByRole("button", { name: "导入到库", exact: true }).click();
  await expect(cards).toHaveCount(1);
  const imported = (await libraries())[0].assets[0];
  await dropInto(titleFolder, imported.id);
  await expect(page.locator(".library-folder-content .asset-card")).toHaveCount(
    1,
  );
  await dropInto(
    page.getByRole("button", { name: "库根目录", exact: true }),
    imported.id,
  );
  await expect(page.locator(".library-folder-content .asset-card")).toHaveCount(
    0,
  );
  await expect(cards).toHaveCount(1);
  await choose(
    page.getByRole("button", { name: "折叠文件夹 背景音", exact: true }),
    "删除文件夹…",
  );
  await page
    .locator(".asset-library-dialog")
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "折叠文件夹 常用标题", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await page.getByRole("tab", { name: "素材库", exact: true }).click();
  await expect(currentLibrary).toHaveValue("default");
  await expect(
    page.getByRole("button", { name: "展开文件夹 常用标题", exact: true }),
  ).toBeVisible();
  await expect(cards).toHaveCount(1);
  await page
    .locator(".library")
    .screenshot({ path: path.join(root, "library-reopened.png") });
  expect(errors).toEqual([]);
  console.log(
    `素材库文件夹、拖入/移出、重命名、播放头添加、资产导出/导入、复制/移动子菜单、删除及重开持久化通过：${root}`,
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
