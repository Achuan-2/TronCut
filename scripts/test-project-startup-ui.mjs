import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/project-startup/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents: 'export { createProject, newText } from "./shared/model";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = createProject("从资源管理器打开");
project.clips = [newText("titles", 0, 0, "指定项目")];
const file = path.join(root, "中文 项目.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  // Exercise the real file-argument IPC and project parser before delaying the
  // renderer's startup response below to make transient homepage flashes visible.
  await expect(page.locator(".editor-workspace")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "项目名称", exact: true }),
  ).toHaveValue(project.name);
  await expect(page.locator(".home-page")).toHaveCount(0);
  await page.addInitScript(() => {
    window.startupViews = { home: false, recentLoading: false, startup: false };
    new MutationObserver(() => {
      if (document.querySelector(".home-page")) window.startupViews.home = true;
      if (document.body?.textContent.includes("正在读取最近项目"))
        window.startupViews.recentLoading = true;
      if (document.querySelector(".startup-screen"))
        window.startupViews.startup = true;
    }).observe(document, { childList: true, subtree: true });
  });
  async function scenario(mode) {
    await app.evaluate(
      ({ ipcMain }, { mode, result }) => {
        globalThis.startupCalls = { initial: 0, recent: 0 };
        ipcMain.removeHandler("project:initial");
        ipcMain.handle("project:initial", async () => {
          globalThis.startupCalls.initial++;
          await new Promise((resolve) => setTimeout(resolve, 900));
          if (mode === "failure") throw new Error("测试项目无法打开");
          return mode === "file" ? result : null;
        });
        ipcMain.removeHandler("project:recent");
        ipcMain.handle("project:recent", async () => {
          globalThis.startupCalls.recent++;
          return [];
        });
      },
      { mode, result: { project, file } },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".startup-screen")).toBeVisible();
    await expect(page.locator(".home-page")).toHaveCount(0);
    await expect(page.locator(".header-actions")).toBeHidden();
  }
  await scenario("file");
  await expect(page.locator(".editor-workspace")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "项目名称", exact: true }),
  ).toHaveValue(project.name);
  expect(await page.evaluate(() => window.startupViews)).toEqual({
    home: false,
    recentLoading: false,
    startup: true,
  });
  expect(await app.evaluate(() => globalThis.startupCalls)).toEqual({
    initial: 1,
    recent: 0,
  });
  await page.screenshot({ path: path.join(root, "direct-project.png") });

  await scenario("home");
  await expect(page.locator(".home-page")).toBeVisible();
  await expect(page.locator(".startup-screen")).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.startupCalls)).toEqual({
    initial: 1,
    recent: 1,
  });

  await scenario("failure");
  await expect(page.locator(".home-page")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("测试项目无法打开");
  await expect(page.locator(".startup-screen")).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    `文件参数直接打开、延迟启动无首页闪现、不读取最近项目、普通启动及打开失败回退通过：${root}`,
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app.close();
}
