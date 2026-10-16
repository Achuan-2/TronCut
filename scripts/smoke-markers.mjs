import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/timeline-markers-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
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
const project = createProject("区域标记验收");
project.clips = [{ ...newText("titles", 0, 0, "区域标记演示"), duration: 12 }];
project.markers = [{ id: "legacy", time: 1, label: "旧标记" }];
const file = path.join(root, "markers.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [];
const open = async () => {
  app = await electron.launch({ args: [".", file], env });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator(".timeline-clip.text")).toHaveCount(1);
};
const dialog = () => page.getByRole("dialog");
const marker = (name) =>
  page.getByRole("button", { name: `标记：${name}`, exact: true });
const save = () =>
  dialog().getByRole("button", { name: "保存标记", exact: true }).click();
const geometry = (locator) =>
  locator.evaluate((node) => ({
    left: parseFloat(node.style.left),
    width: parseFloat(node.style.width),
  }));
const color = (locator) =>
  locator.evaluate((node) => node.style.getPropertyValue("--marker-color"));
const drag = async (locator, delta, release = true) => {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, {
    steps: 5,
  });
  if (release) await page.mouse.up();
};
try {
  await open();
  await expect
    .poll(() => color(page.locator('[data-marker-id="legacy"]')))
    .toBe("#e6c66f");
  await expect(page.getByTitle("添加标记", { exact: true })).toHaveCount(0);
  await page.getByTitle("添加区域标记（Shift+拖动标尺）", { exact: true }).click();
  await expect(
    dialog().getByRole("checkbox", { name: "区域标记", exact: true }),
  ).toBeChecked();
  await dialog().getByLabel("标记名称", { exact: true }).fill("取消的标记");
  await page.keyboard.press("Escape");
  await expect(dialog()).toHaveCount(0);
  await expect(page.locator(".timeline-marker")).toHaveCount(1);

  await page.locator(".timeline-clip.text").click();
  await page
    .getByTitle("添加区域标记（Shift+拖动标尺）", { exact: true })
    .click();
  await expect(
    dialog().getByLabel("标记开始时间（秒）", { exact: true }),
  ).toHaveValue("0");
  await expect(
    dialog().getByLabel("标记结束时间（秒）", { exact: true }),
  ).toHaveValue("12");
  await dialog().getByLabel("标记名称", { exact: true }).fill("片头修改");
  await dialog()
    .getByLabel("标记备注", { exact: true })
    .fill("缩短开场停顿\n补充标题动画");
  await dialog().getByLabel("标记开始时间（秒）", { exact: true }).fill("2");
  await dialog().getByLabel("标记结束时间（秒）", { exact: true }).fill("1");
  await expect(
    dialog().getByRole("button", { name: "保存标记", exact: true }),
  ).toBeDisabled();
  await dialog().getByLabel("标记结束时间（秒）", { exact: true }).fill("6");
  await dialog()
    .getByRole("button", { name: "标记颜色：紫色", exact: true })
    .click();
  await dialog().screenshot({ path: path.join(root, "editor.png") });
  await save();
  const range = page
    .locator(".range-marker")
    .filter({ has: marker("片头修改") });
  await expect(range).toHaveAttribute("title", /缩短开场停顿\n补充标题动画/);
  await expect.poll(() => color(range)).toBe("#ba94ea");
  const zoom = (await geometry(range)).width / 4;
  await marker("片头修改").click();
  await expect
    .poll(() =>
      page
        .locator(".ruler-playhead")
        .evaluate((node) => parseFloat(node.style.left)),
    )
    .toBeCloseTo(2 * zoom);

  await drag(marker("片头修改"), zoom);
  await expect
    .poll(() => geometry(range))
    .toEqual({ left: 3 * zoom, width: 4 * zoom });
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect
    .poll(() => geometry(range))
    .toEqual({ left: 2 * zoom, width: 4 * zoom });
  await page.getByTitle("重做 Ctrl+Shift+Z", { exact: true }).click();
  await drag(
    range.getByRole("separator", { name: "片头修改：结束", exact: true }),
    zoom,
  );
  await expect
    .poll(() => geometry(range))
    .toEqual({ left: 3 * zoom, width: 5 * zoom });
  await drag(
    range.getByRole("separator", { name: "片头修改：开始", exact: true }),
    zoom,
  );
  await expect
    .poll(() => geometry(range))
    .toEqual({ left: 4 * zoom, width: 4 * zoom });
  await drag(marker("片头修改"), zoom, false);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect
    .poll(() => geometry(range))
    .toEqual({ left: 4 * zoom, width: 4 * zoom });
  const startHandle = range.getByRole("separator", {
    name: "片头修改：开始",
    exact: true,
  });
  await startHandle.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => geometry(range).then((value) => value.left))
    .toBeCloseTo((4 + 1 / 30) * zoom);
  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(() => geometry(range))
    .toEqual({ left: 4 * zoom, width: 4 * zoom });
  await expect
    .poll(() =>
      page
        .locator(".ruler-playhead")
        .evaluate((node) => parseFloat(node.style.left)),
    )
    .toBeCloseTo(2 * zoom);

  await marker("片头修改").click({ button: "right" });
  await expect(dialog().getByLabel("标记备注", { exact: true })).toHaveValue(
    "缩短开场停顿\n补充标题动画",
  );
  await dialog()
    .getByLabel("自定义标记颜色", { exact: true })
    .evaluate((node) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(node, "#abc123");
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await save();
  await expect.poll(() => color(range)).toBe("#abc123");
  await page.getByTitle("添加区域标记（Shift+拖动标尺）", { exact: true }).click();
  await dialog().getByRole("checkbox", { name: "区域标记", exact: true }).uncheck();
  await dialog().getByLabel("标记名称", { exact: true }).fill("校对点");
  await dialog()
    .getByRole("button", { name: "标记颜色：橙色", exact: true })
    .click();
  await save();

  const ruler = await page.locator(".ruler").boundingBox();
  // Cancelling while the pointer is held must not create a marker on release.
  await page.keyboard.down("Shift");
  await page.mouse.move(ruler.x + 11 * zoom, ruler.y + 7);
  await page.mouse.down();
  await page.mouse.move(ruler.x + 10.5 * zoom, ruler.y + 7, { steps: 3 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(dialog()).toHaveCount(0);
  await expect(page.locator(".timeline-marker")).toHaveCount(3);
  await page.keyboard.down("Shift");
  await page.mouse.move(ruler.x + 10 * zoom, ruler.y + 7);
  await page.mouse.down();
  await page.mouse.move(ruler.x + 8.5 * zoom, ruler.y + 7, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await expect(
    dialog().getByRole("checkbox", { name: "区域标记", exact: true }),
  ).toBeChecked();
  await expect(
    dialog().getByLabel("标记开始时间（秒）", { exact: true }),
  ).toHaveValue("8.5");
  await expect(
    dialog().getByLabel("标记结束时间（秒）", { exact: true }),
  ).toHaveValue("10");
  await dialog().getByLabel("标记名称", { exact: true }).fill("旁白检查");
  await dialog()
    .getByRole("button", { name: "标记颜色：蓝色", exact: true })
    .click();
  await save();
  await expect(page.locator(".timeline-marker")).toHaveCount(4);
  await marker("校对点").focus();
  await page.keyboard.press("Delete");
  await expect(marker("校对点")).toHaveCount(0);
  await expect(page.locator(".timeline-clip.text")).toHaveCount(1);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(marker("校对点")).toHaveCount(1);
  await page.getByTitle("保存工程 Ctrl+S", { exact: true }).click();
  await expect
    .poll(
      async () => JSON.parse(await fs.readFile(file, "utf8")).markers.length,
    )
    .toBe(4);
  await expect(
    page.getByRole("heading", { name: "正在处理…", exact: true }),
  ).toBeHidden();
  await page
    .locator(".timeline")
    .screenshot({ path: path.join(root, "timeline.png") });
  await app.close();
  await open();
  await expect(page.locator(".timeline-marker")).toHaveCount(4);
  const reopened = page
    .locator(".range-marker")
    .filter({ has: marker("片头修改") });
  await expect
    .poll(() => geometry(reopened))
    .toEqual({ left: 4 * zoom, width: 4 * zoom });
  await expect.poll(() => color(reopened)).toBe("#abc123");
  await marker("旧标记").dblclick();
  await expect(
    dialog().getByRole("button", { name: "标记颜色：黄色", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    dialog().getByRole("checkbox", { name: "区域标记", exact: true }),
  ).not.toBeChecked();
  await dialog()
    .getByRole("checkbox", { name: "区域标记", exact: true })
    .check();
  await save();
  await expect(page.locator('[data-marker-id="legacy"]')).toHaveClass(
    /range-marker/,
  );
  await marker("旧标记").dblclick();
  await dialog()
    .getByRole("checkbox", { name: "区域标记", exact: true })
    .uncheck();
  await save();
  await expect(page.locator('[data-marker-id="legacy"]')).toHaveClass(
    /point-marker/,
  );
  await marker("旧标记").click({ button: "right" });
  await dialog().getByRole("button", { name: "删除标记", exact: true }).click();
  await expect(marker("旧标记")).toHaveCount(0);
  await page.getByTitle("撤销 Ctrl+Z", { exact: true }).click();
  await expect(marker("旧标记")).toHaveCount(1);
  await marker("旧标记").dblclick();
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      root,
      checks:
        "区域/点标记、选中片段范围、备注、预设/自定义颜色、时间校验、移动/两端裁切、单步撤销、取消、键盘微调、反向框选、删除隔离、保存重开和旧标记兼容",
      rendererErrors: errors,
    }),
  );
} catch (error) {
  await page
    ?.screenshot({ path: path.join(root, "failure.png") })
    .catch(() => {});
  console.error(root);
  throw error;
} finally {
  await app?.close();
}
