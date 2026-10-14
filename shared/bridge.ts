import type { Asset, Project } from "./model";
import type { Cue } from "./subtitles";
import type { SpeechEngine, SpeechOptions } from "./asr";
import type { TtsOptions } from "./tts";
import type { RecentProject, RecoveryInfo } from "./recent-projects";
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
  platform: string;
  windowState(): Promise<WindowState>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  showWindowMenu(menu: "edit" | "view", x: number, y: number): Promise<void>;
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
  exportVideo(project: Project): Promise<string | null>;
  previewAudio(project: Project, clipId: string): Promise<string>;
  synthesize(options: TtsOptions): Promise<Asset>;
  selectNarrationReference(): Promise<Asset | null>;
  cancelTask(): Promise<void>;
  onProgress(
    callback: (event: { percent: number; label: string }) => void,
  ): () => void;
  onShortcut(callback: (command: string) => void): () => void;
  capabilities(): Promise<Capabilities>;
  selectBinary(name: "ffmpeg" | "ffprobe" | "videocaptioner"): Promise<void>;
  transcribe(
    assetId: string,
    engine: SpeechEngine,
    language: string,
    options?: SpeechOptions,
  ): Promise<Cue[]>;
  captureSources(): Promise<CaptureSource[]>;
  selectCapture(id: string, systemAudio: boolean): Promise<void>;
  nativeCaptureAvailable(): Promise<boolean>;
  nativeRecordingStart(
    sourceId: string,
    fps: number,
    systemAudio: boolean,
  ): Promise<void>;
  nativeRecordingPause(paused: boolean): Promise<void>;
  nativeRecordingStop(): Promise<Asset>;
  recordingStart(kind: "screen" | "camera" | "microphone"): Promise<string>;
  recordingChunk(id: string, chunk: Uint8Array): Promise<void>;
  recordingStop(id: string, duration: number): Promise<Asset>;
  recordingAbort(id: string): Promise<void>;
}
declare global {
  interface Window {
    framecraft?: FrameCraftBridge;
  }
}
