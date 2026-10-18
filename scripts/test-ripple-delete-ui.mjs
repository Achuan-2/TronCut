import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/ripple-delete/run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const bundled = await build({
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
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const project = createProject("波纹删除定位测试");
project.clips = [
  ["before", 0, 30],
  ["removed", 30, 60],
  ["next", 90, 10],
  ["tail", 100, 80],
].map(([id, start, duration]) => ({
  ...newText("titles", start, 0, id),
  id,
  duration,
}));
project.tracks.find((track) => track.id === "audio").locked = true;
project.clips.push({ ...newText("audio", 5), id: "locked", duration: 2 });
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
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  const pane = page.locator(".timeline-scroll");
  const clip = (id) => page.locator(`.timeline-clip[data-clip-id="${id}"]`);
  const command = (name) =>
    app.evaluate(({ BrowserWindow }, name) => {
      BrowserWindow.getAllWindows()[0].webContents.send("shortcut", name);
    }, name);
  const reveal = async (time) => {
    await pane.evaluate((element, time) => {
      element.scrollLeft = Math.max(0, time * 65 - 100);
    }, time);
  };
  const select = async (id, time, modifiers = []) => {
    await reveal(time);
    await clip(id).click({ position: { x: 25, y: 20 }, modifiers });
    await expect(clip(id)).toHaveClass(/selected/);
  };
  const seek = async (time) => {
    await reveal(time);
    const bounds = await pane.boundingBox();
    const left = await pane.evaluate((element) => element.scrollLeft);
    const ruler = await page.locator(".ruler").boundingBox();
    await page.mouse.click(bounds.x + time * 65 - left, ruler.y + 12);
    await expect(page.getByLabel("播放进度")).toHaveValue(String(time));
  };
  const expectSplice = async (time) => {
    await expect(page.getByLabel("播放进度")).toHaveValue(String(time));
    await expect
      .poll(() =>
        pane.evaluate((element, time) => {
          const target = Math.max(
            0,
            Math.min(
              element.scrollWidth - element.clientWidth,
              time * 65 - element.clientWidth / 2,
            ),
          );
          return Math.abs(element.scrollLeft - target);
        }, time),
      )
      .toBeLessThanOrEqual(1);
    await expect
      .poll(() =>
        page
          .locator(".ruler-playhead")
          .evaluate((element) => parseFloat(element.style.left)),
      )
      .toBe(time * 65);
  };

  // Delete a long middle section while the playhead and viewport are near its end.
  await select("removed", 30);
  await seek(80);
  await page.keyboard.press("Shift+Delete");
  await expectSplice(30);
  await expect(clip("removed")).toHaveCount(0);
  await expect(clip("next")).toHaveCSS("left", "1950px");

  // Repeated deletions must reveal the splice even if its time has not changed.
  await select("next", 30);
  await seek(80);
  await page.getByRole("button", { name: "删除选项", exact: true }).click();
  await page.getByRole("menuitem", { name: /波纹删除/ }).click();
  await expectSplice(30);
  await expect(clip("tail")).toHaveCSS("left", "1950px");

  await command("undo");
  await select("next", 30);
  await clip("next").click({ button: "right", position: { x: 25, y: 20 } });
  await page.getByRole("menuitem", { name: /波纹删除/ }).click();
  await expectSplice(30);

  await command("undo");
  await select("next", 30);
  await seek(80);
  await command("rippleDelete");
  await expectSplice(30);

  // Normal deletion and a locked-only selection leave the current position alone.
  await command("undo");
  await select("next", 30);
  await seek(80);
  const left = await pane.evaluate((element) => element.scrollLeft);
  await page.keyboard.press("Delete");
  await expect(page.getByLabel("播放进度")).toHaveValue("80");
  expect(await pane.evaluate((element) => element.scrollLeft)).toBe(left);
  await command("undo");
  await reveal(5);
  await clip("locked").click({ button: "right", position: { x: 25, y: 20 } });
  await seek(80);
  await command("rippleDelete");
  await expect(page.getByLabel("播放进度")).toHaveValue("80");

  // Removing the tail clamps the playhead to the remaining project end.
  await select("tail", 40);
  await seek(100);
  await command("rippleDelete");
  await expectSplice(40);
  await command("undo");

  // Multi-selection focuses the earliest splice.
  await select("next", 30);
  await select("tail", 40, ["Control"]);
  await seek(80);
  await command("rippleDelete");
  await expectSplice(30);

  // A mixed selection deletes only editable clips; a locked-only one is a no-op.
  await command("selectAll");
  await command("rippleDelete");
  await expectSplice(0);
  await expect(clip("locked")).toHaveCount(1);
  await command("selectAll");
  await seek(6);
  await command("rippleDelete");
  await expect(page.getByLabel("播放进度")).toHaveValue("6");
  await page.screenshot({ path: path.join(root, "verified.png") });
  expect(errors).toEqual([]);
  console.log(
    `波纹删除定位验证通过：快捷键、工具栏、右键菜单、原生命令、重复删除、多选、锁定轨和末尾删除。${root}`,
  );
} catch (error) {
  await app.windows()[0]?.screenshot({ path: path.join(root, "failure.png") });
  throw error;
} finally {
  await app.close();
}
