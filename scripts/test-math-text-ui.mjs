import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/math-text-ui/run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: { projectDirectory: path.join(root, "projects") },
  }),
);
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
const project = createProject("公式文字测试");
project.canvas = { width: 640, height: 360, fps: 10, background: "#151719" };
const source = "能量 $E=mc^2$\n$$\\frac{a}{b}=\\sqrt{x}$$";
const clip = newText("titles", 0, 0, source);
clip.duration = 5;
clip.style = {
  ...clip.style,
  fontSize: 36,
  outlineWidth: 0,
  fillEnabled: false,
};
project.clips = [clip];
const file = path.join(root, "math.troncut");
await fs.writeFile(file, JSON.stringify(project));
await fs.writeFile(
  path.join(profile, "recovery.json"),
  JSON.stringify({ project, file }),
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
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1440, 950),
  );
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await page.locator(".timeline-clip.text").click();
  const content = page.getByLabel("文本内容", { exact: true });
  const formulas = page.locator(".preview-layer.text .text-formula");
  const svg = (index) =>
    formulas
      .nth(index)
      .getAttribute("src")
      .then((src) => decodeURIComponent(src.slice(src.indexOf(",") + 1)));
  await expect(content).toHaveValue(source);
  await expect(formulas).toHaveCount(2);
  expect(
    await formulas.evaluateAll((nodes) =>
      nodes.every((node) => node.complete && node.naturalWidth > 0),
    ),
  ).toBe(true);
  const firstBox = await formulas.nth(0).boundingBox();
  const secondBox = await formulas.nth(1).boundingBox();
  expect(secondBox.y).toBeGreaterThan(firstBox.y + firstBox.height);
  await content.focus();
  await content.press("Control+End");
  const color = page.getByLabel("文字颜色", { exact: true });
  const setColor = async (value) => {
    await color.evaluate((node, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(node, value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  };
  await setColor("#00ff00");
  await expect.poll(() => svg(0)).toContain('fill="#00ff00"');
  await expect.poll(() => svg(1)).toContain('fill="#00ff00"');
  await content.focus();
  await content.press("Control+Home");
  for (let i = 0; i < 4; i++) await content.press("ArrowRight");
  for (let i = 0; i < 6; i++) await content.press("Shift+ArrowRight");
  await expect(page.locator(".text-selection-status")).toContainText(
    "已选中 6 个字符",
  );
  await setColor("#0000ff");
  await expect.poll(() => svg(0)).toContain('fill="#0000ff"');
  await expect.poll(() => svg(1)).toContain('fill="#00ff00"');
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect.poll(() => svg(0)).toContain('fill="#00ff00"');
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect.poll(() => svg(0)).toContain('fill="#0000ff"');
  await page.screenshot({ path: path.join(root, "formula-colors.png") });

  // Canvas editing exposes the source and restores formulas when editing ends.
  await page.locator(".preview-layer.text").dblclick();
  const canvas = page.getByRole("textbox", {
    name: "画布文本内容",
    exact: true,
  });
  await expect(canvas).toHaveText(source);
  await canvas.press("Control+Enter");
  await expect(formulas).toHaveCount(2);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  await expect(page.locator(".project-save-state")).not.toContainText("*");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  expect(saved.clips[0].text).toBe(source);
  expect(saved.clips[0].style.color).toBe("#00ff00");
  expect(saved.clips[0].textRuns[0].style.color).toBe("#0000ff");
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project").first().click();
  await page.locator(".timeline-clip.text").click();
  await expect(content).toHaveValue(source);
  await expect(formulas).toHaveCount(2);
  await expect.poll(() => svg(0)).toContain('fill="#0000ff"');

  await content.fill(String.raw`$\textcolor{red}{x}+y$`);
  await content.blur();
  await expect(formulas).toHaveCount(1);
  await expect.poll(() => svg(0)).toContain('fill="red"');
  await content.fill(String.raw`$\frac{a}{$`);
  await content.blur();
  await expect(formulas).toHaveCount(0);
  await expect(page.locator(".preview-text-content")).toContainText(
    String.raw`$\frac{a}{$`,
  );
  await content.fill("普通文字 $5 和 $10");
  await content.blur();
  await expect(formulas).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    `公式混排、实际 SVG 图像、整段/源码选区颜色、TeX 局部着色、画布编辑、撤销重做、保存重开及错误回退通过：${root}`,
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await app.close();
}
