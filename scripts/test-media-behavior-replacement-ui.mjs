import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(
  `test-output/media-behavior-replacement-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: {
      projectDirectory: path.join(root, "projects"),
      backupDirectory: path.join(root, "backups"),
    },
  }),
);
const bundle = await build({
  stdin: {
    contents:
      'export { createProject, newText } from "./shared/model"; export { createBehavior } from "./shared/behaviors";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { createProject, newText, createBehavior } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const source = path.join(root, "image.png");
const movie = path.join(root, "video.mp4");
await sharp("resources/icon.png").resize(120, 120).png().toFile(source);
execFileSync(
  path.resolve("resources/bin/ffmpeg.exe"),
  [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-i",
    source,
    "-t",
    "5",
    "-r",
    "10",
    "-pix_fmt",
    "yuv420p",
    movie,
  ],
  { windowsHide: true },
);
const project = createProject("媒体行为替换验证");
const kinds = ["text", "image", "video", "locked"];
project.tracks = kinds.map((id) => ({
  id,
  name: id,
  hidden: false,
  muted: false,
  locked: id === "locked",
}));
project.assets = ["image", "video"].map((kind) => ({
  id: kind,
  name: kind,
  kind,
  path: path.basename(kind === "image" ? source : movie),
  width: 120,
  height: 120,
  duration: kind === "image" ? 0 : 5,
  hasAudio: false,
}));
project.clips = kinds.map((id, index) => {
  const kind = id === "locked" ? "image" : id;
  return {
    ...newText(id, 0, 0, "行为替换"),
    id,
    kind,
    duration: 5,
    ...(kind === "text" ? {} : { assetId: kind }),
    transform: { x: 0.2 + index * 0.2, y: 0.5, scale: 0.2, opacity: 1 },
    behaviors: Array.from({ length: id === "image" ? 32 : 2 }, () => ({
      ...createBehavior("fade", 5, kind),
      enabled: false,
    })),
  };
});
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
const launch = async () => {
  app = await electron.launch({ args: [".", file], env });
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".timeline-clip").first()).toBeVisible();
  await page
    .locator(".tool-rail")
    .getByRole("button", { name: "行为", exact: true })
    .click();
  return page;
};
const save = async (page) => {
  await page.getByTitle("保存项目 Ctrl+S", { exact: true }).click();
  await expect(page.locator(".toast")).toContainText("项目已保存");
  await expect(page.locator(".busy-overlay")).toHaveCount(0);
  return JSON.parse(await fs.readFile(file, "utf8"));
};
try {
  let page = await launch();
  const clip = (id) => page.locator(`.timeline-clip[data-clip-id="${id}"]`);
  const showTrack = (id) =>
    page
      .locator(`.track-header[data-track-id="${id}"]`)
      .scrollIntoViewIfNeeded();
  const effects = (id) => clip(id).locator(".clip-behavior-effect");
  const card = (name) =>
    page.locator(".behavior-grid").getByRole("button", { name, exact: true });
  const mediaTab = () =>
    page.getByRole("tab", { name: "媒体", exact: true }).click();
  await mediaTab();

  // At the old limit, an actual canvas drop must still replace all behaviors.
  await card("淡入").dragTo(
    page.locator('.preview-layer[data-clip-id="image"]'),
  );
  let saved = await save(page);
  expect(saved.clips.find((c) => c.id === "image").behaviors).toHaveLength(1);
  expect(saved.clips.find((c) => c.id === "image").behaviors[0].preset).toBe(
    "media-fade",
  );
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  saved = await save(page);
  expect(saved.clips.find((c) => c.id === "image").behaviors).toEqual(
    project.clips[1].behaviors,
  );
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();

  // Timeline drops, including repeated application, retain only the new effect.
  await showTrack("video");
  await card("漂移").dragTo(clip("video"), {
    targetPosition: { x: 40, y: 15 },
  });
  await expect(effects("video")).toHaveCount(1);
  await expect(effects("video")).toHaveText("漂移");
  await card("漂移").dragTo(clip("video"), {
    targetPosition: { x: 40, y: 15 },
  });
  await expect(effects("video")).toHaveCount(1);
  await card("淡入").dragTo(clip("video"), {
    targetPosition: { x: 40, y: 15 },
  });
  await expect(effects("video")).toHaveText("淡入");

  // Media presets also replace old text behaviors; text presets retain stacking.
  await showTrack("text");
  await clip("text").click();
  await card("漂移").dblclick();
  await expect(effects("text")).toHaveCount(1);
  await page.locator("#behavior-library-text-tab").click();
  await card("切换").dblclick();
  await expect(effects("text")).toHaveCount(2);
  await mediaTab();
  await card("淡入").dblclick();
  await expect(effects("text")).toHaveCount(1);

  await showTrack("locked");
  await card("漂移").dragTo(clip("locked"), {
    targetPosition: { x: 40, y: 15 },
  });
  saved = await save(page);
  expect(saved.clips.find((c) => c.id === "locked").behaviors).toEqual(
    project.clips[3].behaviors,
  );
  for (const id of ["text", "image", "video"]) {
    const behaviors = saved.clips.find((c) => c.id === id).behaviors;
    expect(behaviors).toHaveLength(1);
    expect(behaviors[0].preset).toBe("media-fade");
  }
  await app.close();
  app = null;
  page = await launch();
  for (const id of ["text", "image", "video"]) {
    await showTrack(id);
    await expect(effects(id)).toHaveCount(1);
    await expect(effects(id)).toHaveText("淡入");
  }
  expect(errors).toEqual([]);
  console.log(
    `媒体行为画布/时间线拖入、重复替换、双击、32项上限、锁定、撤销重做与保存重开通过：${root}`,
  );
} catch (error) {
  if (app)
    await (
      await app.firstWindow()
    )
      .screenshot({ path: path.join(root, "failure.png") })
      .catch(() => {});
  console.error(root);
  throw error;
} finally {
  if (app) await app.close();
}
