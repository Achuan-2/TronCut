import { contextBridge, ipcRenderer } from "electron";
import type {
  RecordingControlCommand,
  RecordingControlsState,
} from "../shared/recording-controls";

contextBridge.exposeInMainWorld("recordingControls", {
  command: (command: RecordingControlCommand) =>
    ipcRenderer.send("recording:controls:command", command),
  onState: (callback: (state: RecordingControlsState) => void) =>
    ipcRenderer.on("recording:controls:state", (_event, state) =>
      callback(state),
    ),
});
