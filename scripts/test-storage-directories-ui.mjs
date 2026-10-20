import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(
  "test-output/storage-directories-ui",
  `run-${Date.now()}`,
);
const profile = path.join(root, "profile");
const directories = {
  backupDirectory: path.join(root, "备份"),
  onnxModelsDirectory: path.join(root, "模型"),
  projectDirectory: path.join(root, "项目"),
};
await fs.mkdir(path.join(profile, "models/onnx/sensevoice-small"), {
  recursive: true,
});
await fs.writeFile(
  path.join(profile, "models/onnx/sensevoice-small/model.int8.onnx"),
  "fixture-model",
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
async function launch() {
  app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "编辑", exact: true }),
  ).toBeVisible();
  return page;
}
async function preferences(page, tab = "程序") {
  await app.evaluate(({ Menu, BrowserWindow }) => {
    Menu.getApplicationMenu()
      .getMenuItemById("edit-preferences")
      .click(null, BrowserWindow.getAllWindows()[0], {});
  });
  await page.getByRole("tab", { name: tab, exact: true }).click();
}
async function choose(page, label, directory) {
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: directory === null,
      filePaths: directory ? [directory] : [],
    });
  }, directory);
  await page
    .getByLabel(label, { exact: true })
    .locator(".. ")
    .locator("..")
    .getByRole("button", { name: "选择文件夹", exact: true })
    .click();
  if (directory)
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(
      directory,
    );
}
async function save(page) {
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
try {
  let page = await launch();
  await preferences(page);
  await expect(page.getByLabel("备份文件夹", { exact: true })).toHaveValue(
    profile,
  );
  await choose(page, "备份文件夹", null);
  await expect(page.getByLabel("备份文件夹", { exact: true })).toHaveValue(
    profile,
  );
  await choose(page, "备份文件夹", directories.backupDirectory);
  await page.getByRole("tab", { name: "高级", exact: true }).click();
  await choose(page, "ONNX 模型文件夹", directories.onnxModelsDirectory);
  await page.getByRole("tab", { name: "项目", exact: true }).click();
  await choose(page, "默认项目创建位置", directories.projectDirectory);
  await page.screenshot({ path: path.join(root, "project.png") });
  await save(page);
  expect(
    (await page.evaluate(() => window.framecraft.preferences())).storage,
  ).toEqual(directories);
  expect(
    await fs.readFile(
      path.join(
        directories.onnxModelsDirectory,
        "sensevoice-small/model.int8.onnx",
      ),
      "utf8",
    ),
  ).toBe("fixture-model");

  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.framecraft.readRecovery()))?.project
          .clips.length,
    )
    .toBe(1);
  const recovery = await page.evaluate(() => window.framecraft.readRecovery());
  expect(
    recovery.file.startsWith(directories.projectDirectory + path.sep),
  ).toBe(true);
  expect((await fs.stat(recovery.file)).isFile()).toBe(true);
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(directories.backupDirectory, "recovery.json"),
        "utf8",
      ),
    ),
  ).toMatchObject({ file: recovery.file });

  await preferences(page);
  directories.backupDirectory = path.join(root, "新备份");
  await choose(page, "备份文件夹", directories.backupDirectory);
  await page.screenshot({ path: path.join(root, "backup.png") });
  await save(page);
  expect(
    (await page.evaluate(() => window.framecraft.readRecovery())).project.clips,
  ).toHaveLength(1);
  expect(
    (
      await fs.stat(path.join(directories.backupDirectory, "recovery.json"))
    ).isFile(),
  ).toBe(true);

  await preferences(page, "高级");
  let opened;
  await app.evaluate(({ shell }) => {
    globalThis.storageOpened = "";
    shell.openPath = async (directory) => {
      globalThis.storageOpened = directory;
      return "";
    };
  });
  await page
    .getByRole("button", {
      name: "ONNX 模型文件夹：打开当前文件夹",
      exact: true,
    })
    .click();
  opened = await app.evaluate(() => globalThis.storageOpened);
  expect(opened).toBe(directories.onnxModelsDirectory);
  await page.screenshot({ path: path.join(root, "models.png") });
  await page
    .getByRole("button", { name: "ONNX 模型文件夹：恢复默认", exact: true })
    .click();
  await expect(page.getByLabel("ONNX 模型文件夹", { exact: true })).toHaveValue(
    path.join(profile, "models/onnx"),
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    (await page.evaluate(() => window.framecraft.preferences())).storage,
  ).toEqual(directories);
  await app.close();

  page = await launch();
  expect(
    (await page.evaluate(() => window.framecraft.preferences())).storage,
  ).toEqual(directories);
  expect(
    (await page.evaluate(() => window.framecraft.recoveryInfo())).name,
  ).toBe(recovery.project.name);
  await preferences(page, "项目");
  await expect(
    page.getByLabel("默认项目创建位置", { exact: true }),
  ).toHaveValue(directories.projectDirectory);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  const restored = await page.evaluate(() => window.framecraft.readRecovery());
  await page.evaluate(
    (project) => window.framecraft.saveProject(project, false),
    restored.project,
  );
  await expect
    .poll(async () => page.evaluate(() => window.framecraft.recoveryInfo()))
    .toBe(null);
  await expect(
    page.getByRole("button", { name: "新建项目", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  await expect
    .poll(async () =>
      (
        await page.evaluate(() => window.framecraft.readRecovery())
      )?.file.startsWith(directories.projectDirectory + path.sep),
    )
    .toBe(true);
  expect(errors).toEqual([]);
  console.log(
    `存储目录选择、取消、迁移、打开、恢复默认、重启持久化、新建项目和备份保存清理通过：${root}`,
  );
} catch (error) {
  await app
    ?.windows()[0]
    ?.screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app?.close();
}
