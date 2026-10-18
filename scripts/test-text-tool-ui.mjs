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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await page.locator(".timeline-clip.text").click();
  const content = page.getByLabel("文本内容", { exact: true });
  await expect(content).toHaveValue("甲乙丙丁");
  const font = page.getByRole("combobox", { name: "字体", exact: true });
  await expect.poll(() => font.locator("option").count()).toBeGreaterThan(20);
  const fontCount = await font.locator("option").count();
  await content.focus();
  await content.press("Home");
  await content.press("ArrowRight");
  await content.press("Shift+ArrowRight");
  await content.press("Shift+ArrowRight");
  await expect(page.locator(".text-selection-status")).toContainText(
    "已选中 2 个字符",
  );
  await font.selectOption("Arial");
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
  await page.getByRole("button", { name: "应用整段", exact: true }).click();
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
  await font.focus();
  await font.selectOption("SimSun");
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
  await expect(page.locator(".toast")).toContainText("工程已保存");
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
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify(
      { root, fontCount, textRuns: saved.clips[0].textRuns, errors },
      null,
      2,
    ),
  );
} finally {
  await app.close();
}
