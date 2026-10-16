import { expect } from "@playwright/test";

/** Find the independent controller without confusing it with the countdown. */
export async function recordingControls(app) {
  const title = encodeURIComponent("<title>TronCut 录制控制</title>");
  const find = () => app.windows().find((page) => page.url().includes(title));
  await expect.poll(() => !!find(), { timeout: 30000 }).toBe(true);
  const controls = find();
  await expect(controls.getByRole("status")).toHaveText("正在录制");
  return controls;
}
