import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/timeline-clip-color/run-${Date.now()}`);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
await fs.writeFile(
  path.join(profile, "preferences.json"),
  JSON.stringify({
    storage: { projectDirectory: path.join(root, "projects") },
  }),
);
const source = path.join(root, "image.svg");
await fs.writeFile(
  source,
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#41725b"/></svg>',
);
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
const project = createProject("时间线素材颜色");
project.canvas = { width: 640, height: 360, fps: 30, background: "#151719" };
project.tracks.push({
  id: "locked",
  name: "锁定",
  hidden: false,
  muted: false,
  locked: true,
});
project.assets = [
  {
    id: "image",
    path: source,
    name: "测试.svg",
    kind: "image",
    width: 320,
    height: 180,
    duration: 0,
    hasAudio: false,
  },
];
project.clips = [
  { ...newText("titles", 0, 0, "素材一"), id: "one", duration: 4 },
  { ...newText("titles", 5, 0, "素材二"), id: "two", duration: 4 },
  {
    ...newText("video", 0),
    id: "image",
    kind: "image",
    text: undefined,
    style: undefined,
    assetId: "image",
    duration: 9,
  },
  { ...newText("locked", 0), id: "locked", duration: 4 },
  {
    ...newText("titles", 10, 0, "组一"),
    id: "group-one",
    groupId: "group",
    duration: 2,
  },
  {
    ...newText("titles", 12, 0, "组二"),
    id: "group-two",
    groupId: "group",
    duration: 2,
  },
];
const file = path.join(root, "fixture.troncut");
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
    BrowserWindow.getAllWindows()[0].setSize(1440, 1050),
  );
  await page.getByRole("button", { name: "恢复编辑", exact: true }).click();
  const clip = (id) => page.locator(`.timeline-clip[data-clip-id="${id}"]`);
  const open = async (id) => {
    await clip(id).click({ button: "right", position: { x: 20, y: 12 } });
    await page.getByRole("menuitem", { name: "设置颜色", exact: true }).click();
  };
  const dialog = page.getByRole("dialog", {
    name: "设置素材颜色",
    exact: true,
  });
  const apply = () =>
    dialog.getByRole("button", { name: "应用颜色", exact: true }).click();
  const save = async () => {
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator(".busy-overlay")).toHaveCount(0);
    await expect(page.locator(".project-save-state")).not.toContainText("*");
    return JSON.parse(await fs.readFile(file, "utf8"));
  };
  await open("one");
  await expect(
    dialog.getByRole("group", { name: "预设颜色" }).getByRole("button"),
  ).toHaveCount(10);
  await dialog.getByRole("button", { name: "红色", exact: true }).click();
  await page.screenshot({ path: path.join(root, "color-dialog.png") });
  await apply();
  await expect(clip("one")).toHaveAttribute("data-timeline-color", "#ba5555");
  await expect(clip("one")).toHaveCSS("background-color", "rgb(186, 85, 85)");
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(clip("one")).not.toHaveAttribute("data-timeline-color");
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await expect(clip("one")).toHaveAttribute("data-timeline-color", "#ba5555");
  await save();

  // Editing custom color is a draft; invalid input and cancellation never mutate clips.
  await open("one");
  await dialog.getByLabel("颜色值", { exact: true }).fill("#xyz");
  await expect(
    dialog.getByRole("button", { name: "应用颜色", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("颜色值", { exact: true }).fill("#123abc");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(clip("one")).toHaveAttribute("data-timeline-color", "#ba5555");
  await expect(page.locator(".project-save-state")).not.toContainText("*");

  await clip("one").click({ position: { x: 20, y: 12 } });
  await clip("image").click({
    modifiers: ["Control"],
    position: { x: 20, y: 12 },
  });
  await open("image");
  await expect(
    dialog.getByRole("button", { name: "应用颜色", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("自定义颜色", { exact: true }).evaluate((node) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(node, "#ffeeaa");
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(dialog.getByLabel("颜色值", { exact: true })).toHaveValue(
    "#ffeeaa",
  );
  await apply();
  for (const id of ["one", "image"])
    await expect(clip(id)).toHaveAttribute("data-timeline-color", "#ffeeaa");
  await expect(clip("image").locator(".clip-label")).toHaveCSS(
    "background-color",
    "rgb(255, 238, 170)",
  );
  await expect(clip("image").locator(".clip-label")).toHaveCSS(
    "color",
    "rgb(17, 17, 17)",
  );
  await expect(
    clip("image").locator(".timeline-thumbnail").first(),
  ).toBeVisible();
  const saved = await save();
  expect(saved.clips.find((entry) => entry.id === "one").style).toEqual(
    project.clips[0].style,
  );
  expect(
    saved.clips.find((entry) => entry.id === "two").timelineColor,
  ).toBeUndefined();
  await page.screenshot({ path: path.join(root, "timeline-colors.png") });

  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  await page.locator(".recent-project").first().click();
  for (const id of ["one", "image"])
    await expect(clip(id)).toHaveAttribute("data-timeline-color", "#ffeeaa");
  await open("one");
  await dialog
    .getByRole("button", { name: "恢复默认颜色", exact: true })
    .click();
  await apply();
  await expect(clip("one")).not.toHaveAttribute("data-timeline-color");
  expect(
    (await save()).clips.find((entry) => entry.id === "one"),
  ).not.toHaveProperty("timelineColor");

  await open("group-one");
  await dialog.getByRole("button", { name: "蓝色", exact: true }).click();
  await apply();
  await expect(clip("group-one")).toHaveAttribute(
    "data-timeline-color",
    "#527db6",
  );
  const grouped = await save();
  expect(
    grouped.clips
      .filter((entry) => entry.groupId === "group")
      .map((entry) => entry.timelineColor),
  ).toEqual(["#527db6", "#527db6"]);
  await clip("locked").click({ button: "right", position: { x: 20, y: 12 } });
  await expect(
    page.getByRole("menuitem", { name: "设置颜色", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
  console.log(
    `预设/自定义颜色、浅色对比、取消/默认、多选/组合、锁定、撤销重做及保存重开通过：${root}`,
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
