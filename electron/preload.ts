import { contextBridge, ipcRenderer } from "electron";
import type { FrameCraftBridge } from "../shared/bridge";

const bridge: FrameCraftBridge = {
  platform: process.platform,
  importMedia: () => ipcRenderer.invoke("media:import"),
  relinkMedia: (id, duration) =>
    ipcRenderer.invoke("media:relink", id, duration),
  mediaThumbnail: (id, waveform) =>
    ipcRenderer.invoke("media:thumbnail", id, waveform),
  mediaUrl: (id) => ipcRenderer.invoke("media:url", id),
  openProject: () => ipcRenderer.invoke("project:open"),
  initialProject: () => ipcRenderer.invoke("project:initial"),
  newProject: () => ipcRenderer.invoke("project:new"),
  markDirty: (dirty) => ipcRenderer.invoke("project:dirty", dirty),
  writeRecovery: (project) =>
    ipcRenderer.invoke("project:recovery:write", project),
  readRecovery: () => ipcRenderer.invoke("project:recovery:read"),
  saveProject: (project, saveAs) =>
    ipcRenderer.invoke("project:save", project, saveAs),
  importCamtasia: () => ipcRenderer.invoke("project:camtasia"),
  importSubtitles: () => ipcRenderer.invoke("subtitles:import"),
  exportSubtitles: (cues) => ipcRenderer.invoke("subtitles:export", cues),
  exportVideo: (project) => ipcRenderer.invoke("video:export", project),
  previewAudio: (project, clipId) =>
    ipcRenderer.invoke("audio:preview", project, clipId),
  cancelTask: () => ipcRenderer.invoke("task:cancel"),
  onProgress: (callback) => {
    const fn = (_: unknown, event: Parameters<typeof callback>[0]) =>
      callback(event);
    ipcRenderer.on("task:progress", fn);
    return () => ipcRenderer.removeListener("task:progress", fn);
  },
  onShortcut: (callback) => {
    const fn = (_: unknown, command: string) => callback(command);
    ipcRenderer.on("shortcut", fn);
    return () => ipcRenderer.removeListener("shortcut", fn);
  },
  capabilities: () => ipcRenderer.invoke("app:capabilities"),
  selectBinary: (name) => ipcRenderer.invoke("app:selectBinary", name),
  transcribe: (id, engine, language, options) =>
    ipcRenderer.invoke("subtitles:transcribe", id, engine, language, options),
  captureSources: () => ipcRenderer.invoke("capture:sources"),
  selectCapture: (id, audio) => ipcRenderer.invoke("capture:select", id, audio),
  nativeCaptureAvailable: () => ipcRenderer.invoke("capture:native:available"),
  nativeRecordingStart: (id, fps, audio) =>
    ipcRenderer.invoke("capture:native:start", id, fps, audio),
  nativeRecordingPause: (paused) =>
    ipcRenderer.invoke("capture:native:pause", paused),
  nativeRecordingStop: () => ipcRenderer.invoke("capture:native:stop"),
  recordingStart: (kind) => ipcRenderer.invoke("recording:start", kind),
  recordingChunk: (id, chunk) =>
    ipcRenderer.invoke("recording:chunk", id, chunk),
  recordingStop: (id, duration) =>
    ipcRenderer.invoke("recording:stop", id, duration),
  recordingAbort: (id) => ipcRenderer.invoke("recording:abort", id),
};
contextBridge.exposeInMainWorld("framecraft", bridge);
