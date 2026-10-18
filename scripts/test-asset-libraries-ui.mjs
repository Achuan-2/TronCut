import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";

const root = path.resolve(
  "test-output/asset-libraries-ui",
  `run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const helpers = path.join(root, "helpers.cjs");
await build({
  stdin: {
    contents:
      'export { createProject } from "./shared/model"; export { probeMedia } from "./electron/media";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
  outfile: helpers,
});
const { createProject, probeMedia } = createRequire(import.meta.url)(helpers);
const source = path.join(root, "常用背景.png");
await sharp({
  create: { width: 640, height: 360, channels: 3, background: "#328260" },
})
  .png()
  .toFile(source);
const project = createProject("素材库管理验收");
project.assets = [await probeMedia(source)];
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
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 850),
  );
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  const cards = page.locator(".asset-card");
  const selector = page.getByRole("combobox", {
    name: "当前素材库",
    exact: true,
  });
  const manage = page.locator(".asset-library-management > summary");
  const dialog = () => page.getByRole("dialog");
  const libraryTab = page.getByRole("tab", { name: "素材库", exact: true });
  const projectTab = page.getByRole("tab", { name: "项目媒体", exact: true });
  const confirm = () =>
    dialog().getByRole("button", { name: "确定", exact: true }).click();
  const chooseFile = async (file) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, file);

  // Save existing project media into the default library through its context menu.
  await cards.first().click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "添加到素材库…", exact: true })
    .click();
  await expect(
    dialog().getByRole("combobox", { name: "目标素材库" }),
  ).toHaveValue("default");
  await confirm();
  await expect(dialog()).toHaveCount(0);
  await libraryTab.click();
  await expect(cards).toHaveCount(1);
  await manage.click();
  await expect(
    page.getByRole("menuitem", { name: "删除库…", exact: true }),
  ).toBeDisabled();
  await page.getByRole("menuitem", { name: "创建新库…", exact: true }).click();
  await dialog().getByRole("textbox", { name: "库名称" }).fill("常用片头");
  await confirm();
  await expect(selector.locator("option:checked")).toHaveText("常用片头");
  await expect(cards).toHaveCount(0);

  // Renaming rejects conflicts while keeping the editor dialog open.
  await manage.click();
  await page.getByRole("menuitem", { name: "重命名库…", exact: true }).click();
  await dialog().getByRole("textbox", { name: "库名称" }).fill("默认");
  await confirm();
  await expect(dialog().getByRole("alert")).toContainText("同名");
  await dialog().getByRole("textbox", { name: "库名称" }).fill("常用素材");
  await confirm();
  await expect(selector.locator("option:checked")).toHaveText("常用素材");
  await chooseFile(source);
  await page.getByRole("button", { name: "导入到库", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator("img")).toBeVisible();
  await page
    .locator(".library")
    .screenshot({ path: path.join(root, "library.png") });
  const selected = await selector.inputValue();
  const drag = await cards.first().evaluate((element) => {
    const dataTransfer = new DataTransfer();
    element.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer }),
    );
    return JSON.parse(dataTransfer.getData("troncut-library-asset"));
  });
  expect(drag.libraryId).toBe(selected);
  await cards.first().dblclick();
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
  await cards
    .first()
    .dragTo(page.locator(".track-lane").first(), {
      targetPosition: { x: 180, y: 20 },
    });
  await expect(page.locator(".timeline-clip.image")).toHaveCount(2);
  // Recovery is debounced; wait for it before exercising renderer restart.
  await expect
    .poll(
      async () => {
        const saved = JSON.parse(
          await fs.readFile(path.join(profile, "recovery.json"), "utf8"),
        );
        return saved.project.clips.length;
      },
      { timeout: 15000 },
    )
    .toBe(2);
  await projectTab.click();
  await expect(cards).toHaveCount(2); // One original and one reusable project copy.
  await libraryTab.click();

  // Export includes the file; cancellation leaves the library unchanged.
  const archive = path.join(root, "常用素材.zip");
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  }, archive);
  await manage.click();
  await page.getByRole("menuitem", { name: "导出库…", exact: true }).click();
  await expect
    .poll(async () =>
      fs.stat(archive).then(
        (stat) => stat.size,
        () => 0,
      ),
    )
    .toBeGreaterThan(100);
  await expect(page.getByRole("status")).toContainText("素材库已导出");
  await manage.click();
  await page
    .locator(".library")
    .screenshot({ path: path.join(root, "management.png") });
  await page.getByRole("menuitem", { name: "删除库…", exact: true }).click();
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  await expect(selector).toHaveValue(selected);
  await manage.click();
  await page.getByRole("menuitem", { name: "删除库…", exact: true }).click();
  await dialog().getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(selector).toHaveValue("default");
  await expect(page.locator(".timeline-clip.image")).toHaveCount(2);
  const saved = JSON.parse(
    await fs.readFile(path.join(profile, "recovery.json"), "utf8"),
  );
  for (const asset of saved.project.assets) await fs.access(asset.path);
  await chooseFile(archive);
  await manage.click();
  await page
    .getByRole("menuitem", { name: "导入压缩库…", exact: true })
    .click();
  await expect(selector.locator("option:checked")).toHaveText("常用素材");
  await expect(cards).toHaveCount(1);
  expect(await selector.inputValue()).not.toBe(selected);

  // Restart the renderer to check persistence and item removal separately from project deletion.
  await page.reload();
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await libraryTab.click();
  await expect(selector.locator("option:checked")).toHaveText("常用素材");
  await expect(cards).toHaveCount(1);
  await cards.first().click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "从素材库移除…", exact: true })
    .click();
  await dialog().getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(cards).toHaveCount(0);
  await expect(page.locator(".timeline-clip.image")).toHaveCount(2);
  expect(errors).toEqual([]);
  console.log(
    `素材库创建、切换、名称校验、文件导入、项目媒体入库、双击和拖拽复用、ZIP导入导出、持久化和删除隔离通过：${root}`,
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
