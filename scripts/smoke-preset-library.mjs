import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(`test-output/preset-library-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
await sharp({
  create: { width: 160, height: 90, channels: 3, background: "#61c49a" },
})
  .png()
  .toFile(path.join(root, "image.png"));
const bundle = await build({
  stdin: {
    contents:
      'export {createProject,newText} from "./shared/model"; export {createBehavior} from "./shared/behaviors";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, createBehavior } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = createProject("行为预设与收藏");
project.assets = [
  {
    id: "image",
    path: "image.png",
    name: "图片",
    kind: "image",
    width: 160,
    height: 90,
    duration: 0,
    hasAudio: false,
  },
];
project.clips = [
  {
    ...newText("titles", 0, 0, "ABC 自定义预设"),
    behaviors: [createBehavior("type-reveal", 5)],
  },
  {
    ...newText("video", 0),
    kind: "image",
    assetId: "image",
    text: undefined,
    style: undefined,
  },
];
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ args: [".", file], env });
let app = await launch();
const errors = [];
const storage = (page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("troncut.preset-library")),
  );
const saveProject = async (page) => {
  await page.getByTitle("保存项目 Ctrl+S").click();
  await expect(page.locator(".toast")).toContainText("项目已保存");
  return JSON.parse(await fs.readFile(file, "utf8"));
};
try {
  let page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  const rail = page.locator(".tool-rail");
  await page.locator(".timeline-clip.text").click();
  await page.locator(".clip-behavior-effect").click();
  await page.getByLabel("行为速度（%）").fill("88");
  await page.getByLabel("逐字偏移（秒）").fill("0.05");
  await page.getByRole("tab", { name: "期间", exact: true }).click();
  await page.getByLabel("行为样式").selectOption("pulse");
  await page.getByLabel("永远循环").uncheck();
  await page.getByLabel("行为循环次数").fill("3");
  await page.getByLabel("行为循环延迟（秒）").fill("0.2");
  await page.getByRole("tab", { name: "出", exact: true }).click();
  await page.getByLabel("行为样式").selectOption("none");
  await page
    .locator(".behavior-property .speed-heading")
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "添加预设", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加行为预设" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("预设名称", { exact: true })).toHaveValue(
    "文字逐个显示-显示",
  );
  await page.getByLabel("预设名称", { exact: true }).fill(" ");
  await expect(
    dialog.getByRole("button", { name: "确定", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("预设名称", { exact: true }).fill("我的文字显示");
  // A failed write must retain the dialog and entered name for retry.
  await page.evaluate(() => {
    window.presetSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "troncut.preset-library")
        throw new DOMException("Storage full", "QuotaExceededError");
      return window.presetSetItem.call(this, key, value);
    };
  });
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("保存失败");
  await expect(page.getByLabel("预设名称", { exact: true })).toHaveValue(
    "我的文字显示",
  );
  await page.evaluate(() => {
    Storage.prototype.setItem = window.presetSetItem;
    delete window.presetSetItem;
  });
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const custom = (await storage(page)).customBehaviors[0];
  expect(custom.incoming).toMatchObject({ speed: 88, offset: 0.05 });
  expect(custom.during).toMatchObject({
    style: "pulse",
    loops: 3,
    delay: 0.2,
    loopForever: false,
  });
  expect(custom.outgoing.style).toBe("none");
  await rail.getByRole("button", { name: "行为", exact: true }).click();
  let customCard = page
    .locator(".behavior-card")
    .filter({ hasText: "我的文字显示" });
  await expect(customCard).toBeVisible();
  await expect(
    customCard.locator("..").getByRole("img", { name: "用户自定义预设" }),
  ).toBeVisible();
  await customCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
  await page.getByLabel("预设名称", { exact: true }).fill("自定义显示与脉动");
  await page.keyboard.press("Enter");
  customCard = page
    .locator(".behavior-card")
    .filter({ hasText: "自定义显示与脉动" });
  await customCard.click({ button: "right" });
  await page.getByRole("menuitem", { name: "收藏", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "取消收藏：自定义显示与脉动",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  // Hiding/restoring defaults must never remove a custom preset or its star.
  await page
    .locator(".behavior-card")
    .filter({ hasText: "淡入淡出" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除预设", exact: true }).click();
  await expect(
    page.locator(".behavior-card").filter({ hasText: "淡入淡出" }),
  ).toHaveCount(0);
  await page
    .locator(".library-content > .library-heading")
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "恢复所有默认行为", exact: true })
    .click();
  await expect(
    page.locator(".behavior-card").filter({ hasText: "淡入淡出" }),
  ).toHaveCount(1);
  await expect(customCard).toHaveCount(1);
  await customCard.dblclick();
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(2);
  await page.getByRole("tab", { name: "进", exact: true }).click();
  await expect(page.getByLabel("行为速度（%）")).toHaveValue("88");
  await expect(page.getByLabel("逐字偏移（秒）")).toHaveValue("0.05");
  const transfer = await page.evaluateHandle((id) => {
    const value = new DataTransfer();
    value.setData("troncut-behavior", id);
    return value;
  }, custom.id);
  await page
    .locator(".timeline-clip.image")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator(".clip-behavior-effect")).toHaveCount(3);
  // Timeline effect context menu offers the same save dialog, cancellation is inert.
  await page
    .locator(".timeline-clip.image .clip-behavior-effect")
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "添加预设", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  expect((await storage(page)).customBehaviors).toHaveLength(1);
  await rail.getByRole("button", { name: "动画", exact: true }).click();
  await page.getByRole("tab", { name: "动画", exact: true }).click();
  await page
    .getByRole("button", { name: "收藏：自定义动画", exact: true })
    .click();
  await rail.getByRole("button", { name: "视觉效果", exact: true }).click();
  await page
    .getByRole("button", { name: "收藏：圆角倒角", exact: true })
    .click();
  await rail.getByRole("button", { name: "收藏夹", exact: true }).click();
  await expect(page.locator(".favorites-group")).toHaveCount(3);
  await page.getByLabel("收藏类型").selectOption("animation");
  await expect(page.locator(".favorites-group")).toHaveCount(1);
  await page.getByLabel("收藏类型").selectOption("all");
  await page.screenshot({ path: path.join(root, "favorites.png") });
  await page.locator(".timeline-clip.text").click();
  await page.locator(".favorites-panel .animation-card").click();
  await page.locator(".timeline-clip.image").click();
  await page.locator(".favorites-panel .visual-effect-card").dblclick();
  const saved = await saveProject(page);
  expect(saved.clips[0].keyframes.length).toBeGreaterThan(0);
  expect(saved.clips[0].behaviors[1]).toMatchObject({
    name: "自定义显示与脉动",
    incoming: custom.incoming,
    during: custom.during,
    outgoing: custom.outgoing,
  });
  expect(saved.clips[1].behaviors[0].incoming).toMatchObject({
    type: "whole",
    offset: 0,
    speed: 88,
  });
  expect(saved.clips[1].mediaFrame).toMatchObject({
    radius: 20,
    unit: "percent",
  });
  // Keep one default hidden across an actual application restart.
  await rail.getByRole("button", { name: "行为", exact: true }).click();
  await page
    .locator(".behavior-card")
    .filter({ hasText: "淡入淡出" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除预设", exact: true }).click();
  await page.screenshot({ path: path.join(root, "custom-behavior.png") });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => errors.push(error.message));
  const restartedRail = page.locator(".tool-rail");
  await restartedRail
    .getByRole("button", { name: "收藏夹", exact: true })
    .click();
  await expect(page.locator(".favorites-group")).toHaveCount(3);
  await restartedRail
    .getByRole("button", { name: "行为", exact: true })
    .click();
  await expect(
    page.locator(".behavior-card").filter({ hasText: "淡入淡出" }),
  ).toHaveCount(0);
  await page
    .locator(".behaviors-panel .panel-intro")
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "恢复所有默认行为", exact: true })
    .click();
  await expect(
    page.locator(".behavior-card").filter({ hasText: "淡入淡出" }),
  ).toHaveCount(1);
  await page
    .locator(".behavior-card")
    .filter({ hasText: "自定义显示与脉动" })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除预设", exact: true }).click();
  await restartedRail
    .getByRole("button", { name: "行为", exact: true })
    .click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "恢复所有默认行为", exact: true })
    .click();
  expect((await storage(page)).customBehaviors).toHaveLength(0);
  await page
    .locator(".timeline-clip.text .clip-behavior-effect")
    .last()
    .click();
  await expect(
    page.locator(".behavior-name").filter({ hasText: "自定义显示与脉动" }),
  ).toBeVisible();
  const final = await saveProject(page);
  expect(final.clips[0].behaviors[1].incoming).toEqual(custom.incoming);
  await restartedRail
    .getByRole("button", { name: "收藏夹", exact: true })
    .click();
  await expect(page.locator(".favorites-group")).toHaveCount(2);
  await page
    .getByRole("button", { name: "取消收藏：自定义动画", exact: true })
    .click();
  await expect(page.locator(".favorites-group")).toHaveCount(1);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "三阶段自定义预设、头像标识、改名、删除与恢复默认、三类收藏与筛选、收藏夹应用、拖放到图片、重启持久化、删除预设后项目保持完整",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => { });
  console.error("预设与收藏检查失败，截图目录：", root);
  throw error;
} finally {
  await app.close();
}
