import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/caption-search/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByRole("button", { name: "字幕", exact: true }).click();
  await page.getByRole("button", { name: "添加字幕", exact: true }).click();
  const captions = page.locator(".caption-row textarea");
  await captions.first().fill("Cat cat concatenate");
  const ruler = await page.locator(".ruler").boundingBox();
  await page.mouse.click(ruler.x + 4 * 65, ruler.y + 15);
  await page.getByRole("button", { name: "添加字幕", exact: true }).click();
  await captions.nth(1).fill("CAT cat");
  await page.getByRole("button", { name: "字幕操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "搜索和替换", exact: true }).click();
  const widget = page.getByRole("search", { name: "字幕搜索替换" });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const query = page.getByRole("textbox", { name: "查找字幕", exact: true });
  const replacement = page.getByRole("textbox", {
    name: "替换字幕为",
    exact: true,
  });
  const count = page.getByLabel("字幕匹配计数");
  await query.fill("cat");
  await expect(count).toHaveText("1/5");
  await expect(page.locator(".caption-highlights mark")).toHaveCount(5);
  await query.press("Enter");
  await expect(count).toHaveText("2/5");
  await query.press("Shift+Enter");
  await expect(count).toHaveText("1/5");
  await widget.getByRole("button", { name: "区分大小写", exact: true }).click();
  await expect(count).toHaveText("1/3");
  await widget.getByRole("button", { name: "全词匹配", exact: true }).click();
  await expect(count).toHaveText("1/2");
  await widget.getByRole("button", { name: "区分大小写", exact: true }).click();
  await expect(count).toHaveText("1/4");
  await replacement.fill("dog");
  await widget.getByRole("button", { name: "保留大小写", exact: true }).click();
  await widget
    .getByRole("button", { name: "替换当前匹配", exact: true })
    .click();
  await expect(captions.first()).toHaveValue("Dog cat concatenate");
  await expect(count).toHaveText("1/3");
  await widget
    .getByRole("button", { name: "替换全部匹配", exact: true })
    .click();
  await expect(captions.first()).toHaveValue("Dog dog concatenate");
  await expect(captions.nth(1)).toHaveValue("DOG dog");
  await expect(count).toHaveText("0/0");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(captions.first()).toHaveValue("Dog cat concatenate");
  await expect(captions.nth(1)).toHaveValue("CAT cat");
  await widget
    .getByRole("button", { name: "使用正则表达式", exact: true })
    .click();
  await query.fill("[");
  await expect(widget.getByRole("alert")).toHaveText("正则表达式无效");
  await query.fill("(cat)");
  await expect(widget.getByRole("alert")).toHaveCount(0);
  await replacement.fill("$1字幕");
  await page.screenshot({ path: path.join(root, "find-replace.png") });
  // Navigation wraps through occurrences and seeks the matching caption.
  await widget.getByRole("button", { name: "上一个匹配", exact: true }).click();
  await expect(count).toHaveText("3/3");
  await expect(page.locator(".caption-row.active textarea")).toHaveValue(
    "CAT cat",
  );
  await replacement.press("Enter");
  await expect(captions.nth(1)).toHaveValue("CAT cat字幕");
  await widget.getByRole("button", { name: "折叠替换", exact: true }).click();
  await expect(replacement).toHaveCount(0);
  await query.press("Control+h");
  await expect(replacement).toBeVisible();
  await query.press("Escape");
  await expect(widget).toHaveCount(0);
  await expect(page.locator(".caption-highlights")).toHaveCount(0);
  await captions.nth(1).press("Control+h");
  await expect(query).toHaveValue("(cat)");
  await expect(replacement).toHaveValue("$1字幕");
  await widget
    .getByRole("button", { name: "仅在选中字幕中查找", exact: true })
    .click();
  // Clicking a caption selects its whole caption track in TronCut.
  await expect(
    widget.getByRole("button", { name: "仅在选中字幕中查找", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(count).toHaveText("1/2");
  await widget
    .getByRole("button", { name: "仅在选中字幕中查找", exact: true })
    .click();
  await expect(count).toHaveText("1/2");
  await page.screenshot({ path: path.join(root, "find-replace.png") });
  await captions.nth(1).fill("CAT cat字幕 手动编辑");
  await expect(page.locator(".caption-row.active textarea")).toHaveValue(
    "CAT cat字幕 手动编辑",
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify({ root, errors }, null, 2),
  );
  console.log(
    "字幕查找替换：非模态面板、计数、高亮、导航、大小写、全词、正则、逐项和全部替换、撤销及快捷键通过",
  );
} finally {
  await app?.close();
}
