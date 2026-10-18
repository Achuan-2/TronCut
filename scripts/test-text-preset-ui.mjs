import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("test-output/text-preset-ui", `run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const project = {
  format: "troncut",
  version: 1,
  id: "text-preset-ui",
  name: "花字选择器测试",
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
      name: "花字测试",
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
  await content.focus();
  await content.press("Home");
  await content.press("ArrowRight");
  await content.press("Shift+ArrowRight");
  await content.press("Shift+ArrowRight");
  const status = page.locator(".text-selection-status");
  await expect(status).toContainText("已选中 2 个字符");
  await expect(page.getByRole("button", { name: "应用整段" })).toHaveCount(0);

  const trigger = page.getByRole("button", { name: /花字模板/ });
  await trigger.click();
  await expect(status).toContainText("已选中 2 个字符");
  const list = page.getByRole("listbox", { name: "花字模板", exact: true });
  await expect(list).toBeVisible();
  await expect(list.getByRole("option")).toHaveCount(6);
  await expect(list.getByRole("option")).toContainText([
    "黑边白字",
    "白边黑字",
    "黑边黄字",
    "简洁标题",
    "薄荷强调",
    "浅紫花字",
  ]);
  await page.screenshot({
    path: path.join(root, "text-preset-picker.png"),
  });

  await list.getByRole("option", { name: "黑边黄字", exact: true }).click();
  await expect(status).toContainText("已选中 2 个字符");
  await expect(trigger).toHaveAccessibleName("花字模板：黑边黄字");
  await expect(trigger).toContainText("黑边黄字");
  await expect(page.getByLabel("文字颜色", { exact: true })).toHaveValue(
    "#ffe465",
  );
  await expect(
    page.getByRole("spinbutton", { name: "描边宽度", exact: true }),
  ).toHaveValue("5");

  const glyphs = page.locator(
    ".preview-layer.text .behavior-text-layout > span",
  );
  await expect(glyphs).toHaveCount(4);
  await expect(glyphs.nth(0)).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(glyphs.nth(1)).toHaveCSS("color", "rgb(255, 228, 101)");
  await expect(glyphs.nth(2)).toHaveCSS("color", "rgb(255, 228, 101)");
  await expect(glyphs.nth(3)).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.screenshot({
    path: path.join(root, "text-preset-applied.png"),
  });

  expect(errors).toEqual([]);
  console.log(JSON.stringify({ root, errors }, null, 2));
} finally {
  await app.close();
}
