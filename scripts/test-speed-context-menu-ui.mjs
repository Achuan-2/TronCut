import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(
  `test-output/speed-context-menu-ui/run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: { projectDirectory: path.join(root, "projects") },
  }),
);
const source = path.join(root, "source.mp4");
await promisify(execFile)(
  path.resolve(
    "resources/bin",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  ),
  [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x180:r=30:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ],
  { windowsHide: true },
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
const project = createProject("右键剪辑速度");
project.canvas = { width: 640, height: 360, fps: 30, background: "#000000" };
project.assets = [
  {
    id: "source",
    path: source,
    name: "源视频",
    kind: "video",
    duration: 4,
    width: 320,
    height: 180,
    hasAudio: true,
  },
];
project.tracks = ["video", "audio", "titles", "locked"].map((id, i) => ({
  id,
  name: `轨道${4 - i}`,
  hidden: false,
  muted: false,
  locked: id === "locked",
}));
project.clips = [
  ...["video", "audio", "locked"].map((id) => ({
    ...newText(id, 0),
    id,
    kind: id === "audio" ? "audio" : "video",
    assetId: "source",
    duration: 4,
  })),
  { ...newText("titles", 0, 0, "文字"), id: "text", duration: 4 },
];
const file = path.join(root, "project.troncut");
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
    BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
  );
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  const clip = (id) => page.locator(`.timeline-clip[data-clip-id="${id}"]`);
  const strip = (id) => clip(id).locator(".clip-speed-effect");
  const add = page.getByRole("menuitem", { name: "添加剪辑速度", exact: true });
  const speed = page.getByRole("spinbutton", { name: "剪辑速度（倍）", exact: true });
  const progress = page.getByLabel("播放进度", { exact: true });
  const undo = () => page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  const open = (id) =>
    clip(id).click({ button: "right", position: { x: 28, y: 18 } });
  const save = async () => {
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".busy-overlay")).toHaveCount(0);
    await expect(page.locator(".project-save-state")).not.toContainText("*");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  await progress.fill("1");
  for (const id of ["video", "audio"]) {
    await open(id);
    await expect(add).toBeEnabled();
    await add.click();
    await expect(strip(id)).toHaveCount(1);
    await expect(speed).toHaveValue("1");
    await expect(progress).toHaveValue("1");
    await speed.fill("2");
    await expect(
      page.getByRole("spinbutton", { name: "剪辑持续时间（秒）", exact: true }),
    ).toHaveValue("2");
    await open(id);
    await expect(add).toBeDisabled();
    await page.keyboard.press("Escape");
    await undo();
    await expect(speed).toHaveValue("1");
    await undo();
    await expect(strip(id)).toHaveCount(0);
  }
  await open("locked");
  await expect(add).toBeDisabled();
  await page.keyboard.press("Escape");
  await open("text");
  await expect(add).toHaveCount(0);
  await page.keyboard.press("Escape");

  await clip("video").click({ position: { x: 28, y: 18 } });
  await clip("audio").click({
    modifiers: ["Control"],
    position: { x: 28, y: 18 },
  });
  await open("audio");
  await add.click();
  await expect(strip("video")).toHaveCount(1);
  await expect(strip("audio")).toHaveCount(1);
  let saved = await save();
  for (const id of ["video", "audio"])
    expect(saved.clips.find((clip) => clip.id === id)).toMatchObject({
      speedEffect: true,
      speed: 1,
      duration: 4,
    });
  expect(
    saved.clips.find((clip) => clip.id === "locked").speedEffect,
  ).toBeUndefined();
  expect(
    saved.clips.find((clip) => clip.id === "text").speedEffect,
  ).toBeUndefined();
  await undo();
  await expect(strip("video")).toHaveCount(0);
  await expect(strip("audio")).toHaveCount(0);

  // The shared menu also exposes the shortcut on the canvas video object.
  await page.keyboard.press("Escape");
  await clip("video").click({ position: { x: 28, y: 18 } });
  await page
    .locator('.preview-layer[data-clip-id="video"]')
    .click({ button: "right", position: { x: 20, y: 20 } });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(strip("video")).toHaveCount(1);
  await expect(strip("audio")).toHaveCount(0);
  saved = await save();
  expect(saved.clips.find((clip) => clip.id === "video").speedEffect).toBe(
    true,
  );
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project").first().click();
  await expect(strip("video")).toHaveCount(1);
  await clip("video").click({ position: { x: 28, y: 18 } });
  await expect(speed).toHaveValue("1");
  await page.screenshot({ path: path.join(root, "speed-context-menu.png") });
  expect(errors).toEqual([]);
  console.log(
    `视频/音频及画布右键添加、倍率/时长编辑、重复禁用、多选添加、锁定/文字限制、撤销和保存重开通过：${root}`,
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
