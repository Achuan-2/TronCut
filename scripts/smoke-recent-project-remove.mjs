import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(
  `test-output/recent-project-remove/run-${Date.now()}`,
);
const profile = path.join(root, "profile");
await fs.mkdir(profile, { recursive: true });
const existing = path.join(root, "existing.troncut");
const missing = path.join(root, "missing.troncut");
await fs.writeFile(existing, "keep this project file");
const history = path.join(profile, "recent-projects.json");
await fs.writeFile(
  history,
  JSON.stringify(
    [
      { file: existing, name: "存在的项目" },
      { file: missing, name: "失效项目" },
    ].map((entry) => ({
      ...entry,
      openedAt: Date.now(),
      modifiedAt: Date.now(),
      duration: 3,
      bytes: 1024,
    })),
  ),
);
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
for (let run = 0; run < 2; run++) {
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => errors.push(error.message));
    await expect(page.locator(".recent-project")).toHaveCount(run ? 1 : 2);
    const valid = page
      .locator(".recent-project")
      .filter({ hasText: "存在的项目" });
    if (!run) {
      const invalid = page.locator(".recent-project.missing");
      await invalid.click({ force: true });
      await expect(page.locator(".home-page")).toBeVisible();
      const bounds = await invalid.boundingBox();
      assert(bounds);
      const rightClick = () =>
        page.mouse.click(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2,
          { button: "right" },
        );
      await rightClick();
      const menu = page.getByRole("menu", { name: "最近项目操作" });
      await expect(menu).toBeVisible();
      await page.screenshot({ path: path.join(root, "context-menu.png") });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await rightClick();
      await page.getByRole("menuitem", { name: "从最近项目中移除" }).click();
      await expect(page.locator(".recent-project.missing")).toHaveCount(0);
      await expect(valid).toBeVisible();
      await expect
        .poll(async () =>
          JSON.parse(await fs.readFile(history, "utf8")).map(
            (entry) => entry.file,
          ),
        )
        .toEqual([existing]);
    }
    await valid.click({ button: "right" });
    await expect(page.getByRole("menu", { name: "最近项目操作" })).toHaveCount(
      0,
    );
    assert.equal(await fs.readFile(existing, "utf8"), "keep this project file");
    await page.screenshot({ path: path.join(root, `after-${run}.png`) });
  } finally {
    await app.close();
  }
}
assert.deepEqual(errors, []);
console.log(`失效项目右键移除、列表持久化和原文件保留验证通过：${root}`);
