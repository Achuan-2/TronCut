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

export const recordingBackgrounds = {
  mint: { name: "薄荷", colors: ["#143e42", "#7bdbc3"] },
  violet: { name: "紫雾", colors: ["#30295b", "#bd9ce4"] },
  sunset: { name: "日落", colors: ["#793c63", "#f6ae7d"] },
  dark: { name: "深灰", colors: ["#111827", "#475569"] },
} as const;
export const recordingBackgroundSchema = z.enum([
  "mint",
  "violet",
  "sunset",
  "dark",
]);
export type RecordingBackground = z.infer<typeof recordingBackgroundSchema>;
export const recordingSettingsSchema = z.object({
  background: z.boolean(),
  preset: recordingBackgroundSchema,
  padding: z.number().finite().min(0).max(0.25),
  radius: z.number().finite().min(0).max(200),
  cursor: cursorStyleSchema,
  autoZoom: z.boolean(),
  zoom: z.number().finite().min(1.2).max(3),
});
export type RecordingSettings = z.infer<typeof recordingSettingsSchema>;
export const defaultRecordingSettings: RecordingSettings = {
  background: true,
  preset: "mint",
  padding: 0.08,
  radius: 0,
  cursor: { ...defaultCursorStyle, size: 40 },
  autoZoom: true,
  zoom: 1.8,
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

/** Fixed viewport: zoom the source inside its frame so the background stays still. */
export function recordingZoomFrames(
  asset: Asset,
  clip: Clip,
  zoom: number,
): Clip["keyframes"] {
  if (clip.duration < 1 || !asset.cursor) return [];
  zoom = Math.max(1.2, Math.min(3, zoom));
  const regions: { start: number; end: number; focus: Focus }[] = [];
  for (const focus of recordingFocuses(asset, clip)) {
    const start = Math.max(0, focus.time - 0.65),
      end = Math.min(clip.duration, focus.time + 1.9);
    const previous = regions.at(-1);
    if (previous && start <= previous.end + 0.5) {
      // Nearby actions share a shot; avoid chasing every tiny pointer movement.
      if (
        Math.hypot(focus.x - previous.focus.x, focus.y - previous.focus.y) <
          0.16 &&
        end - previous.start < 7
      )
        previous.end = end;
      continue;
    }
    if (end - start >= 1) regions.push({ start, end, focus });
    if (regions.length >= 1000) break;
  }
  return regions.flatMap(({ start, end, focus }) => {
    const edge = Math.min(0.5, (end - start) / 3);
    const x = Math.max(0.5 / zoom, Math.min(1 - 0.5 / zoom, focus.x));
    const y = Math.max(0.5 / zoom, Math.min(1 - 0.5 / zoom, focus.y));
    const base = {
      ...clip.transform,
      contentX: 0,
      contentY: 0,
      contentScale: 1,
    };
    const close = {
      ...base,
      contentX: (0.5 - x) * zoom,
      contentY: (0.5 - y) * zoom,
      contentScale: zoom,
    };
    return [
      { time: start, value: base },
      { time: start + edge, value: close },
      { time: end - edge, value: close },
      { time: end, value: base },
    ].map((frame, i) => ({
      ...frame,
      easing: "auto" as const,
      ...(i % 2 ? { animation: true as const } : {}),
      recordingZoom: true as const,
    }));
  });
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
      kind: "image",
      name: "录屏背景",
      start,
      duration: screen.asset.duration,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      transform: { ...defaultTransform },
      keyframes: [],
    });
  }
  return {
    ...project,
    tracks: [...tracks, ...project.tracks],
    clips: [...project.clips, ...clips],
    assets: [...project.assets, ...assets],
  };
}
