import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("countdown", {
  cancel: () => ipcRenderer.send("recording:countdown:cancel"),
  onTick: (callback: (seconds: number) => void) =>
    ipcRenderer.on("countdown-tick", (_event, seconds: number) =>
      callback(seconds),
    ),
});
