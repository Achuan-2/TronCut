import { BrowserWindow, screen } from "electron";
import path from "node:path";
import { cameraClipPath } from "../shared/camera-style";
import type { CameraStyle } from "../shared/recording-settings";

const previewHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>TronCut 摄像头预览</title><style>
html,body { margin:0; width:100%; height:100%; overflow:hidden; background:transparent; }
body { display:grid; place-items:center; -webkit-app-region:drag; user-select:none; }
img { display:block; max-width:100%; max-height:100%; pointer-events:none; }
</style><img id="camera" alt="摄像头实时预览" title="拖动移动摄像头预览"><script>
const camera = document.querySelector('#camera');
const cameraClipPath = ${cameraClipPath.toString()};
let cameraStyle, cameraUrl;
const updateMask = () => {
  if (cameraStyle && camera.naturalWidth) {
    camera.style.clipPath = cameraClipPath(cameraStyle, camera.naturalWidth, camera.naturalHeight);
    camera.style.transform = cameraStyle.mirror ? 'scaleX(-1)' : '';
  }
};
camera.onload = updateMask;
window.recordingControls.onState(state => { cameraStyle = state.cameraStyle; updateMask(); });
window.recordingControls.onCameraFrame(frame => {
  const previous = cameraUrl;
  cameraUrl = URL.createObjectURL(new Blob([frame], { type: 'image/jpeg' }));
  camera.src = cameraUrl;
  if (previous) URL.revokeObjectURL(previous);
});
</script></html>`;

/** A draggable, capture-excluded preview. Hiding it never releases the camera. */
export class RecordingCameraPreview {
  private window?: BrowserWindow;
  private loaded = false;
  private visible = false;
  private style?: CameraStyle;

  constructor(private onHide: () => void) {}

  private bounds(workArea: Electron.Rectangle) {
    const width = Math.min(320, workArea.width);
    const height = Math.min(180, workArea.height);
    return {
      x: workArea.x + Math.max(0, workArea.width - width - 24),
      y: workArea.y + Math.max(0, workArea.height - height - 24),
      width,
      height,
    };
  }

  update(
    style: CameraStyle | undefined,
    visible: boolean,
    workArea: Electron.Rectangle,
  ) {
    this.style = style;
    this.visible = !!style && visible;
    if (!style) {
      this.close();
      return;
    }
    if (!this.window && this.visible) this.create(workArea);
    const preview = this.window;
    if (!preview || preview.isDestroyed()) return;
    if (this.loaded) {
      preview.webContents.send("recording:controls:state", {
        cameraStyle: style,
      });
      if (this.visible && !preview.isVisible()) {
        // Keep the dragged position, including across hide/show and state updates.
        const bounds = preview.getBounds();
        const area = screen.getDisplayMatching(bounds).workArea;
        const x = Math.round(
          Math.max(
            area.x,
            Math.min(bounds.x, area.x + area.width - bounds.width),
          ),
        );
        const y = Math.round(
          Math.max(
            area.y,
            Math.min(bounds.y, area.y + area.height - bounds.height),
          ),
        );
        if (x !== bounds.x || y !== bounds.y) preview.setPosition(x, y);
        preview.showInactive();
      }
    }
    if (!this.visible) preview.hide();
  }

  private create(workArea: Electron.Rectangle) {
    this.loaded = false;
    const preview = new BrowserWindow({
      ...this.bounds(workArea),
      title: "TronCut 摄像头预览",
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, "recording-controls-preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.window = preview;
    preview.setContentProtection(true);
    preview.setAlwaysOnTop(true, "screen-saver");
    preview.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    preview.setMenu(null);
    preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    preview.webContents.on("will-navigate", (event) => event.preventDefault());
    preview.webContents.once("did-finish-load", () => {
      if (this.window !== preview) return;
      this.loaded = true;
      preview.webContents.send("recording:controls:state", {
        cameraStyle: this.style,
      });
      if (this.visible) preview.showInactive();
    });
    preview.on("close", (event) => {
      event.preventDefault();
      this.onHide();
    });
    preview.webContents.once("render-process-gone", () => {
      if (this.window !== preview) return;
      this.close();
      this.onHide();
    });
    void preview
      .loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(previewHtml)}`,
      )
      .catch(() => {
        if (this.window !== preview) return;
        this.close();
        this.onHide();
      });
  }

  frame(frame: Uint8Array) {
    if (
      this.loaded &&
      this.visible &&
      this.window &&
      !this.window.isDestroyed()
    )
      this.window.webContents.send("recording:camera:frame", frame);
  }

  close() {
    const preview = this.window;
    this.window = undefined;
    this.loaded = false;
    this.visible = false;
    if (preview && !preview.isDestroyed()) preview.destroy();
  }
}
