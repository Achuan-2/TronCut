import { _electron as electron, expect } from "@playwright/test";
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(`test-output/behavior-inspector-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const bundle = await build({
  stdin: {
    contents:
      'export {createProject,newText} from "./shared/model"; export {createBehavior} from "./shared/behaviors";',
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
const project = createProject("行为面板独立展开");
const clip = newText("titles", 0, 0, "独立展开测试");
clip.behaviors = [createBehavior("scale", 5), createBehavior("reveal", 5)];
project.clips = [clip];
const file = path.join(root, "project.troncut");
await fs.writeFile(file, JSON.stringify(project));
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [".", file], env });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const effects = page.locator(".clip-behavior-effect");
  await effects.first().click();
  const first = page.locator(".behavior-property").nth(0);
  const second = page.locator(".behavior-property").nth(1);
  await first.getByRole("tab", { name: "期间", exact: true }).click();
  await first.getByLabel("行为样式", { exact: true }).selectOption("pulse");
  await second.getByRole("button", { name: "显示", exact: true }).click();
  await expect(first.locator(".behavior-name")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(second.locator(".behavior-name")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(
    first.getByRole("tab", { name: "期间", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    second.getByRole("tab", { name: "进", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(first.getByLabel("行为样式", { exact: true })).toHaveValue(
    "pulse",
  );
  const style = (locator) =>
    locator.evaluate((element) => {
      const css = getComputedStyle(element);
      return Object.fromEntries(
        [
          "backgroundColor",
          "color",
          "borderColor",
          "borderWidth",
          "borderRadius",
          "fontSize",
          "paddingTop",
          "paddingBottom",
        ].map((key) => [key, css[key]]),
      );
    });
  const typeStyle = await style(second.getByLabel("行为类型", { exact: true }));
  expect(typeStyle).toEqual(
    await style(second.getByLabel("行为样式", { exact: true })),
  );
  expect(typeStyle).toEqual(
    await style(second.getByLabel("行为移动", { exact: true })),
  );
  const typeBox = await second
    .getByLabel("行为类型", { exact: true })
    .boundingBox();
  const styleBox = await second
    .getByLabel("行为样式", { exact: true })
    .boundingBox();
  expect(typeBox.width).toBeCloseTo(styleBox.width, 0);
  expect(Math.abs(typeBox.height - styleBox.height)).toBeLessThanOrEqual(2);
  await second.getByLabel("行为类型", { exact: true }).scrollIntoViewIfNeeded();
  await page
    .locator(".inspector")
    .screenshot({ path: path.join(root, "dropdown-styles.png") });
  await second.getByLabel("行为类型", { exact: true }).click();
  await page.getByRole("menuitem", { name: "文本", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "最后一个到第一个", exact: true })
    .click();
  await expect(second.getByLabel("行为类型", { exact: true })).toHaveText(
    "文本 - 最后一个到第一个",
  );
  await first.locator(".behavior-name").click();
  await expect(first.locator(".behavior-name")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(second.locator(".behavior-name")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await effects.first().click();
  await expect(first.locator(".behavior-name")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(
    first.getByRole("tab", { name: "期间", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(second.getByRole("tabpanel")).toBeVisible();
  await second.getByRole("tab", { name: "出", exact: true }).click();
  await expect(
    first.getByRole("tab", { name: "期间", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .locator(".inspector")
    .screenshot({ path: path.join(root, "independent-panels.png") });
  await page.getByTitle("保存项目 Ctrl+S", { exact: true }).click();
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(file, "utf8")).clips[0].behaviors[0].during
          .style,
    )
    .toBe("pulse");
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ root, typeStyle, errors }, null, 2));
} catch (error) {
  await (
    await app.firstWindow()
  )
    .screenshot({ path: path.join(root, "failure.png") })
    .catch(() => { });
  console.error(root);
  throw error;
} finally {
  await app.close();
}
