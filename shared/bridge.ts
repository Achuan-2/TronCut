import type { Asset, Project } from "./model";
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
import type { CustomRecordingBackground } from "./recording-settings";
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
  recordingCountdown(sourceId: string): Promise<boolean>;
  cancelRecordingCountdown(): Promise<void>;
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
  importDroppedMedia(files: File[]): Promise<Asset[]>;
  copyClipClipboard(token: string): Promise<void>;
  importClipboardMedia(): Promise<{
    assets: Asset[];
    clipToken: string | null;
  }>;
  relinkMedia(assetId: string, requiredDuration: number): Promise<Asset | null>;
  mediaThumbnail(assetId: string, waveform: boolean): Promise<string | null>;
  mediaUrl(assetId: string): Promise<string>;
  openProject(): Promise<{ project: Project; file: string } | null>;
  recentProjects(): Promise<RecentProject[]>;
  openRecentProject(file: string): Promise<{ project: Project; file: string }>;
  recoveryInfo(): Promise<RecoveryInfo | null>;
  initialProject(): Promise<{ project: Project; file: string } | null>;
  newProject(): Promise<void>;
  markDirty(dirty: boolean): Promise<void>;
  writeRecovery(project: Project): Promise<void>;
  readRecovery(): Promise<{ project: Project; file: string | null } | null>;
  saveProject(
    project: Project,
    saveAs?: boolean,
  ): Promise<{ project: Project; file: string } | null>;
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
  selectCapture(id: string, systemAudio: boolean): Promise<void>;
  nativeCaptureAvailable(): Promise<boolean>;
  restoreRecordingWindow(): Promise<void>;
  nativeRecordingStart(
    sourceId: string,
    fps: number,
    systemAudio: boolean,
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
