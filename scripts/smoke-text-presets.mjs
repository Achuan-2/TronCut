import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/text-presets-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents: 'export {createProject,newText} from "./shared/model";',
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
const project = createProject("花字模板交互测试");
project.clips = [newText("titles", 0, 0, "测试花字")];
Object.assign(project.clips[0].style, {
  fontFamily: "Arial",
  color: "#71e6b5",
  outlineWidth: 3,
  fillEnabled: true,
  fill: "#123456",
  fillOpacity: 0.4,
  fillRadius: 18,
});
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
const card = (page, name) =>
  page
    .locator(".preset-card:visible")
    .filter({ has: page.locator("small", { hasText: name }) });
const menu = async (page, name, action) => {
  await card(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: action, exact: true }).click();
};
try {
  let page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".timeline-clip.text").click();
  await page
    .getByRole("button", { name: "保存当前预设为模板", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "保存花字模板" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("预设名称", { exact: true }).fill("我的背景花字");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  const custom = (await storage(page)).customTextPresets[0];
  expect(custom.style).toEqual(project.clips[0].style);
  await page.getByRole("button", { name: /花字模板/ }).click();
  await expect(
    page
      .getByRole("listbox", { name: "花字模板", exact: true })
      .getByRole("option", { name: "我的背景花字", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const rail = page.locator(".tool-rail");
  await rail.getByRole("button", { name: "标注", exact: true }).click();
  await expect(
    card(page, "我的背景花字")
      .locator("..")
      .getByRole("img", { name: "用户自定义预设" }),
  ).toBeVisible();
  await menu(page, "我的背景花字", "重命名");
  await page.getByLabel("预设名称", { exact: true }).fill("重命名花字");
  await page.keyboard.press("Enter");
  await menu(page, "重命名花字", "收藏");
  await expect(
    page.getByRole("button", { name: "取消收藏：重命名花字", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await menu(page, "黑边白字", "重命名");
  await page.getByLabel("预设名称", { exact: true }).fill("默认白字");
  await page.keyboard.press("Enter");
  await menu(page, "默认白字", "删除模板");
  await expect(card(page, "默认白字")).toHaveCount(0);
  await menu(page, "重命名花字", "恢复所有默认花字");
  await expect(card(page, "默认白字")).toBeVisible();
  await expect(card(page, "重命名花字")).toBeVisible();
  await rail.getByRole("button", { name: "收藏夹", exact: true }).click();
  await page.getByLabel("收藏类型", { exact: true }).selectOption("text");
  await expect(
    page.getByRole("region", { name: "收藏的花字", exact: true }),
  ).toBeVisible();
  // Favorite cards use the same style payload when creating editable text.
  await card(page, "重命名花字").click();
  await expect(page.locator(".timeline-clip.text")).toHaveCount(2);
  await page.getByTitle("保存项目 Ctrl+S").click();
  await expect(page.locator(".toast")).toContainText("项目已保存");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  expect(saved.clips[1].style).toEqual(custom.style);
  // A drag payload contains the style, rather than an index into a local library.
  const payload = await card(page, "重命名花字").evaluate((element) => {
    const dataTransfer = new DataTransfer();
    element.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, dataTransfer }),
    );
    return JSON.parse(dataTransfer.getData("troncut-annotation"));
  });
  expect(payload.style).toEqual(custom.style);
  await page.screenshot({ path: path.join(root, "favorites.png") });
  await app.close();
  app = await launch();
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .locator(".tool-rail")
    .getByRole("button", { name: "标注", exact: true })
    .click();
  await expect(card(page, "重命名花字")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "取消收藏：重命名花字", exact: true }),
  ).toBeVisible();
  // Inspector application preserves the target size while reusing the saved appearance.
  await page
    .locator(`.timeline-clip[data-clip-id="${project.clips[0].id}"]`)
    .click();
  await page.getByRole("spinbutton", { name: "字号", exact: true }).fill("42");
  await page.getByRole("button", { name: /花字模板/ }).click();
  await page
    .getByRole("listbox", { name: "花字模板", exact: true })
    .getByRole("option", { name: "重命名花字", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "字号", exact: true }),
  ).toHaveValue("42");
  await page.getByTitle("保存项目 Ctrl+S").click();
  await expect(page.locator(".toast")).toContainText("项目已保存");
  await expect
    .poll(async () => {
      const applied = JSON.parse(await fs.readFile(file, "utf8"));
      return applied.clips.find((clip) => clip.id === project.clips[0].id)
        .style;
    })
    .toEqual({ ...custom.style, fontSize: 42 });
  await menu(page, "重命名花字", "删除模板");
  expect((await storage(page)).customTextPresets).toEqual([]);
  expect((await storage(page)).favorites).not.toContain(`text:${custom.id}`);
  for (const name of [
    "默认白字",
    "白边黑字",
    "黑边黄字",
    "简洁标题",
    "薄荷强调",
    "浅紫花字",
  ])
    await menu(page, name, "删除模板");
  await page.getByLabel("标注文本样式", { exact: true }).selectOption("fancy");
  await page
    .getByRole("button", { name: "恢复所有默认花字", exact: true })
    .click();
  await expect(page.locator(".preset-card")).toHaveCount(6);
  await page.screenshot({ path: path.join(root, "restored.png") });
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ root, custom, errors }, null, 2));
} finally {
  await app.close();
}
