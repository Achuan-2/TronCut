import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { selectPreview } from "./preview-select.mjs";
import sharp from "sharp";

const root = path.resolve(
  "test-output/preferences-menu-ui",
  `run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({ storage: { projectDirectory: path.join(root, "projects") } }),
);
const image = path.join(root, "default-image.png");
await sharp({
  create: { width: 160, height: 90, channels: 3, background: "#76e5b5" },
})
  .png()
  .toFile(image);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(
    page.getByRole("button", { name: "编辑", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "首选项", exact: true }),
  ).toHaveCount(0);
  const enabled = (id) =>
    app.evaluate(
      ({ Menu }, id) =>
        Menu.getApplicationMenu().getMenuItemById(`edit-${id}`).enabled,
      id,
    );
  const command = async (id) => {
    await expect.poll(() => enabled(id)).toBe(true);
    await app.evaluate(
      ({ Menu, BrowserWindow }, id) =>
        Menu.getApplicationMenu()
          .getMenuItemById(`edit-${id}`)
          .click(null, BrowserWindow.getAllWindows()[0], {}),
      id,
    );
  };
  await expect.poll(() => enabled("undo")).toBe(false);
  await command("preferences");
  await expect(
    page.getByRole("tablist", { name: "首选项分组" }).getByRole("tab"),
  ).toHaveText(["程序", "计时", "快捷键", "项目", "AI 模型"]);
  await expect(
    page.getByRole("heading", { name: "存储", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("备份文件夹", { exact: true })).toHaveCount(1);
  await expect(
    page.getByLabel("ONNX 模型文件夹", { exact: true }),
  ).toHaveCount(1);
  await page.getByLabel("默认启用时间线吸附", { exact: true }).uncheck();
  await page.getByLabel("显示时间线音频波形", { exact: true }).uncheck();
  await page.screenshot({ path: path.join(root, "program.png") });
  await page.getByRole("tab", { name: "计时", exact: true }).click();
  for (const [label, value] of [
    ["图像", "8"],
    ["文字", "7"],
    ["注释", "9"],
    ["动画", "2"],
    ["手动字幕", "4"],
    ["转换", "1.5"],
  ])
    await page.getByLabel(`${label}默认时长`, { exact: true }).fill(value);
  await page.screenshot({ path: path.join(root, "timing.png") });
  await page.getByRole("tab", { name: "项目", exact: true }).click();
  await page
    .getByLabel("默认画布规格", { exact: true })
    .selectOption("1280x720");
  await page.getByLabel("默认项目帧率", { exact: true }).selectOption("60");
  await selectPreview(page, "默认鼠标样式", "circle");
  await page.getByLabel("默认鼠标大小", { exact: true }).fill("56");
  await page.screenshot({ path: path.join(root, "project.png") });
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.framecraft.recordingSettings()),
  ).toMatchObject({ cursor: { style: "circle", size: 56 } });
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "吸附", exact: true }),
  ).not.toHaveClass(/active-tool/);
  await page.keyboard.press("Shift+T");
  await expect(page.locator(".timeline-clip.text")).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.framecraft.readRecovery()))?.project
          .clips[0]?.duration,
    )
    .toBe(7);
  const recovery = await page.evaluate(() => window.framecraft.readRecovery());
  expect(recovery.project.canvas).toMatchObject({
    width: 1280,
    height: 720,
    fps: 60,
  });
  await page.keyboard.press("Shift+A");
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => window.framecraft.readRecovery())
        )?.project.clips[0]?.keyframes.at(-1)?.time,
    )
    .toBe(2);
  await command("deselect");
  await page.locator(".timeline-clip.text").click({ position: { x: 8, y: 8 } });
  await page.keyboard.press("Control+d");
  await expect(page.locator(".timeline-clip.text")).toHaveCount(2);
  await command("undo");
  await expect(page.locator(".timeline-clip.text")).toHaveCount(1);
  await command("redo");
  await expect(page.locator(".timeline-clip.text")).toHaveCount(2);
  await command("cut");
  await expect(page.locator(".timeline-clip.text")).toHaveCount(1);
  await command("paste");
  await expect(page.locator(".timeline-clip.text")).toHaveCount(2);
  await command("selectAll");
  await expect(page.locator(".timeline-clip.selected")).toHaveCount(2);
  await command("group");
  await command("ungroup");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("s");
  await expect(page.locator(".timeline-clip.text")).toHaveCount(2);
  expect(
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu().getMenuItemById("edit-split").accelerator,
    ),
  ).toBe("CmdOrCtrl+K");
  await expect.poll(() => enabled("split")).toBe(true);
  await page.keyboard.press("Control+k");
  // Duplicated/pasted clips occupy consecutive spans; this playhead crosses one.
  await expect(page.locator(".timeline-clip.text")).toHaveCount(3);
  await command("undo");
  await expect(page.locator(".timeline-clip.text")).toHaveCount(2);
  await command("split");
  await expect(page.locator(".timeline-clip.text")).toHaveCount(3);
  await command("undo");
  await expect(page.locator(".timeline-clip.text")).toHaveCount(2);
  const lock = page
    .locator(".track-header")
    .first()
    .getByTitle("锁定 / 解锁轨道", { exact: true });
  await lock.click();
  await expect.poll(() => enabled("cut")).toBe(false);
  const clipboardBefore = (
    await page.evaluate(() => window.framecraft.importClipboardMedia())
  ).clipToken;
  await page.keyboard.press("Control+x");
  expect(
    (await page.evaluate(() => window.framecraft.importClipboardMedia()))
      .clipToken,
  ).toBe(clipboardBefore);
  await expect(page.locator(".timeline-clip.text")).toHaveCount(2);
  await lock.click();
  const title = page.getByLabel("项目名称", { exact: true });
  await title.fill("文本复制测试");
  await page.keyboard.press("Control+k");
  await expect(title).toHaveValue("文本复制测试");
  await expect(page.locator(".timeline-clip.text")).toHaveCount(2);
  await command("selectAll");
  await command("copy");
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe("文本复制测试");
  await title.press("Tab");
  await expect(page.getByRole("status")).toContainText("项目及文件夹已重命名");
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, image);
  await page.getByRole("button", { name: "导入媒体", exact: true }).click();
  await expect(page.locator(".asset-card")).toHaveCount(1);
  await page.locator(".asset-card").dblclick();
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => window.framecraft.readRecovery())
        )?.project.clips.find((c) => c.kind === "image")?.duration,
    )
    .toBe(8);
  await command("preferences");
  await page.getByRole("tab", { name: "项目", exact: true }).click();
  await page
    .getByLabel("默认画布规格", { exact: true })
    .selectOption("3840x2160");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    (await page.evaluate(() => window.framecraft.preferences())).project.width,
  ).toBe(1280);
  await command("preferences");
  await page.getByRole("tab", { name: "快捷键", exact: true }).click();
  await page.screenshot({ path: path.join(root, "shortcuts.png") });
  await page.getByLabel("搜索快捷键", { exact: true }).fill("添加文本");
  await expect(page.locator(".preferences-shortcuts > div")).toContainText(
    "Shift+T",
  );
  await page.getByLabel("搜索快捷键", { exact: true }).fill("添加动画");
  await expect(page.locator(".preferences-shortcuts > div")).toContainText(
    "Shift+A",
  );
  const clipCount = await page.locator(".timeline-clip").count();
  await page.getByLabel("搜索快捷键", { exact: true }).press("Shift+T");
  await expect(page.locator(".timeline-clip")).toHaveCount(clipCount);
  await page.getByLabel("搜索快捷键", { exact: true }).fill("分割");
  await expect(page.locator(".preferences-shortcuts > div")).toHaveCount(1);
  await expect(page.locator(".preferences-shortcuts > div")).toContainText(
    "Ctrl+K",
  );
  await page.getByLabel("搜索快捷键", { exact: true }).fill("添加文本");
  await page.getByRole("button", { name: "添加文本快捷键" }).click();
  await page.keyboard.press("Shift+A");
  await expect(page.getByRole("alert")).toContainText("已用于“添加动画”");
  await page.keyboard.press("Shift+Y");
  await expect(page.getByRole("button", { name: "添加文本快捷键" })).toContainText("Shift+Y");
  await page.getByLabel("搜索快捷键", { exact: true }).fill("分割");
  await page.getByRole("button", { name: "在播放头处分割快捷键" }).click();
  await page.keyboard.press("Control+J");
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "首选项" })).toHaveCount(0);
  expect((await page.evaluate(() => window.framecraft.preferences())).shortcuts.addText).toBe("Shift+Y");
  await expect.poll(() => app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById("edit-split").accelerator)).toBe("CmdOrCtrl+J");
  const beforeRemappedText = await page.locator(".timeline-clip").count();
  await page.keyboard.press("Shift+T");
  await expect(page.locator(".timeline-clip")).toHaveCount(beforeRemappedText);
  await page.keyboard.press("Shift+Y");
  await expect(page.locator(".timeline-clip")).toHaveCount(beforeRemappedText + 1);
  await command("preferences");
  await page.getByRole("tab", { name: "快捷键", exact: true }).click();
  await page.getByRole("button", { name: "全部恢复默认" }).click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  expect((await page.evaluate(() => window.framecraft.preferences())).shortcuts.addText).toBe("Shift+T");
  expect(errors).toEqual([]);
  console.log(
    `首选项、原生编辑菜单及自定义快捷键通过：${root}`,
  );
} catch (error) {
  await app
    .windows()[0]
    ?.screenshot({ path: path.join(root, "failure.png") })
    .catch(() => { });
  console.error(`失败截图：${root}`);
  throw error;
} finally {
  await app.close();
}
