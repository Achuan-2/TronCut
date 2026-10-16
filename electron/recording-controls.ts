import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import type {
  RecordingControlCommand,
  RecordingControlsState,
} from "../shared/recording-controls";

const controlsHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>TronCut 录制控制</title><style>
* { box-sizing:border-box; }
html,body { margin:0; height:100%; overflow:hidden; background:#18231c; color:#edf5ef; font:12px system-ui,sans-serif; }
main { display:flex; align-items:center; gap:6px; height:100%; padding:5px 7px; border:1px solid #4d6656; border-radius:7px; -webkit-app-region:drag; }
.grip { width:6px; height:14px; color:#779483; flex-shrink:0; }
button { display:grid; place-items:center; flex-shrink:0; width:26px; height:26px; padding:0; -webkit-app-region:no-drag; cursor:pointer; border:0; border-radius:4px; background:transparent; color:inherit; }
button:hover { background:#304738; }
button:focus-visible { outline:1px solid #a5dab5; outline-offset:-1px; }
button:disabled { opacity:.45; cursor:default; }
svg { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
[hidden] { display:none !important; }
.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
#dot { width:6px; height:6px; border-radius:50%; background:#f28c7d; flex-shrink:0; }
body[data-phase=paused] #dot { background:#e4c171; }
body[data-phase=starting] #dot,body[data-phase=saving] #dot { background:#9cb5a5; }
time { margin-right:auto; font-size:14px; font-variant-numeric:tabular-nums; white-space:nowrap; }
#stop { color:#f3a799; }
#stop:hover { background:#54362f; }
#error { color:#ffd18c; font-weight:700; cursor:help; -webkit-app-region:no-drag; }
.separator { height:14px; width:1px; background:#405647; flex-shrink:0; }
</style><main aria-label="录制控制" title="拖动移动">
<svg class="grip" viewBox="0 0 6 14" aria-hidden="true"><path d="M1 2v10M5 2v10"/></svg>
<i id="dot" title="正在录制"></i><span id="status" class="sr-only" role="status">正在录制</span>
<time aria-label="录制时长">00:00</time><span id="error" role="alert" hidden>!</span>
<button id="pause" aria-label="暂停录制" title="暂停录制"><svg id="pause-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3v10M11 3v10"/></svg><svg id="play-icon" viewBox="0 0 16 16" aria-hidden="true" hidden><path d="m5 3 8 5-8 5Z"/></svg></button>
<button id="stop" aria-label="停止录制" title="停止并保存 · Ctrl/⌘ + Shift + F9"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1" fill="currentColor" stroke="none"/></svg></button>
<span class="separator" aria-hidden="true"></span>
<button id="editor" aria-label="显示编辑器" title="显示编辑器"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="9" rx="1"/><path d="M6 14h4M8 11.5V14"/></svg></button>
<button id="minimize" aria-label="最小化" title="最小化到任务栏，继续录制"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 11h10"/></svg></button>
</main><script>
const pause = document.querySelector('#pause'), stop = document.querySelector('#stop');
window.recordingControls.onState(state => {
  document.body.dataset.phase = state.phase;
  const status = state.phase === 'starting' ? '正在启动录制…' : state.phase === 'paused' ? '已暂停' : state.phase === 'saving' ? '正在保存…' : '正在录制';
  document.querySelector('#status').textContent = status;
  document.querySelector('#dot').title = status;
  const seconds = Math.floor(state.elapsed), pad = n => String(n).padStart(2, '0');
  document.querySelector('time').textContent = state.phase === 'starting' ? '准备中…' : (seconds >= 3600 ? pad(Math.floor(seconds / 3600)) + ':' : '') + pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60);
  document.querySelector('#pause-icon').toggleAttribute('hidden', state.phase === 'paused');
  document.querySelector('#play-icon').toggleAttribute('hidden', state.phase !== 'paused');
  pause.title = state.phase === 'paused' ? '继续录制' : '暂停录制';
  pause.setAttribute('aria-label', pause.title);
  pause.disabled = stop.disabled = state.phase === 'starting' || state.phase === 'saving';
  const error = document.querySelector('#error');
  error.hidden = !state.error;
  error.title = state.error;
  error.setAttribute('aria-label', state.error);
});
pause.onclick = () => window.recordingControls.command('pause');
stop.onclick = () => window.recordingControls.command('stop');
document.querySelector('#editor').onclick = () => window.recordingControls.command('editor');
document.querySelector('#minimize').onclick = () => window.recordingControls.command('minimize');
</script></html>`;

/** An independent, capture-excluded window; the editor continues owning the streams. */
export class RecordingControls {
  private window?: BrowserWindow;
  private state?: RecordingControlsState;
  private loaded = false;
  private presentationRequested = false;
  private captureDisplayId?: number;
  private sourceDisplays = new Map<string, string>();

  setSources(
    sources: Pick<Electron.DesktopCapturerSource, "id" | "display_id">[],
  ) {
    this.sourceDisplays = new Map(
      sources.map((source) => [source.id, source.display_id]),
    );
  }

  prepare(sourceId: string, editorBounds: Electron.Rectangle) {
    const displayId = this.sourceDisplays.get(sourceId);
    this.captureDisplayId = (
      screen
        .getAllDisplays()
        .find((display) => String(display.id) === displayId) ??
      screen.getDisplayMatching(editorBounds)
    ).id;
  }

  private bounds() {
    const display =
      screen
        .getAllDisplays()
        .find((display) => display.id === this.captureDisplayId) ??
      screen.getPrimaryDisplay();
    const { workArea } = display;
    const width = Math.min(272, workArea.width),
      height = Math.min(42, workArea.height);
    return {
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: workArea.y + Math.max(0, workArea.height - height - 24),
      width,
      height,
    };
  }

  /** Explicit recovery from the editor/taskbar also brings off-screen controls back. */
  show() {
    const controls = this.window;
    if (!controls || controls.isDestroyed() || !this.state) return;
    this.presentationRequested = true;
    if (!this.loaded) return;
    controls.setBounds(this.bounds());
    if (controls.isMinimized()) controls.restore();
    controls.show();
    controls.moveTop();
    controls.focus();
  }

  constructor(private command: (command: RecordingControlCommand) => void) {
    ipcMain.on("recording:controls:command", (event, command: unknown) => {
      if (
        !this.window ||
        event.sender !== this.window.webContents ||
        event.senderFrame !== this.window.webContents.mainFrame
      )
        return;
      if (command === "minimize") {
        this.window.minimize();
        return;
      }
      if (
        command === "editor" ||
        ((this.state?.phase === "recording" ||
          this.state?.phase === "paused") &&
          (command === "pause" || command === "stop"))
      )
        this.command(command);
    });
  }

  /** Warm the renderer under the countdown without exposing it or stealing focus. */
  preload() {
    if (this.window && !this.window.isDestroyed()) return;
    this.update({ phase: "starting", elapsed: 0, error: "" }, false);
  }

  update(state: RecordingControlsState | null, reveal = true) {
    if (!state) {
      this.close();
      return;
    }
    this.state = state;
    if (this.window && !this.window.isDestroyed()) {
      if (!this.window.webContents.isLoadingMainFrame())
        this.window.webContents.send("recording:controls:state", state);
      if (reveal && !this.presentationRequested) this.show();
      return;
    }
    this.loaded = false;
    this.presentationRequested = reveal;
    const controls = new BrowserWindow({
      ...this.bounds(),
      title: "TronCut 录制控制",
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: true,
      alwaysOnTop: true,
      skipTaskbar: false,
      backgroundColor: "#18231c",
      webPreferences: {
        preload: path.join(__dirname, "recording-controls-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.window = controls;
    controls.setContentProtection(true);
    controls.setAlwaysOnTop(true, "screen-saver");
    controls.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    controls.setMenu(null);
    controls.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    controls.webContents.on("will-navigate", (event) => event.preventDefault());
    controls.webContents.once("did-finish-load", () => {
      if (this.window !== controls || !this.state) return;
      this.loaded = true;
      controls.webContents.send("recording:controls:state", this.state);
      // Minimizing the editor can leave the Windows task switcher in front.
      // Activate once so the user can actually see and reach the controller.
      if (this.presentationRequested) this.show();
    });
    // Alt+F4 must save the recording, rather than leave it without controls.
    controls.on("close", (event) => {
      event.preventDefault();
      if (this.state?.phase === "recording" || this.state?.phase === "paused")
        this.command("stop");
    });
    controls.webContents.once("render-process-gone", () =>
      this.command("stop"),
    );
    void controls
      .loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(controlsHtml)}`,
      )
      .catch(() => {
        if (this.window === controls) {
          this.close();
          this.command("stop");
        }
      });
  }

  close() {
    const controls = this.window;
    this.window = undefined;
    this.state = undefined;
    this.loaded = false;
    this.presentationRequested = false;
    if (controls && !controls.isDestroyed()) controls.destroy();
  }
}
