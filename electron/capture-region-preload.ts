import { contextBridge, ipcRenderer } from "electron";
import type { CaptureRegion } from "../shared/capture-region";

contextBridge.exposeInMainWorld("captureRegion", {
  confirm: (region: CaptureRegion) => ipcRenderer.send("capture:region:confirm", region),
  cancel: () => ipcRenderer.send("capture:region:cancel"),
});
