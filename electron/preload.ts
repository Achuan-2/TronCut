import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { FrameCraftBridge } from "../shared/bridge";

const bridge: FrameCraftBridge = {
  platform: process.platform,
  windowState: () => ipcRenderer.invoke("window:state"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  showWindowMenu: (menu, x, y) => ipcRenderer.invoke("window:menu", menu, x, y),
  onWindowState: (callback) => {
    const fn = (_: unknown, state: Parameters<typeof callback>[0]) =>
      callback(state);
    ipcRenderer.on("window:state", fn);
    return () => ipcRenderer.removeListener("window:state", fn);
  },
  importMedia: () => ipcRenderer.invoke("media:import"),
  importDroppedMedia: (files) =>
    ipcRenderer.invoke(
      "media:import-paths",
      files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
    ),
  copyClipClipboard: (token) => ipcRenderer.invoke("clipboard:clips", token),
  importClipboardMedia: () => ipcRenderer.invoke("media:clipboard"),
  relinkMedia: (id, duration) =>
    ipcRenderer.invoke("media:relink", id, duration),
  mediaThumbnail: (id, waveform) =>
    ipcRenderer.invoke("media:thumbnail", id, waveform),
  mediaUrl: (id) => ipcRenderer.invoke("media:url", id),
  openProject: () => ipcRenderer.invoke("project:open"),
  recentProjects: () => ipcRenderer.invoke("project:recent"),
  openRecentProject: (file) => ipcRenderer.invoke("project:recent:open", file),
  recoveryInfo: () => ipcRenderer.invoke("project:recovery:info"),
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
  captureFrame: (project, time, endpointClipId) =>
    ipcRenderer.invoke("video:frame", project, time, endpointClipId),
  previewAudio: (project, clipId) =>
    ipcRenderer.invoke("audio:preview", project, clipId),
  synthesize: (options) => ipcRenderer.invoke("audio:synthesize", options),
  downloadSpeechModel: (engine) =>
    ipcRenderer.invoke("speech:downloadModel", engine),
  selectNarrationReference: () => ipcRenderer.invoke("audio:reference"),
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
