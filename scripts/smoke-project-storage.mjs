import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/project-storage/run-${Date.now()}`);
const profile = path.join(root, "profile");
const documents = path.join(root, "Documents");
await fs.mkdir(profile, { recursive: true });
await fs.mkdir(documents, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    project: { width: 1280, height: 720, fps: 60, background: "#101319" },
  }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app = await electron.launch({ args: ["."], env });
const errors = [];
try {
  // Keep test projects out of the user's Documents folder. Exercise the real
  // IPC/storage code while replacing only native dialogs and Explorer launch.
  await app.evaluate(({ app, dialog, shell }, documents) => {
    app.setPath("documents", documents);
    globalThis.storageSmoke = { dialogs: 0, selected: null, revealed: [] };
    dialog.showSaveDialog = async () => {
      const state = globalThis.storageSmoke;
      state.dialogs++;
      return {
        canceled: !state.selected,
        filePath: state.selected ?? undefined,
      };
    };
    shell.showItemInFolder = (file) =>
      globalThis.storageSmoke.revealed.push(file);
  }, documents);
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  const recent = () => page.evaluate(() => window.framecraft.recentProjects());
  const saved = async (file) => JSON.parse(await fs.readFile(file, "utf8"));
  const choose = (file) =>
    app.evaluate((_, file) => {
      globalThis.storageSmoke.selected = file;
    }, file);
  const menu = () => page.getByRole("menu", { name: "最近项目操作" });
  const card = (name) =>
    page
      .locator(".recent-project")
      .filter({
        has: page.locator("strong", { hasText: new RegExp(`^${name}$`) }),
      });
  const home = () =>
    page.getByRole("button", { name: "返回首页", exact: true }).click();

  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await expect(page.getByLabel("项目名称")).toHaveValue("未命名项目");
  const original = (await recent())[0].file;
  assert.equal(
    original,
    path.join(
      documents,
      "TronCut",
      "Projects",
      "未命名项目",
      "未命名项目.troncut",
    ),
  );
  assert.deepEqual((await saved(original)).canvas, {
    width: 1280,
    height: 720,
    fps: 60,
    background: "#101319",
  });
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("项目已保存");
  assert.equal((await saved(original)).clips.length, 1);
  assert.equal(await app.evaluate(() => globalThis.storageSmoke.dialogs), 0);

  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  await page.getByLabel("项目名称").click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "项目操作", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "另存为…" }).click();
  await expect
    .poll(() => app.evaluate(() => globalThis.storageSmoke.dialogs))
    .toBe(1);
  await expect(page.locator(".project-save-state")).toHaveText("*");
  assert.equal((await recent()).length, 1);
  assert.equal((await saved(original)).clips.length, 1);

  const selected = path.join(root, "Chosen", "作品副本.troncut");
  await choose(selected);
  await page.getByLabel("项目名称").click({ button: "right" });
  await page.getByRole("menuitem", { name: "另存为…" }).click();
  await expect(page.getByLabel("项目名称")).toHaveValue("作品副本");
  const copy = (await recent())[0].file;
  assert.equal(copy, path.join(root, "Chosen", "作品副本", "作品副本.troncut"));
  assert.equal((await saved(copy)).clips.length, 2);
  assert.equal((await saved(original)).clips.length, 1);

  await home();
  await card("未命名项目").click({ button: "right" });
  await expect(menu()).toBeVisible();
  await page.getByRole("menuitem", { name: "打开项目位置" }).click();
  await expect
    .poll(() => app.evaluate(() => globalThis.storageSmoke.revealed))
    .toEqual([original]);
  const originalContent = await fs.readFile(original, "utf8");
  await choose(path.join(root, "Other", "主页副本.troncut"));
  await card("未命名项目").click({ button: "right" });
  await page.getByRole("menuitem", { name: "另存为…" }).click();
  await expect(card("主页副本")).toBeVisible();
  assert.equal(await fs.readFile(original, "utf8"), originalContent);
  assert.equal((await saved((await recent())[0].file)).clips.length, 1);
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("项目名称")).toHaveValue("作品副本");

  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  await home();
  await choose(path.join(root, "Other", "当前编辑副本.troncut"));
  await card("作品副本").click({ button: "right" });
  await page.getByRole("menuitem", { name: "另存为…" }).click();
  await expect(card("当前编辑副本")).toBeVisible();
  assert.equal((await saved((await recent())[0].file)).clips.length, 3);
  assert.equal((await saved(copy)).clips.length, 2);

  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await expect(page.getByLabel("项目名称")).toHaveValue("未命名项目-2");
  await home();
  await card("未命名项目-2").click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(menu()).toHaveCount(0);
  await page.screenshot({ path: path.join(root, "recent-projects.png") });
  await assert.rejects(
    () =>
      page.evaluate(
        (file) => window.framecraft.showProjectLocation(file),
        path.join(root, "unregistered.troncut"),
      ),
    /项目不在最近项目列表/,
  );
  await page.getByRole("button", { name: "新建录制", exact: true }).click();
  await expect(page.locator(".recorder-modal")).toBeVisible();
  assert.equal((await recent())[0].name, "未命名项目-3");
  const files = (await recent()).map((entry) => entry.file);
  await app.close();
  app = await electron.launch({ args: ["."], env });
  const restarted = await app.firstWindow();
  restarted.on("pageerror", (error) => errors.push(error.message));
  await expect(restarted.locator(".recent-project")).toHaveCount(files.length);
  assert.deepEqual(
    await restarted.evaluate(async () =>
      (await window.framecraft.recentProjects()).map((entry) => entry.file),
    ),
    files,
  );
  assert.deepEqual(errors, []);
  console.log(
    `默认保存、项目设置、同名编号、取消/另存为、当前编辑副本、最近项目位置入口、新建录制和重启持久化通过：${root}`,
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => { });
  throw error;
} finally {
  await app.close();
}
