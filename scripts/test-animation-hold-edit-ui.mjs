import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/animation-hold-edit/run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(path.join(profile, "preferences.json"), JSON.stringify({
  storage: { projectDirectory: path.join(root, "projects") },
}));
const bundle = await build({
  stdin: { contents: 'export { createProject, newText } from "./shared/model";', resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false,
});
const { createProject, newText } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const project = createProject("动画末尾普通编辑");
const clip = { ...newText("titles", 0), duration: 8 };
clip.keyframes = [
  { time: 0, value: { ...clip.transform, opacity: 1 } },
  { time: 1, value: { ...clip.transform, opacity: 0 }, animation: true },
  { time: 3, value: { ...clip.transform, opacity: 0 } },
  { time: 4, value: { ...clip.transform, opacity: 1 }, animation: true },
];
project.clips = [clip];
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
await fs.writeFile(path.join(profile, "recovery.json"), JSON.stringify({ project, file }));
const env = { ...process.env, FRAMECRAFT_SMOKE: "1", FRAMECRAFT_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 950));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  await page.locator(".timeline-clip").first().click({ position: { x: 20, y: 12 } });
  await page.getByRole("tab", { name: "画面", exact: true }).click();
  const progress = page.getByLabel("播放进度", { exact: true });
  const opacity = page.getByLabel("不透明度 (%)", { exact: true });
  const ends = page.locator(".transform-animations .animation-point.end");
  const toggle = page.getByRole("button", { name: "编辑所有动画", exact: true });
  const undo = page.getByTitle("撤销 Ctrl+Z", { exact: true });
  const redo = page.getByTitle("重做 Ctrl+Shift+Z", { exact: true });
  const save = async () => {
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".busy-overlay")).toHaveCount(0);
    await expect(page.locator(".project-save-state")).not.toContainText("*");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  const editOpacity = async (value) => { await opacity.fill(value); await opacity.blur(); };
  const opacities = (saved) => saved.clips[0].keyframes.map((frame) => frame.value.opacity);

  await progress.fill("6");
  await expect(ends.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(ends.nth(0)).toHaveAttribute("aria-pressed", "false");
  expect(await ends.nth(1).locator(".animation-point-dot").evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(242, 96, 104)");
  await editOpacity("60");
  expect(opacities(await save())).toEqual([1, 0, 0, 0.6]);
  await expect(progress).toHaveValue("6");
  await undo.click();
  await expect(opacity).toHaveValue("100");
  await redo.click();
  await expect(opacity).toHaveValue("60");
  await page.screenshot({ path: path.join(root, "nearest-end.png") });

  await progress.fill("2");
  await expect(ends.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(ends.nth(1)).toHaveAttribute("aria-pressed", "false");
  await editOpacity("25");
  expect(opacities(await save())).toEqual([1, 0.25, 0.25, 0.6]);
  await progress.fill("3.5");
  await expect(page.locator(".transform-animations .selected-frame")).toHaveCount(0);

  await progress.fill("6");
  await toggle.click();
  await expect(page.locator(".transform-animations .selected-frame")).toHaveCount(0);
  await editOpacity("80");
  const all = opacities(await save());
  for (const [index, value] of [1, 0.45, 0.45, 0.8].entries()) expect(all[index]).toBeCloseTo(value);
  await undo.click();
  await toggle.click();
  await expect(ends.nth(1)).toHaveAttribute("aria-pressed", "true");

  // Automatic animation keeps creating new motion at the playhead.
  await page.locator(".tool-rail").getByRole("button", { name: "动画", exact: true }).click();
  const auto = page.getByRole("checkbox", { name: "开启自动动画", exact: true });
  await auto.check();
  await expect(page.locator(".transform-animations .selected-frame")).toHaveCount(0);
  await editOpacity("90");
  const animated = (await save()).clips[0];
  expect(animated.keyframes.at(-1).time).toBe(6);
  expect(animated.keyframes.at(-1).value.opacity).toBe(0.9);
  await expect(page.locator(".clip-animation")).toHaveCount(3);
  await undo.click();
  await auto.uncheck();
  await expect(ends).toHaveCount(2);
  // An implicit property target must not redirect the Add Animation command.
  await page.getByRole("button", { name: "添加动画", exact: true }).click();
  await expect(page.locator(".clip-animation")).toHaveCount(3);
  await expect(page.locator(".clip-animation").last()).toHaveAttribute("data-end", "6");
  await undo.click();
  await expect(ends).toHaveCount(2);
  await save();
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project").first().click();
  await page.locator(".timeline-clip").first().click({ position: { x: 20, y: 12 } });
  await progress.fill("6");
  await expect(ends.nth(1)).toHaveAttribute("aria-pressed", "true");
  expect(opacities(await save())).toEqual([1, 0.25, 0.25, 0.6]);
  expect(errors).toEqual([]);
  console.log(`最近动画末尾编辑、红点跟随、静止间隔、撤销重做、编辑所有动画、自动动画及保存重开通过：${root}`);
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: path.join(root, "failure.png") }).catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app.close();
}
