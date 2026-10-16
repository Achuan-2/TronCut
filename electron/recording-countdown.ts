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
body { display:grid; place-items:center; font-family:system-ui,sans-serif; color:white; background:#0003; }
main { display:grid; place-items:center; gap:12px; width:176px; height:176px;
background:#191b20ee; border:1px solid #ffffff30; border-radius:28px; box-shadow:0 8px 40px #0004; }
strong { font-size:76px; font-weight:500; line-height:1; font-variant-numeric:tabular-nums; }
button { background:transparent; color:#ddd; border:0; font-size:14px; cursor:pointer; padding:8px 16px; }
</style><main aria-label="录制倒计时"><strong aria-live="assertive">3</strong><button>取消 · Esc</button></main>
<script>
window.countdown.onTick(seconds => { document.querySelector('strong').textContent = seconds; });
document.querySelector('button').onclick = () => window.countdown.cancel();
document.addEventListener('keydown', event => { if(event.key === 'Escape') window.countdown.cancel(); });
</script></html>`;

/** Own a separate full-display window; its lifetime settles before capture starts. */
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
      fullscreen: true,
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
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.webContents.once("did-finish-load", () => overlay.show());
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
      this.bounds = (
        screen
          .getAllDisplays()
          .find((d) => String(d.id) === source.display_id) ??
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      ).bounds;
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
