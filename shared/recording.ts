import { z } from "zod";
import {
  cursorStyleSchema,
  defaultTransform,
  newTrack,
  uid,
  type Asset,
  type Clip,
  type Project,
} from "./model";
import { defaultCursorStyle } from "./cursor";
import { recordlyBackgrounds } from "./recording-backgrounds";
import {
  recordingCameraFrames,
  sceneRecordingFrames,
} from "./recording-camera";

export const recordingBackgrounds = {
  mint: { name: "薄荷", colors: ["#143e42", "#7bdbc3"] },
  violet: { name: "紫雾", colors: ["#30295b", "#bd9ce4"] },
  sunset: { name: "日落", colors: ["#793c63", "#f6ae7d"] },
  dark: { name: "深灰", colors: ["#111827", "#475569"] },
  ...recordlyBackgrounds,
} as const;
export const recordingBackgroundSchema = z.enum(
  Object.keys(recordingBackgrounds) as [
    keyof typeof recordingBackgrounds,
    ...(keyof typeof recordingBackgrounds)[],
  ],
);
export type RecordingBackground = z.infer<typeof recordingBackgroundSchema>;
export const recordingSettingsSchema = z.object({
  background: z.boolean(),
  preset: recordingBackgroundSchema,
  padding: z.number().finite().min(0).max(0.25),
  radius: z.number().finite().min(0).max(200),
  cursor: cursorStyleSchema,
  autoZoom: z.boolean(),
  zoom: z.number().finite().min(1.2).max(3),
  zoomBackground: z.boolean().default(false),
});
export type RecordingSettings = z.infer<typeof recordingSettingsSchema>;
export const defaultRecordingSettings: RecordingSettings = {
  background: true,
  preset: "tahoe-light",
  padding: 0.08,
  radius: 0,
  cursor: { ...defaultCursorStyle, style: "tahoe", size: 40 },
  autoZoom: true,
  zoom: 1.8,
  zoomBackground: false,
};
export type RecordedAsset = {
  asset: Asset;
  kind: "screen" | "camera" | "microphone";
};

type Focus = { time: number; x: number; y: number };
/** Click edges and deliberate rests are useful focal points; motion alone is not. */
export function recordingFocuses(asset: Asset, clip: Clip): Focus[] {
  const points: Focus[] = [];
  let pressed = false;
  let rest:
    { time: number; x: number; y: number; emitted: boolean } | undefined;
  const end = clip.sourceIn + clip.duration * clip.speed;
  for (const sample of asset.cursor?.samples ?? []) {
    const valid =
      sample.visible &&
      Number.isFinite(sample.time) &&
      Number.isFinite(sample.x) &&
      Number.isFinite(sample.y) &&
      sample.x >= 0 &&
      sample.x <= 1 &&
      sample.y >= 0 &&
      sample.y <= 1;
    const click = valid && sample.click && !pressed;
    pressed = sample.click;
    if (!valid || sample.time < clip.sourceIn || sample.time > end) {
      rest = undefined;
      continue;
    }
    if (
      !rest ||
      sample.time < rest.time ||
      Math.hypot(sample.x - rest.x, sample.y - rest.y) > 0.025
    )
      rest = { time: sample.time, x: sample.x, y: sample.y, emitted: false };
    const dwell = !rest.emitted && sample.time - rest.time >= 0.9;
    if (click || dwell) {
      points.push({
        time:
          ((dwell && !click ? rest.time + 0.45 : sample.time) - clip.sourceIn) /
          clip.speed,
        x: sample.x,
        y: sample.y,
      });
      rest.emitted = true;
    }
  }
  return points.sort((a, b) => a.time - b.time);
}

/** Bake the Recordly camera into editable content transforms. */
export function recordingZoomFrames(
  asset: Asset,
  clip: Clip,
  zoom: number,
): Clip["keyframes"] {
  return recordingCameraFrames(asset, clip, zoom);
}

export function addRecordedAssets(
  project: Project,
  results: RecordedAsset[],
  settings: RecordingSettings,
  start: number,
  background?: Asset,
): Project {
  const tracks: Project["tracks"] = [],
    clips: Clip[] = [],
    assets = results.map((r) => r.asset);
  for (const { asset, kind } of results) {
    const track = newTrack(tracks.length);
    if (kind === "camera") tracks.unshift(track);
    else tracks.push(track);
    const framed = kind === "screen" && settings.background && !!background;
    const clip: Clip = {
      id: uid(),
      trackId: track.id,
      assetId: asset.id,
      kind: asset.kind,
      name: asset.name,
      start,
      duration: asset.duration,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform:
        kind === "camera"
          ? { x: 0.83, y: 0.8, scale: 0.25, opacity: 1 }
          : {
              ...defaultTransform,
              scale: framed ? 1 - 2 * settings.padding : 1,
            },
      keyframes: [],
      ...(kind === "screen" && asset.cursor
        ? { cursorStyle: { ...settings.cursor } }
        : {}),
      ...(framed ? { mediaFrame: { radius: settings.radius } } : {}),
    };
    if (kind === "screen" && settings.autoZoom)
      clip.keyframes = recordingZoomFrames(asset, clip, settings.zoom);
    clips.push(clip);
  }
  const screen = results.find((r) => r.kind === "screen");
  const screenClip = clips.find((c) => c.assetId === screen?.asset.id);
  const contentFrames = screenClip?.keyframes ?? [];
  if (settings.zoomBackground && screenClip && screen)
    screenClip.keyframes = sceneRecordingFrames(
      contentFrames,
      screenClip,
      screen.asset,
      project.canvas,
      screenClip.transform,
    );
  if (settings.background && background && screen) {
    const track = {
      ...newTrack(tracks.length),
      name: "录屏背景",
      customName: true,
    };
    tracks.push(track);
    assets.push(background);
    clips.push({
      id: uid(),
      trackId: track.id,
      assetId: background.id,
      kind: background.kind,
      name: "录屏背景",
      start,
      duration: screen.asset.duration,
      sourceIn: 0,
      speed: 1,
      volume: 0,
      podcast: false,
      loop: background.kind === "video",
      transform: {
        ...defaultTransform,
        scale:
          Math.max(
            project.canvas.width / background.width,
            project.canvas.height / background.height,
          ) /
          Math.min(
            project.canvas.width / background.width,
            project.canvas.height / background.height,
          ),
      },
      keyframes: [],
    });
    const backdrop = clips.at(-1)!;
    if (settings.zoomBackground && screenClip)
      backdrop.keyframes = sceneRecordingFrames(
        contentFrames,
        screenClip,
        screen.asset,
        project.canvas,
        backdrop.transform,
      );
  }
  return {
    ...project,
    tracks: [...tracks, ...project.tracks],
    clips: [...project.clips, ...clips],
    assets: [...project.assets, ...assets],
  };
}
