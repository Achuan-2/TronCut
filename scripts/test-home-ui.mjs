import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("test-output/home", `run-${Date.now()}`),
  profile = path.join(root, "profile"),
  savedFolder = path.join(root, "已保存项目");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(path.join(profile, "preferences.json"), JSON.stringify({
  storage: { projectDirectory: path.join(root, "Projects") },
}));
await fs.mkdir(savedFolder, { recursive: true });
await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#4c87b3" },
})
  .png()
  .toFile(path.join(savedFolder, "图片.png"));
const project = {
  format: "troncut",
  version: 1,
  id: "home",
  name: "中文测试项目",
  canvas: { width: 320, height: 180, fps: 30, background: "#101319" },
  tracks: [
    { id: "top", name: "轨道1", hidden: false, muted: false, locked: false },
  ],
  markers: [],
  assets: [
    {
      id: "image",
      name: "图片.png",
      path: "图片.png",
      kind: "image",
      duration: 5,
      width: 320,
      height: 180,
      hasAudio: false,
    },
  ],
  clips: [
    {
      id: "clip",
      trackId: "top",
      assetId: "image",
      kind: "image",
      name: "图片",
      start: 0,
      duration: 5,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 },
      keyframes: [],
    },
  ],
};
const savedFile = path.join(savedFolder, "中文测试项目.troncut");
await fs.writeFile(savedFile, JSON.stringify(project));
const recoveryFile = path.join(profile, "recovery.json"),
  recoveryText = JSON.stringify({
    project: {
      ...project,
      name: "未保存草稿",
      assets: project.assets.map((asset) => ({
        ...asset,
        path: path.join(savedFolder, asset.path),
      })),
    },
    file: savedFile,
  });
await fs.writeFile(recoveryFile, recoveryText);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.env.FRAMECRAFT_PACKAGED_SMOKE === "1";
const launch = () =>
  electron.launch({
    ...(packaged
      ? { executablePath: path.resolve(process.env.FRAMECRAFT_PACKAGED_APP) }
      : {}),
    args: packaged ? [] : ["."],
    env,
    timeout: 30000,
  });
let app;
try {
  app = await launch();
  let page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".home-page")).toBeVisible();
  await expect(page.locator(".home-page aside")).toHaveCount(0);
  const layout = await page.locator(".home-page").evaluate((home) => {
    const page = home.getBoundingClientRect();
    const content = home.querySelector(".home-content").getBoundingClientRect();
    return { pageWidth: page.width, contentWidth: content.width, leftGap: content.left - page.left };
  });
  expect(Math.abs(layout.pageWidth - layout.contentWidth)).toBeLessThan(1);
  expect(Math.abs(layout.leftGap)).toBeLessThan(1);
  await expect(page.getByRole("button", { name: "关于", exact: true })).toBeVisible();
  const version = await app.evaluate(({ app }) => app.getVersion());
  await app.evaluate(({ dialog, shell }) => {
    globalThis.aboutOriginalDialog = dialog.showMessageBox;
    globalThis.aboutOriginalExternal = shell.openExternal;
    globalThis.aboutResponse = 0;
    globalThis.aboutOpened = [];
    dialog.showMessageBox = async (_parent, options) => {
      globalThis.aboutOptions = options;
      return { response: globalThis.aboutResponse, checkboxChecked: false };
    };
    shell.openExternal = async (url) => { globalThis.aboutOpened.push(url); };
  });
  await page.getByRole("button", { name: "关于", exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.aboutOptions?.message)).toBe(`TronCut v${version}`);
  expect(await app.evaluate(() => globalThis.aboutOptions)).toMatchObject({
    title: "关于 TronCut",
    detail: "开发作者：Achuan-2\n项目 GitHub：https://github.com/Achuan-2/TronCut",
    buttons: ["关闭", "打开项目 GitHub"],
    cancelId: 0,
  });
  expect(await app.evaluate(() => globalThis.aboutOpened)).toEqual([]);
  await app.evaluate(() => { globalThis.aboutResponse = 1; });
  await page.getByRole("button", { name: "关于", exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.aboutOpened)).toEqual(["https://github.com/Achuan-2/TronCut"]);
  await app.evaluate(({ dialog, shell }) => {
    dialog.showMessageBox = globalThis.aboutOriginalDialog;
    shell.openExternal = globalThis.aboutOriginalExternal;
  });
  await expect(page.locator(".timeline")).toHaveCount(0);
  await expect(page.locator(".home-recovery")).toContainText("未保存草稿");
  await expect(page.locator(".recent-project")).toHaveCount(1); // old-version history migration
  await expect(page.locator(".recent-project")).toContainText("中文测试项目");
  await expect(page.locator(".recent-project-cover img")).toBeVisible();
  await expect(page.locator(".recent-project-cover")).toContainText("00:05");
  expect(await fs.readFile(recoveryFile, "utf8")).toBe(recoveryText);
  await page.waitForTimeout(2200);
  expect(await fs.readFile(recoveryFile, "utf8")).toBe(recoveryText);
  await page.screenshot({ path: path.join(root, "home-recent-projects.png") });
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await expect(page.getByLabel("工程名称")).toHaveValue("未保存草稿");
  await expect(page.getByRole("button", { name: "关于", exact: true })).toBeVisible();
  await expect(page.locator(".timeline-clip.image")).toHaveCount(1);
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await expect(page.locator(".home-page")).toBeVisible();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("工程名称")).toHaveValue("未保存草稿");
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  page.on("dialog", (dialog) => dialog.accept());
  await page.locator(".recent-project").click();
  await expect(page.getByLabel("工程名称")).toHaveValue("中文测试项目");
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await expect(page.locator(".timeline-clip")).toHaveCount(0);
  await page.getByLabel("工程名称").fill("从首页新建");
  await page.getByLabel("工程名称").press("Enter");
  await expect(page.getByRole("status")).toContainText("工程及文件夹已重命名");
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await app.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
  }, root);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("工程已保存", {
    timeout: 20000,
  });
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await expect(page.locator(".recent-project")).toHaveCount(2);
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, savedFile);
  await page.getByRole("button", { name: "打开项目", exact: true }).click();
  await expect(page.getByLabel("工程名称")).toHaveValue("中文测试项目");
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await expect(page.locator(".recent-project").first()).toContainText(
    "中文测试项目",
  );
  expect(errors).toEqual([]);
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  await expect(page.locator(".home-page")).toBeVisible();
  await expect(page.locator(".recent-project")).toHaveCount(2);
  await page
    .locator(".recent-project")
    .filter({ hasText: "从首页新建" })
    .click();
  await expect(page.getByLabel("工程名称")).toHaveValue("从首页新建");
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await fs.rename(savedFile, savedFile + ".moved");
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await expect(
    page.locator(".recent-project").filter({ hasText: "中文测试项目" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "新建录制", exact: true }).click();
  await expect(page.locator(".recorder-modal")).toBeVisible();
  await page.screenshot({ path: path.join(root, "home-new-recording.png") });
  console.log(
    `首页默认启动、旧版最近项目迁移、缩略图、手动恢复、返回/继续、空白新建、保存及重启持久化、缺失项目与新建录制通过：${root}`,
  );
} catch (error) {
  if (app)
    await (
      await app.firstWindow()
    )
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  if (app) await app.close();
}
