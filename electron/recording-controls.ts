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
html,body { margin:0; height:100%; overflow:hidden; background:#18231c; color:#edf5ef; font:13px system-ui,sans-serif; }
main { height:100%; border:1px solid #4d6656; border-radius:9px; padding:12px 16px; -webkit-app-region:drag; }
header,section { display:flex; align-items:center; gap:10px; }
header { color:#a7bcad; font-size:11px; margin-bottom:10px; }
header span { flex:1; }
button { -webkit-app-region:no-drag; cursor:pointer; border:1px solid #526b5b; border-radius:6px; background:#293b30; color:inherit; padding:8px 12px; font:inherit; }
button:hover { background:#37503f; }
button:focus-visible { outline:2px solid #a5dab5; outline-offset:2px; }
button:disabled { opacity:.5; cursor:default; }
#editor { border:0; padding:0; background:transparent; color:#bfd2c4; font-size:11px; }
#dot { width:8px; height:8px; border-radius:50%; background:#f28c7d; flex-shrink:0; }
body[data-phase=paused] #dot { background:#e4c171; }
#status { min-width:58px; font-weight:500; }
time { margin-right:auto; font-size:20px; font-variant-numeric:tabular-nums; }
#stop { background:#5d3930; border-color:#87564a; color:#ffdbd2; }
#stop:hover { background:#74463b; }
#error { color:#ffb5a5; font-size:11px; margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
</style><main aria-label="录制控制">
<header><span>TronCut · 录制控制 · 拖动移动</span><button id="editor">显示编辑器</button></header>
<section><i id="dot"></i><b id="status" role="status">正在录制</b><time aria-label="录制时长">00:00</time>
<button id="pause" aria-label="暂停录制">Ⅱ 暂停</button><button id="stop" aria-label="停止录制" title="停止并保存 · Ctrl/⌘ + Shift + F9">■ 停止</button></section>
<div id="error" role="alert" hidden></div>
</main><script>
const pause = document.querySelector('#pause'), stop = document.querySelector('#stop');
window.recordingControls.onState(state => {
  document.body.dataset.phase = state.phase;
  document.querySelector('#status').textContent = state.phase === 'paused' ? '已暂停' : state.phase === 'saving' ? '正在保存…' : '正在录制';
  const seconds = Math.floor(state.elapsed), pad = n => String(n).padStart(2, '0');
  document.querySelector('time').textContent = (seconds >= 3600 ? pad(Math.floor(seconds / 3600)) + ':' : '') + pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60);
  pause.textContent = state.phase === 'paused' ? '▶ 继续' : 'Ⅱ 暂停';
  pause.setAttribute('aria-label', state.phase === 'paused' ? '继续录制' : '暂停录制');
  pause.disabled = stop.disabled = state.phase === 'saving';
  const error = document.querySelector('#error');
  error.hidden = !state.error;
  error.textContent = error.title = state.error;
});
pause.onclick = () => window.recordingControls.command('pause');
stop.onclick = () => window.recordingControls.command('stop');
document.querySelector('#editor').onclick = () => window.recordingControls.command('editor');
</script></html>`;

/** An independent, capture-excluded window; the editor continues owning the streams. */
export class RecordingControls {
  private window?: BrowserWindow;
  private state?: RecordingControlsState;

  constructor(private command: (command: RecordingControlCommand) => void) {
    ipcMain.on("recording:controls:command", (event, command: unknown) => {
      if (
        !this.window ||
        event.sender !== this.window.webContents ||
        event.senderFrame !== this.window.webContents.mainFrame
      )
        return;
      if (
        command === "editor" ||
        (this.state?.phase !== "saving" &&
          (command === "pause" || command === "stop"))
      )
        this.command(command);
    });
  }

  update(state: RecordingControlsState | null) {
    if (!state) {
      this.close();
      return;
    }
    this.state = state;
    if (this.window && !this.window.isDestroyed()) {
      if (!this.window.webContents.isLoadingMainFrame())
        this.window.webContents.send("recording:controls:state", state);
      return;
    }
    const { workArea } = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    const width = 448,
      height = 120;
    const controls = new BrowserWindow({
      x: workArea.x + Math.max(0, workArea.width - width - 24),
      y: workArea.y + Math.max(0, workArea.height - height - 24),
      width,
      height,
      title: "TronCut 录制控制",
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
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
    controls.setAlwaysOnTop(true, "floating");
    controls.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    controls.setMenu(null);
    controls.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    controls.webContents.on("will-navigate", (event) => event.preventDefault());
    controls.webContents.once("did-finish-load", () => {
      if (this.window !== controls || !this.state) return;
      controls.webContents.send("recording:controls:state", this.state);
      controls.showInactive();
    });
    // Alt+F4 must save the recording, rather than leave it without controls.
    controls.on("close", (event) => {
      event.preventDefault();
      if (this.state?.phase !== "saving") this.command("stop");
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
    if (controls && !controls.isDestroyed()) controls.destroy();
  }
}
