import { expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

/** Find the independent controller without confusing it with the countdown. */
export async function recordingControls(app) {
  const title = encodeURIComponent("<title>TronCut 录制控制</title>");
  const find = () => app.windows().find((page) => page.url().includes(title));
  await expect.poll(() => !!find(), { timeout: 30000 }).toBe(true);
  const controls = find();
  // DOM visibility alone also succeeds for an OS window that was never shown.
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(
          (w) => w.getTitle() === "TronCut 录制控制",
        );
        return !!window && window.isVisible() && !window.isMinimized();
      }),
    )
    .toBe(true);
  await expect(controls.getByRole("status")).toHaveText("正在录制");
  if (process.platform === "win32") {
    const handle = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "TronCut 录制控制")
        .getNativeWindowHandle()
        .readBigUInt64LE()
        .toString(),
    );
    const { stdout } = await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-File",
        path.resolve("scripts/inspect-recording-border.ps1"),
        "-OverlayHandle",
        handle,
      ],
      { windowsHide: true },
    );
    const native = JSON.parse(stdout.trim());
    expect(native.visible).toBe(true);
    expect(native.topAtCenter, JSON.stringify(native)).toBe(true);
  }
  return controls;
}
