import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("test-output/text-tool-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const project = {
  format: "troncut",
  version: 1,
  id: "text-tool-ui",
  name: "文字工具测试",
  canvas: { width: 640, height: 360, fps: 10, background: "#151719" },
  assets: [],
  markers: [],
  tracks: [
    { id: "titles", name: "轨道1", hidden: false, muted: false, locked: false },
  ],
  clips: [
    {
      id: "text",
      trackId: "titles",
      kind: "text",
      name: "局部样式测试",
      text: "甲乙丙丁",
      start: 0,
      duration: 4,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 },
      keyframes: [],
      style: {
        fontFamily: "Microsoft YaHei",
        fontSize: 48,
        color: "#ffffff",
        outline: "#111111",
        outlineWidth: 0,
        fillEnabled: false,
      },
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
try {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].focus(),
  );
  await page.bringToFront();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await page.locator(".timeline-clip.text").click();
  const content = page.getByLabel("文本内容", { exact: true });
  await expect(content).toHaveValue("甲乙丙丁");
  const font = page.getByRole("combobox", { name: "字体", exact: true });
  await font.click();
  await expect(font).toHaveValue("");
  const fontList = page.getByRole("listbox", { name: "字体列表", exact: true });
  await expect
    .poll(() => fontList.getByRole("option").count())
    .toBeGreaterThan(20);
  const fontCount = await fontList.getByRole("option").count();
  await page.screenshot({ path: path.join(root, "font-search.png") });
  await font.fill("no-such-font-12345");
  await expect(fontList.getByRole("option")).toHaveCount(0);
  await font.press("Escape");
  await expect(font).toHaveValue("Microsoft YaHei");
  await font.click();
  await font.fill("Arial");
  await font.press("ArrowDown");
  const keyboardFont = await fontList
    .locator('[aria-selected="true"]')
    .textContent();
  await font.press("Enter");
  await expect(font).toHaveValue(keyboardFont);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(font).toHaveValue("Microsoft YaHei");
  await font.click();
  await expect(fontList.getByRole("option")).toHaveCount(fontCount);
  await font.fill("Arial");
  await content.click();
  await expect(font).toHaveValue("Microsoft YaHei");
  await content.focus();
  await content.press("Home");
  await content.press("ArrowRight");
  await content.press("Shift+ArrowRight");
  await content.press("Shift+ArrowRight");
  await expect(page.locator(".text-selection-status")).toContainText(
    "已选中 2 个字符",
  );
  await font.click();
  await font.fill("Arial");
  await fontList.getByRole("option", { name: "Arial", exact: true }).click();
  await expect(font).toHaveValue("Arial");
  await font.click();
  await expect(font).toHaveValue("");
  await expect(fontList.getByRole("option")).toHaveCount(fontCount);
  await font.press("Escape");
  await expect(font).toHaveValue("Arial");
  await page.getByRole("spinbutton", { name: "字号", exact: true }).fill("80");
  await page
    .getByRole("spinbutton", { name: "描边宽度", exact: true })
    .fill("2");
  await expect(page.locator(".text-selection-status")).toContainText(
    "已选中 2 个字符",
  );
  const glyphs = page.locator(
    ".preview-layer.text .behavior-text-layout > span",
  );
  await expect(glyphs).toHaveCount(4);
  const styles = await glyphs.evaluateAll((nodes) =>
    nodes.map((node) => ({
      family: node.style.fontFamily,
      size: parseFloat(node.style.fontSize),
      stroke: node.style.webkitTextStroke,
    })),
  );
  expect(styles[1].family).toContain("Arial");
  expect(styles[2].size).toBe(styles[1].size);
  expect(styles[1].size / styles[0].size).toBeCloseTo(80 / 48);
  expect(styles[3].family).toContain("Microsoft YaHei");
  await content.focus();
  await content.press("End");
  await expect(page.locator(".text-selection-status")).toContainText(
    "未选择时应用于整段",
  );
  await page.locator(".preview-layer.text").dblclick();
  const canvas = page.getByRole("textbox", {
    name: "画布文本内容",
    exact: true,
  });
  await expect(canvas).toBeVisible();
  await canvas.evaluate((element) => {
    const span = element.querySelectorAll("span")[1];
    const range = document.createRange();
    range.setStart(span.firstChild, 0);
    range.setEnd(span.firstChild, 1);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  await expect(page.locator(".text-selection-status")).toContainText(
    "已选中 1 个字符",
  );
  await font.click();
  await font.fill("SimSun");
  await fontList.getByRole("option", { name: "SimSun", exact: true }).click();
  await expect(glyphs.nth(1)).toHaveCSS("font-family", /SimSun/);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(glyphs.nth(1)).toHaveCSS("font-family", /Arial/);
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(glyphs.nth(1)).toHaveCSS("font-family", /SimSun/);
  // Insert a line and emoji through the actual canvas editor; subsequent spans keep their styles.
  await page.locator(".preview-layer.text").dblclick();
  await expect(canvas).toBeVisible();
  await canvas.press("ArrowLeft");
  await canvas.press("Enter");
  await canvas.pressSequentially("X");
  await page.keyboard.insertText("😀");
  await canvas.press("Control+Enter");
  await expect(content).toHaveValue("\nX😀甲乙丙丁");
  await page.screenshot({ path: path.join(root, "text-tool.png") });
  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    },
    path.join(root, `${project.name}.troncut`),
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("项目已保存");
  const file = path.join(root, project.name, `${project.name}.troncut`);
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  expect(saved.clips[0].textRuns).toEqual([
    {
      start: 5,
      end: 6,
      style: { fontFamily: "SimSun", fontSize: 80, outlineWidth: 2 },
    },
    {
      start: 6,
      end: 7,
      style: { fontFamily: "Arial", fontSize: 80, outlineWidth: 2 },
    },
  ]);
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project").first().click();
  await page.locator(".timeline-clip.text").click();
  await expect(content).toHaveValue("\nX😀甲乙丙丁");
  await expect(glyphs.nth(3)).toHaveCSS("font-family", /SimSun/);
  // Formatting applies only to the actual textarea selection and survives
  // switching to the canvas editor without losing that selection on a click.
  await content.focus();
  await content.press("Control+End");
  await content.press("Shift+ArrowLeft");
  await content.press("Shift+ArrowLeft");
  const bold = page.getByRole("button", { name: "加粗", exact: true });
  const italic = page.getByRole("button", { name: "斜体", exact: true });
  const underline = page.getByRole("button", { name: "下划线", exact: true });
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  await bold.click();
  await italic.click();
  await underline.click();
  for (const index of [4, 5]) {
    await expect(glyphs.nth(index)).toHaveCSS("font-weight", "400");
    await expect(glyphs.nth(index)).toHaveCSS("font-style", "italic");
    await expect(glyphs.nth(index)).toHaveCSS(
      "text-decoration-line",
      "underline",
    );
  }
  await expect(glyphs.nth(3)).toHaveCSS("font-weight", "700");
  await expect(glyphs.nth(3)).toHaveCSS("text-decoration-line", "none");
  await page.locator(".preview-layer.text").dblclick();
  await expect(canvas).toBeVisible();
  await canvas.press("Control+End");
  await canvas.press("Shift+ArrowLeft");
  await expect(page.locator(".text-selection-status")).toContainText(
    "已选中 1 个字符",
  );
  await underline.click();
  await italic.click();
  await expect(canvas).toBeFocused();
  await expect(canvas.locator("span").last()).toHaveCSS(
    "text-decoration-line",
    "none",
  );
  await expect(canvas.locator("span").last()).toHaveCSS("font-style", "normal");
  await canvas.press("Control+Enter");
  await expect(glyphs.nth(4)).toHaveCSS("text-decoration-line", "underline");
  await expect(glyphs.nth(5)).toHaveCSS("text-decoration-line", "none");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(glyphs.nth(5)).toHaveCSS("font-style", "italic");
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(glyphs.nth(5)).toHaveCSS("font-style", "normal");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(file, "utf8")).clips[0].textRuns.at(-1)
          .style,
    )
    .toEqual({ bold: false, italic: false, underline: false });
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project").first().click();
  await page.locator(".timeline-clip.text").click();
  await expect(glyphs.nth(4)).toHaveCSS("text-decoration-line", "underline");
  await expect(glyphs.nth(5)).toHaveCSS("font-weight", "400");
  await expect(glyphs.nth(5)).toHaveCSS("text-decoration-line", "none");
  await content.focus();
  await content.press("Control+End");
  await expect(page.locator(".text-selection-status")).toContainText(
    "未选择时应用于整段",
  );
  await underline.click();
  await expect(glyphs.nth(5)).toHaveCSS("text-decoration-line", "underline");
  await page.locator(".preview-layer.text").dblclick();
  await canvas.press("Control+End");
  await canvas.press("Shift+ArrowLeft");
  await underline.click();
  await expect(canvas.locator("span").last()).toHaveCSS(
    "text-decoration-line",
    "none",
  );
  await canvas.press("Control+Enter");
  await expect(glyphs.nth(4)).toHaveCSS("text-decoration-line", "underline");
  await expect(glyphs.nth(5)).toHaveCSS("text-decoration-line", "none");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await page
    .getByRole("group", { name: "文字格式", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, "text-format.png") });
  const formatted = JSON.parse(await fs.readFile(file, "utf8"));
  expect(formatted.clips[0].style.underline).toBe(true);
  expect(formatted.clips[0].textRuns.at(-1).style.underline).toBe(false);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify(
      { root, fontCount, textRuns: formatted.clips[0].textRuns, errors },
      null,
      2,
    ),
  );
} catch (error) {
  const page = await app.firstWindow();
  await page
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => { });
  console.error(await page.locator(".font-select-error").allTextContents());
  throw error;
} finally {
  await app.close();
}
