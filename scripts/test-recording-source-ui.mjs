import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/recording-source-ui/run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: { projectDirectory: path.join(root, "Projects") },
  }),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
const launch = async (title = "TronCut source persistence fixture") => {
  app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const sourceId = await app.evaluate(async ({ BrowserWindow }, title) => {
    const target = new BrowserWindow({
      width: 400,
      height: 300,
      skipTaskbar: true,
    });
    await target.loadURL(
      `data:text/html,${encodeURIComponent(`<title>${title}</title><body>Recording source persistence</body>`)}`,
    );
    globalThis.sourcePersistenceFixture = target;
    return target.getMediaSourceId();
  }, title);
  await page.getByRole("button", { name: "新建录制", exact: true }).click();
  return { page, sourceId };
};
const closeSettings = async (page) => {
  await page.getByRole("button", { name: "关闭录制设置", exact: true }).click();
  await expect(page.locator(".recorder-modal")).toHaveCount(0);
};
const openSettings = async (page) => {
  await page.getByRole("button", { name: "录制", exact: true }).click();
  await expect(page.locator(".capture-sources > button.selected")).toHaveCount(
    1,
  );
};
const selected = (page) => page.locator(".capture-sources > button.selected");
try {
  let { page, sourceId } = await launch();
  const windowSource = page.locator(
    `.capture-sources > button[data-source-id="${sourceId}"]`,
  );
  await expect(windowSource).toBeVisible();
  await windowSource.click();
  await closeSettings(page);
  let preferences = JSON.parse(
    await fs.readFile(path.join(profile, "preferences.json"), "utf8"),
  );
  expect(preferences.recordingSource.id).toBe(sourceId);
  expect(preferences.recordingSource.thumbnail).toBeUndefined();
  await openSettings(page);
  await expect(selected(page)).toHaveAttribute("data-source-id", sourceId);
  // A live window keeps its identity when its document title changes.
  await closeSettings(page);
  await app.evaluate(() =>
    globalThis.sourcePersistenceFixture.webContents.executeJavaScript(
      "document.title = 'TronCut source persistence renamed'",
    ),
  );
  await openSettings(page);
  await expect(selected(page)).toHaveAttribute("data-source-id", sourceId);
  await closeSettings(page);
  await app.close();

  // A new window/native ID with the same remembered title is restored on restart.
  ({ page, sourceId } = await launch("TronCut source persistence renamed"));
  await expect(selected(page)).toHaveAttribute("data-source-id", sourceId);
  await page
    .locator(".recorder-modal")
    .screenshot({ path: path.join(root, "remembered-window.png") });
  await closeSettings(page);
  await app.evaluate(() => globalThis.sourcePersistenceFixture.close());
  await openSettings(page);
  await expect(selected(page)).not.toHaveAttribute("data-source-id", sourceId);
  const screen = page
    .locator('.capture-sources > button[data-source-id^="screen:"]')
    .first();
  await screen.click();
  const screenId = await screen.getAttribute("data-source-id");
  await closeSettings(page);
  await openSettings(page);
  await expect(selected(page)).toHaveAttribute("data-source-id", screenId);
  await closeSettings(page);
  preferences = JSON.parse(
    await fs.readFile(path.join(profile, "preferences.json"), "utf8"),
  );
  expect(preferences.recordingSource.id).toBe(screenId);
  expect(preferences.recordingSource.displayId).toBeTruthy();
  expect(errors).toEqual([]);
  console.log(
    `录制来源关闭重开、标题变化、应用重启、原窗口消失回退与屏幕记忆通过：${root}`,
  );
} finally {
  await app?.close();
}
