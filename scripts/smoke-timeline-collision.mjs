import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/timeline-collision/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundled = await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { hasProjectTimelineOverlap } from "./shared/timeline-collision";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, hasProjectTimelineOverlap } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const project = createProject("同轨防重叠测试");
for (const track of project.tracks) track.height = 48;
project.clips = [0, 1, 6, 12].map((start, index) => ({
  ...newText("titles", start, 0, `素材 ${index + 1}`),
  duration: index < 2 ? 3 : 2,
}));
const file = path.join(root, "fixture.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  const command = (name) =>
    app.evaluate(({ BrowserWindow }, command) => {
      BrowserWindow.getAllWindows()[0].webContents.send("shortcut", command);
    }, name);
  const group = page.locator(".clip-group");
  await expect(group).toHaveCount(1);
  await expect(page.locator(".timeline-clip")).toHaveCount(3);
  await group.dblclick();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await expect(page.locator(".track-lane")).toHaveCount(2);
  const member = page.locator(
    `.timeline-clip[data-clip-id="${project.clips[0].id}"]`,
  );
  await member.click();
  const handle = await member.locator(".trim-handle.right").boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle.x + 650, handle.y + 10, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("status")).toContainText(
    "同一轨道上的素材不能重叠",
  );
  await expect
    .poll(() => member.evaluate((element) => parseFloat(element.style.width)))
    .toBe(195);
  await page.getByRole("tab", { name: "主时间线", exact: true }).click();

  const tail = page.locator(
    `.timeline-clip[data-clip-id="${project.clips[2].id}"]`,
  );
  const bounds = await tail.boundingBox();
  await page.mouse.move(bounds.x + 20, bounds.y + 18);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 20 - 260, bounds.y + 18, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() => tail.evaluate((element) => parseFloat(element.style.left)))
    .toBe(260);

  const right = await tail.locator(".trim-handle.right").boundingBox();
  await page.mouse.move(right.x + right.width / 2, right.y + 10);
  await page.mouse.down();
  await page.mouse.move(right.x + 455, right.y + 10, { steps: 15 });
  await page.mouse.up();
  await expect
    .poll(() => tail.evaluate((element) => parseFloat(element.style.width)))
    .toBe(520);
  await tail.click();
  await command("duplicate");
  await expect(page.locator(".timeline-clip")).toHaveCount(4);
  await command("save");
  await expect(page.getByRole("status")).toContainText("项目已保存");
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(saved.clips.length, 5);
  assert.equal(
    saved.clips.find((clip) => clip.id === project.clips[0].id).start,
    0,
  );
  assert.equal(
    saved.clips.find((clip) => clip.id === project.clips[1].id).start,
    1,
  );
  assert.equal(
    saved.clips.find((clip) => clip.id === project.clips[2].id).start,
    4,
  );
  assert.equal(
    saved.clips.find((clip) => clip.id === project.clips[2].id).duration,
    8,
  );
  assert.equal(
    saved.clips.find(
      (clip) => !project.clips.some((before) => before.id === clip.id),
    ).start,
    14,
  );
  assert.equal(hasProjectTimelineOverlap(saved), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(root, "no-overlap.png") });
  console.log(
    `旧重叠自动组合与分轨、组内延长保护、移动和裁剪碰撞限制、拷贝自动避让及保存通过：${root}`,
  );
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => { });
  console.log(root);
  throw error;
} finally {
  await app.close();
}
