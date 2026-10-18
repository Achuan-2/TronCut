import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { FrameCraftBridge } from "../shared/bridge";

const bridge: FrameCraftBridge = {
  recordingCountdown: (sourceId, native) => ipcRenderer.invoke("recording:countdown", sourceId, native),
  cancelRecordingCountdown: () => ipcRenderer.invoke("recording:countdown:cancel"),
  updateRecordingControls: (state) => ipcRenderer.invoke("recording:controls:update", state),
  updateCameraPreview: (frame) => ipcRenderer.invoke("recording:camera:frame", frame),
  showRecordingControls: () => ipcRenderer.invoke("recording:controls:show"),
  recordingSettings: () => ipcRenderer.invoke("recording:settings"),
  saveRecordingSettings: (settings) =>
    ipcRenderer.invoke("recording:settings:save", settings),
  selectRecordingBackground: () => ipcRenderer.invoke("recording:background:select"),
  createRecordingBackground: (width, height, preset, customAssetId) =>
    ipcRenderer.invoke("recording:background", width, height, preset, customAssetId),
  preferences: () => ipcRenderer.invoke("preferences:get"),
  savePreferences: (update) => ipcRenderer.invoke("preferences:save", update),
  testAiConnection: (update) =>
    ipcRenderer.invoke("preferences:ai:test", update),
  listAiModels: (provider) => ipcRenderer.invoke("preferences:ai:models", provider),
  openPreferencesFolder: () => ipcRenderer.invoke("preferences:folder"),
  refineCaptions: (cues, options) =>
    ipcRenderer.invoke("subtitles:refine", cues, options),
  platform: process.platform,
  windowState: () => ipcRenderer.invoke("window:state"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  showWindowMenu: (menu, x, y) => ipcRenderer.invoke("window:menu", menu, x, y),
  updateEditMenu: (state) => ipcRenderer.invoke("window:edit-menu", state),
  editText: (command) => ipcRenderer.invoke("window:edit-text", command),
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
  previewProxyAvailable: (id) =>
    ipcRenderer.invoke("media:preview-proxy", id),
  onPreviewProxyReady: (callback) => {
    const fn = (_: unknown, assetId: string) => callback(assetId);
    ipcRenderer.on("media:preview-proxy-ready", fn);
    return () => ipcRenderer.removeListener("media:preview-proxy-ready", fn);
  },
  openProject: () => ipcRenderer.invoke("project:open"),
  recentProjects: () => ipcRenderer.invoke("project:recent"),
  removeRecentProject: (file) => ipcRenderer.invoke("project:recent:remove", file),
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
  renameProject: (project, name) =>
    ipcRenderer.invoke("project:rename", project, name),
  importCamtasia: () => ipcRenderer.invoke("project:camtasia"),
  importSubtitles: () => ipcRenderer.invoke("subtitles:import"),
  exportSubtitles: (cues) => ipcRenderer.invoke("subtitles:export", cues),
  exportDirectory: () => ipcRenderer.invoke("video:export:directory"),
  selectExportDirectory: (defaultPath) =>
    ipcRenderer.invoke("video:export:choose-directory", defaultPath),
  exportVideo: (project, request) =>
    ipcRenderer.invoke("video:export", project, request),
  captureFrame: (project, time, endpointClipId) =>
    ipcRenderer.invoke("video:frame", project, time, endpointClipId),
  previewAudio: (project, clipId) =>
    ipcRenderer.invoke("audio:preview", project, clipId),
  synthesize: (options) => ipcRenderer.invoke("audio:synthesize", options),
  previewSpeechVoice: (options) =>
    ipcRenderer.invoke("audio:voice-preview", options),
  releaseSpeechVoicePreview: (id) =>
    ipcRenderer.invoke("audio:voice-preview:release", id),
  windowsSpeechVoices: () => ipcRenderer.invoke("audio:windows-voices"),
  downloadSpeechModel: (engine) =>
    ipcRenderer.invoke("speech:downloadModel", engine),
  selectNarrationReference: () => ipcRenderer.invoke("audio:reference"),
  releaseNarrationReference: (id) =>
    ipcRenderer.invoke("audio:reference:release", id),
  transcribeNarrationReference: (id) =>
    ipcRenderer.invoke("audio:reference:transcribe", id),
  clonedVoices: () => ipcRenderer.invoke("audio:cloned-voices:list"),
  createClonedVoice: (options) =>
    ipcRenderer.invoke("audio:cloned-voices:create", options),
  deleteClonedVoice: (id) =>
    ipcRenderer.invoke("audio:cloned-voices:delete", id),
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
  transcribe: (project, engine, language, options) =>
    ipcRenderer.invoke(
      "subtitles:transcribe",
      project,
      engine,
      language,
      options,
    ),
  captureSources: () => ipcRenderer.invoke("capture:sources"),
  selectRecordingRegion: (id, initial) => ipcRenderer.invoke("capture:region", id, initial),
  selectCapture: (id, audio, region) => ipcRenderer.invoke("capture:select", id, audio, region),
  nativeCaptureAvailable: () => ipcRenderer.invoke("capture:native:available"),
  restoreRecordingWindow: () => ipcRenderer.invoke("recording:window:restore"),
  nativeRecordingStart: (id, fps, audio, region) =>
    ipcRenderer.invoke("capture:native:start", id, fps, audio, region),
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
