import { contextBridge, ipcRenderer } from "electron";
import type {
  RecordingControlCommand,
  RecordingControlsViewState,
} from "../shared/recording-controls";

contextBridge.exposeInMainWorld("recordingControls", {
  command: (command: RecordingControlCommand) =>
    ipcRenderer.send("recording:controls:command", command),
  onState: (callback: (state: RecordingControlsViewState) => void) =>
    ipcRenderer.on("recording:controls:state", (_event, state) =>
      callback(state),
    ),
  onCameraFrame: (callback: (frame: Uint8Array) => void) =>
    ipcRenderer.on("recording:camera:frame", (_event, frame) => callback(frame)),
});
