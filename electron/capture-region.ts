import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { captureRegionSchema, validateCaptureRegion, type CaptureRegion } from "../shared/capture-region";

export function displayPixelBounds(display: Electron.Display) {
  if (process.platform === "win32") return screen.dipToScreenRect(null, display.bounds);
  return { ...display.bounds,
    width: Math.round(display.bounds.width * display.scaleFactor),
    height: Math.round(display.bounds.height * display.scaleFactor),
  };
}

/** The desktop stays live underneath. Only the temporary selection window takes input. */
export class CaptureRegionPicker {
  private window?: BrowserWindow;
  private finish?: (region: CaptureRegion | null) => void;

  constructor() {
    ipcMain.on("capture:region:confirm", (event, input: unknown) => {
      if (event.sender !== this.window?.webContents || event.senderFrame !== this.window.webContents.mainFrame) return;
      const parsed = captureRegionSchema.safeParse(input);
      if (parsed.success) this.finish?.(parsed.data);
    });
    ipcMain.on("capture:region:cancel", (event) => {
      if (event.sender === this.window?.webContents) this.cancel();
    });
  }

  cancel() { this.finish?.(null); }

  async select(display: Electron.Display, initial?: CaptureRegion): Promise<CaptureRegion | null> {
    if (this.finish) throw new Error("正在选择录制范围");
    const physical = displayPixelBounds(display);
    const defaultWidth = Math.min(1280, physical.width);
    const defaultHeight = Math.min(720, physical.height);
    let region = { x: Math.floor((physical.width - defaultWidth) / 2), y: Math.floor((physical.height - defaultHeight) / 2), width: defaultWidth, height: defaultHeight };
    if (initial) {
      try { region = validateCaptureRegion(initial, physical.width, physical.height); } catch { /* Display configuration changed. */ }
    }
    const overlay = new BrowserWindow({
      ...display.bounds, show: false, frame: false, transparent: true,
      resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      webPreferences: { preload: path.join(__dirname, "capture-region-preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    this.window = overlay;
    overlay.setContentProtection(true);
    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    return new Promise((resolve, reject) => {
      this.finish = (value) => {
        if (this.window !== overlay) return;
        let result: CaptureRegion | null = null;
        if (value) {
          try { result = validateCaptureRegion(value, physical.width, physical.height); } catch { return; }
        }
        this.finish = undefined;
        this.window = undefined;
        if (!overlay.isDestroyed()) overlay.destroy();
        resolve(result);
      };
      overlay.once("closed", () => this.cancel());
      overlay.webContents.once("render-process-gone", () => this.cancel());
      overlay.webContents.once("did-finish-load", () => { if (!overlay.isDestroyed()) overlay.show(); });
      void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(regionHtml(region, physical.width, physical.height))}`).catch((error) => {
        if (this.window !== overlay) return;
        this.finish = undefined;
        this.window = undefined;
        if (!overlay.isDestroyed()) overlay.destroy();
        reject(error);
      });
    });
  }
}

function regionHtml(initial: CaptureRegion, width: number, height: number) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>TronCut 自定义录制范围</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;font:13px system-ui;color:#e5f5eb;user-select:none}
body{cursor:crosshair}#selection{position:absolute;border:2px solid #76e5b5;box-shadow:0 0 0 10000px #0006;cursor:move}
.handle{position:absolute;width:12px;height:12px;background:#76e5b5;border:2px solid #15251c;border-radius:2px}
[data-edge=nw]{left:-7px;top:-7px;cursor:nwse-resize}[data-edge=ne]{right:-7px;top:-7px;cursor:nesw-resize}
[data-edge=sw]{left:-7px;bottom:-7px;cursor:nesw-resize}[data-edge=se]{right:-7px;bottom:-7px;cursor:nwse-resize}
[data-edge=n]{left:calc(50% - 6px);top:-7px;cursor:ns-resize}[data-edge=s]{left:calc(50% - 6px);bottom:-7px;cursor:ns-resize}
[data-edge=w]{left:-7px;top:calc(50% - 6px);cursor:ew-resize}[data-edge=e]{right:-7px;top:calc(50% - 6px);cursor:ew-resize}
#tools{position:fixed;top:16px;left:50%;transform:translateX(-50%);display:flex;gap:10px;align-items:center;background:#19251df5;border:1px solid #54775f;border-radius:10px;padding:10px 14px;cursor:default;z-index:2;max-width:calc(100% - 24px);flex-wrap:wrap}
label{display:flex;gap:5px;align-items:center}input{width:70px;background:#0f1c14;border:1px solid #4f6959;border-radius:4px;color:white;padding:5px}button{border:1px solid #4f6959;border-radius:5px;background:#283c30;color:#e5f5eb;padding:6px 12px;cursor:pointer}#confirm{background:#76e5b5;color:#11271b;font-weight:600}p{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#19251df5;padding:8px 14px;border-radius:6px;pointer-events:none}
</style><div id="selection" aria-label="选中的录制范围">${["nw","n","ne","e","se","s","sw","w"].map((edge) => `<i class="handle" data-edge="${edge}"></i>`).join("")}</div>
<div id="tools"><b>录制范围</b>${[["x","X"],["y","Y"],["width","宽"],["height","高"]].map(([key,label]) => `<label>${label}<input type="number" id="${key}" aria-label="范围${label}" min="${key === "x" || key === "y" ? 0 : 16}" step="1"></label>`).join("")}<span>像素</span><button id="cancel">取消</button><button id="confirm">使用此范围</button></div>
<p>拖动框内移动，拖动边角调整；框外拖动重新框选 · Enter 确认 · Esc 取消</p>
<script>
const pixels = { width: ${width}, height: ${height} };
const box = document.querySelector('#selection');
const fields = ['x', 'y', 'width', 'height'];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
let region = ${JSON.stringify(initial)};
let drag;

function render() {
  box.style.left = region.x / pixels.width * innerWidth + 'px';
  box.style.top = region.y / pixels.height * innerHeight + 'px';
  box.style.width = region.width / pixels.width * innerWidth + 'px';
  box.style.height = region.height / pixels.height * innerHeight + 'px';
  for (const key of fields) document.getElementById(key).value = region[key];
}
function point(event) {
  return {
    x: clamp(Math.round(event.clientX / innerWidth * pixels.width), 0, pixels.width),
    y: clamp(Math.round(event.clientY / innerHeight * pixels.height), 0, pixels.height),
  };
}
document.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('#tools')) return;
  drag = {
    start: point(event), region: { ...region },
    edge: event.target.dataset.edge || (event.target.closest('#selection') ? 'move' : 'draw'),
  };
  document.body.setPointerCapture(event.pointerId);
  event.preventDefault();
});
document.addEventListener('pointermove', event => {
  if (!drag) return;
  const p = point(event), r = drag.region;
  const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  if (drag.edge === 'move') {
    region = { ...r, x: clamp(r.x + dx, 0, pixels.width - r.width), y: clamp(r.y + dy, 0, pixels.height - r.height) };
  } else {
    let left = r.x, top = r.y, right = r.x + r.width, bottom = r.y + r.height;
    if (drag.edge === 'draw') {
      left = Math.min(p.x, drag.start.x); top = Math.min(p.y, drag.start.y);
      right = Math.max(p.x, drag.start.x); bottom = Math.max(p.y, drag.start.y);
    } else {
      if (drag.edge.includes('w')) left = clamp(r.x + dx, 0, right - 16);
      if (drag.edge.includes('e')) right = clamp(right + dx, left + 16, pixels.width);
      if (drag.edge.includes('n')) top = clamp(r.y + dy, 0, bottom - 16);
      if (drag.edge.includes('s')) bottom = clamp(bottom + dy, top + 16, pixels.height);
    }
    left = clamp(left, 0, pixels.width - 16); top = clamp(top, 0, pixels.height - 16);
    region = { x: left, y: top, width: clamp(right - left, 16, pixels.width - left), height: clamp(bottom - top, 16, pixels.height - top) };
  }
  render();
});
document.addEventListener('pointerup', () => drag = undefined);
document.addEventListener('pointercancel', () => drag = undefined);
for (const key of fields) document.getElementById(key).addEventListener('change', event => {
  const value = Number(event.target.value);
  if (Number.isFinite(value)) {
    region[key] = Math.round(value);
    region.width = clamp(region.width, 16, pixels.width);
    region.height = clamp(region.height, 16, pixels.height);
    region.x = clamp(region.x, 0, pixels.width - region.width);
    region.y = clamp(region.y, 0, pixels.height - region.height);
  }
  render();
});
function confirm() { window.captureRegion.confirm(region); }
document.querySelector('#confirm').onclick = confirm;
document.querySelector('#cancel').onclick = () => window.captureRegion.cancel();
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') window.captureRegion.cancel();
  if (event.key === 'Enter') { document.activeElement.blur(); confirm(); }
});
render();
</script></html>`;
}
