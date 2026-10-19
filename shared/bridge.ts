import type { Asset, Project } from "./model";
import type { AssetLibrary } from "./asset-libraries";
import type { Cue } from "./subtitles";
import type { SpeechEngine, SpeechOptions } from "./asr";
import type { TtsOptions, WindowsSpeechVoice } from "./tts";
import type { ClonedVoice, CreateClonedVoice } from "./cloned-voices";
import type { OnnxModel, PreparedOnnxModel } from "./onnx";
import type { RecentProject, RecoveryInfo } from "./recent-projects";
import type {
  Preferences,
  PreferencesUpdate,
  AiProviderUpdate,
} from "./preferences";
import type { RecordingBackground, RecordingSettings } from "./recording";
import type { RecordingControlsState } from "./recording-controls";
import type { CustomRecordingBackground } from "./recording-settings";
import type { CaptureRegion } from "./capture-region";
import type { VideoExportRequest } from "./export-settings";
import type { EditMenuState } from "./edit-menu";
import type { z } from "zod";
import type { textEditSchema } from "./edit-menu";
import type {
  CaptionProcessingOptions,
  CaptionProcessingResult,
} from "./caption-processing";
export interface CaptureSource {
  id: string;
  name: string;
  thumbnail: string;
}
export interface Capabilities {
  ffmpeg: boolean;
  rubberband: boolean;
  podcast: boolean;
  error: string;
}
export interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
}
export interface FrameCraftBridge {
  recordingCountdown(
    sourceId: string,
    native?: { fps: number; systemAudio: boolean; region?: CaptureRegion },
  ): Promise<boolean>;
  cancelRecordingCountdown(): Promise<void>;
  updateRecordingControls(state: RecordingControlsState | null): Promise<void>;
  updateCameraPreview(frame: Uint8Array): Promise<void>;
  showRecordingControls(): Promise<void>;
  recordingSettings(): Promise<RecordingSettings>;
  saveRecordingSettings(
    settings: RecordingSettings,
  ): Promise<RecordingSettings>;
  selectRecordingBackground(): Promise<CustomRecordingBackground | null>;
  createRecordingBackground(
    width: number,
    height: number,
    preset: RecordingBackground,
    customAssetId?: string,
  ): Promise<Asset>;
  preferences(): Promise<Preferences>;
  savePreferences(update: PreferencesUpdate): Promise<Preferences>;
  testAiConnection(update: PreferencesUpdate): Promise<void>;
  listAiModels(provider: AiProviderUpdate): Promise<string[]>;
  openPreferencesFolder(): Promise<void>;
  refineCaptions(
    cues: Cue[],
    options: CaptionProcessingOptions,
  ): Promise<CaptionProcessingResult>;
  platform: string;
  windowState(): Promise<WindowState>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  showWindowMenu(menu: "edit" | "view", x: number, y: number): Promise<void>;
  updateEditMenu(state: EditMenuState): Promise<void>;
  editText(command: z.infer<typeof textEditSchema>): Promise<void>;
  onWindowState(callback: (state: WindowState) => void): () => void;
  importMedia(): Promise<Asset[]>;
  assetLibraries(): Promise<AssetLibrary[]>;
  createAssetLibrary(name: string): Promise<string>;
  renameAssetLibrary(id: string, name: string): Promise<void>;
  deleteAssetLibrary(id: string): Promise<void>;
  addLibraryAssets(id: string, assetIds: string[]): Promise<void>;
  removeLibraryAsset(id: string, assetId: string): Promise<void>;
  renameLibraryAsset(id: string, assetId: string, name: string): Promise<void>;
  transferLibraryAsset(
    id: string,
    assetId: string,
    targetId: string,
    move: boolean,
  ): Promise<void>;
  createLibraryFolder(
    id: string,
    name: string,
    parentId?: string,
  ): Promise<string>;
  renameLibraryFolder(
    id: string,
    folderId: string,
    name: string,
  ): Promise<void>;
  removeLibraryFolder(id: string, folderId: string): Promise<void>;
  setLibraryAssetFolder(
    id: string,
    assetId: string,
    folderId: string | null,
  ): Promise<void>;
  exportLibraryAsset(id: string, assetId: string): Promise<boolean>;
  useLibraryAsset(id: string, assetId: string): Promise<Asset>;
  exportAssetLibrary(id: string): Promise<boolean>;
  importAssetLibrary(): Promise<string | null>;
  importDroppedMedia(files: File[]): Promise<Asset[]>;
  copyClipClipboard(token: string): Promise<void>;
  importClipboardMedia(): Promise<{
    assets: Asset[];
    clipToken: string | null;
  }>;
  relinkMedia(assetId: string, requiredDuration: number): Promise<Asset | null>;
  updateMedia(assetId: string, requiredDuration: number): Promise<Asset | null>;
  mediaThumbnail(assetId: string, waveform: boolean): Promise<string | null>;
  mediaUrl(assetId: string): Promise<string>;
  previewProxyAvailable(assetId: string): Promise<boolean>;
  onPreviewProxyReady(callback: (assetId: string) => void): () => void;
  openProject(): Promise<{ project: Project; file: string } | null>;
  recentProjects(): Promise<RecentProject[]>;
  removeRecentProject(file: string): Promise<RecentProject[]>;
  openRecentProject(file: string): Promise<{ project: Project; file: string }>;
  saveRecentProjectAs(file: string): Promise<{ project: Project; file: string } | null>;
  showProjectLocation(file: string): Promise<void>;
  recoveryInfo(): Promise<RecoveryInfo | null>;
  initialProject(): Promise<{ project: Project; file: string } | null>;
  newProject(): Promise<{ project: Project; file: string }>;
  markDirty(dirty: boolean): Promise<void>;
  writeRecovery(project: Project): Promise<void>;
  readRecovery(): Promise<{ project: Project; file: string | null } | null>;
  saveProject(
    project: Project,
    saveAs?: boolean,
  ): Promise<{ project: Project; file: string } | null>;
  renameProject(
    project: Project,
    name: string,
  ): Promise<{ project: Project; file: string }>;
  importCamtasia(): Promise<Project | null>;
  importSubtitles(): Promise<Cue[] | null>;
  exportSubtitles(cues: Cue[]): Promise<string | null>;
  exportDirectory(): Promise<string>;
  selectExportDirectory(defaultPath: string): Promise<string | null>;
  exportVideo(
    project: Project,
    request: VideoExportRequest,
  ): Promise<string | null>;
  captureFrame(
    project: Project,
    time: number,
    endpointClipId?: string,
  ): Promise<Asset>;
  previewAudio(project: Project, clipId: string): Promise<string>;
  synthesize(options: TtsOptions): Promise<Asset>;
  previewSpeechVoice(options: TtsOptions): Promise<Asset>;
  releaseSpeechVoicePreview(id: string): Promise<void>;
  windowsSpeechVoices(): Promise<WindowsSpeechVoice[]>;
  downloadSpeechModel(engine: OnnxModel): Promise<PreparedOnnxModel>;
  selectNarrationReference(): Promise<Asset | null>;
  releaseNarrationReference(id: string): Promise<void>;
  transcribeNarrationReference(id: string): Promise<string>;
  clonedVoices(): Promise<ClonedVoice[]>;
  createClonedVoice(options: CreateClonedVoice): Promise<ClonedVoice>;
  deleteClonedVoice(id: string): Promise<void>;
  cancelTask(): Promise<void>;
  onProgress(
    callback: (event: { percent: number; label: string }) => void,
  ): () => void;
  onShortcut(callback: (command: string) => void): () => void;
  capabilities(): Promise<Capabilities>;
  selectBinary(name: "ffmpeg" | "ffprobe" | "videocaptioner"): Promise<void>;
  transcribe(
    project: Project,
    engine: SpeechEngine,
    language: string,
    options?: SpeechOptions,
  ): Promise<CaptionProcessingResult>;
  captureSources(): Promise<CaptureSource[]>;
  selectRecordingRegion(sourceId: string, initial?: CaptureRegion): Promise<{ sourceId: string; region: CaptureRegion } | null>;
  selectCapture(id: string, systemAudio: boolean, region?: CaptureRegion): Promise<void>;
  nativeCaptureAvailable(): Promise<boolean>;
  restoreRecordingWindow(): Promise<void>;
  nativeRecordingStart(
    sourceId: string,
    fps: number,
    systemAudio: boolean,
    region?: CaptureRegion,
  ): Promise<void>;
  nativeRecordingPause(paused: boolean): Promise<void>;
  nativeRecordingStop(): Promise<Asset>;
  recordingStart(
    kind: "screen" | "camera" | "microphone" | "voice-reference",
  ): Promise<string>;
  recordingChunk(id: string, chunk: Uint8Array): Promise<void>;
  recordingStop(id: string, duration: number): Promise<Asset>;
  recordingAbort(id: string): Promise<void>;
}
declare global {
  interface Window {
    framecraft?: FrameCraftBridge;
  }
}
