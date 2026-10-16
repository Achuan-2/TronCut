import {
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
} from "electron";
import path from "node:path";
import { createCountdownController } from "./countdown-controller";
import { findCaptureSource } from "./capture-source";

const overlayHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
html,body { margin:0; width:100%; height:100%; background:transparent; overflow:hidden; }
body { display:grid; place-items:center; font-family:system-ui,sans-serif; color:white; }
main { display:flex; align-items:center; justify-content:center; gap:16px; width:236px; height:56px;
background:#19211df2; border:1px solid #76e5b555; border-radius:12px; }
strong { font-size:36px; font-weight:500; line-height:1; font-variant-numeric:tabular-nums; color:#76e5b5; }
span { font-size:13px; color:#d7e8de; } small { display:block; margin-top:3px; color:#9cb5a6; font-size:11px; }
</style><main aria-label="录制倒计时"><strong aria-live="assertive">3</strong><span>即将开始录制<small>可继续操作 · Esc 取消</small></span></main>
<script>
window.countdown.onTick(seconds => { document.querySelector('strong').textContent = seconds; });
</script></html>`;

/** Nonactivating, click-through indicator; never blocks interaction with the desktop. */
export class RecordingCountdown {
  private overlay?: BrowserWindow;
  private busy = false;
  private generation = 0;
  private controller = createCountdownController(
    () => this.createOverlay(),
    () => {},
  );
  private bounds?: Electron.Rectangle;
  private sourceDisplays = new Map<string, string>();

  /** Reuse picker metadata only for placement; capture still validates live sources. */
  setSources(sources: Pick<Electron.DesktopCapturerSource, "id" | "display_id">[]) {
    this.sourceDisplays = new Map(
      sources.map((source) => [source.id, source.display_id]),
    );
  }

  constructor() {
    ipcMain.on("recording:countdown:cancel", (event) => {
      if (event.sender === this.overlay?.webContents) this.cancel();
    });
  }
  private createOverlay() {
    const overlay = new BrowserWindow({
      ...this.bounds,
      show: false,
      frame: false,
      transparent: true,
      focusable: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, "countdown-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.overlay = overlay;
    overlay.setIgnoreMouseEvents(true);
    overlay.setContentProtection(true);
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.webContents.once("did-finish-load", () => overlay.showInactive());
    overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    void overlay
      .loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml)}`,
      )
      .catch(() => this.cancel());
    return overlay;
  }
  async start(sourceId: string) {
    if (this.busy) throw new Error("录制倒计时正在进行");
    this.busy = true;
    const generation = this.generation;
    let escapeRegistered = false;
    try {
      const displayId = this.sourceDisplays.get(sourceId);
      const source =
        displayId !== undefined
          ? { display_id: displayId }
          : await findCaptureSource(sourceId);
      if (generation !== this.generation) return false;
      if (!source) throw new Error("录制来源已经关闭，请重新选择");
      const display = (
        screen
          .getAllDisplays()
          .find((d) => String(d.id) === source.display_id) ??
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      );
      const area = display.workArea;
      this.bounds = { x: Math.round(area.x + (area.width - 248) / 2), y: area.y + 24, width: 248, height: 64 };
      escapeRegistered = globalShortcut.register("Escape", () => this.cancel());
      const result = await this.controller.start(3);
      if (result.error) throw new Error(result.error);
      // Let the compositor remove the overlay before the first captured frame.
      if (result.success)
        await new Promise((resolve) => setTimeout(resolve, 100));
      return result.success;
    } finally {
      if (escapeRegistered) globalShortcut.unregister("Escape");
      this.overlay = undefined;
      this.busy = false;
    }
  }
  cancel() {
    this.generation++;
    this.controller.cancel();
  }
}
