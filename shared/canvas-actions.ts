import {
  type Clip,
  type Project,
  type Transform,
  newTrack,
  numberTracks,
} from "./model";
import { editableIds } from "./timeline";
import {
  rotationMatrix,
  optionalTransformDefault,
  optionalTransformKeys,
} from "./rotation";
import { visualValues } from "./visual-state";
import { setTransform, setKeyframeTransform } from "./editor";
import { recordingGroups } from "./recording-objects";
import { maskValues } from "./mask-state";

// Recording children travel with their master, but appearance editing targets
// only the screen, matching canvas selection and the inspector.
export function editableCanvasIds(
  project: Project,
  ids: readonly string[],
): Set<string> {
  const editable = editableIds(project, ids);
  const groups = recordingGroups(project);
  return new Set(
    project.clips
      .filter((clip) => {
        const master = clip.groupId ? groups.get(clip.groupId) : undefined;
        return editable.has(clip.id) && (!master || master.id === clip.id);
      })
      .map((clip) => clip.id),
  );
}

// Media, text content, timing and grouping stay owned by the destination.
// Transform properties follow the inspector's apply-to-all-keyframes behavior.
// Optional fields deliberately clear an older style.
const appearanceKeys = [
  "transform",
  "rotation",
  "lockAspectRatio",
  "crop",
  "contentTransform",
  "effects",
  "visualEffects",
  "mediaFrame",
  "volume",
  "podcast",
  "autoNormalizeLoudness",
  "cursorStyle",
] as const;
const textKeys = ["style", "textBox", "autoResizeText"] as const;

export interface ClipPropertyEndpoint {
  clipId: string;
  /** Stored animation time, including animationOffset. */
  time: number;
  side: "start" | "end";
}

function copiedTransform(source: Clip): Transform {
  return structuredClone({
    ...source.transform,
    ...Object.fromEntries(
      optionalTransformKeys.map((key) => [
        key,
        source.transform[key] ??
          (key === "rotation"
            ? (source.rotation ?? 0)
            : optionalTransformDefault(key)),
      ]),
    ),
    ...visualValues(source, source.transform),
  });
}

export function pasteClipProperties(
  project: Project,
  ids: readonly string[],
  source: Clip,
  endpoint?: ClipPropertyEndpoint,
): Project {
  const editable = editableCanvasIds(project, ids);
  if (!editable.size) return project;
  if (endpoint) {
    const clip = project.clips.find((clip) => clip.id === endpoint.clipId);
    if (!clip || !editable.has(clip.id)) return project;
    const ordered = [...clip.keyframes].sort((a, b) => a.time - b.time);
    const existing = ordered.find(
      (frame) => Math.abs(frame.time - endpoint.time) < 1e-6,
    );
    const implicitStart =
      endpoint.time === 0 && ordered.length > 0 && ordered[0].time > 0;
    if (!existing && !implicitStart) return project;
    // A first-start edit changes the base pose. Freeze the other points' crop,
    // content and mask defaults first so they cannot inherit the pasted values.
    const initial =
      endpoint.side === "start" || existing === ordered[0] || implicitStart;
    const normalize = (value: Transform) => ({
      ...value,
      ...visualValues(clip, value),
      ...(clip.visualEffects?.mask ? maskValues(clip, value) : {}),
    });
    const target = initial
      ? {
          ...clip,
          keyframes: clip.keyframes.map((frame) => ({
            ...frame,
            value: normalize(frame.value),
          })),
        }
      : clip;
    const next = setKeyframeTransform(
      target,
      {
        ...copiedTransform(source),
        ...(clip.visualEffects?.mask
          ? maskValues(source, source.transform)
          : {}),
      },
      endpoint.time,
      endpoint.side === "start",
    );
    return {
      ...project,
      clips: project.clips.map((clip) => (clip.id === next.id ? next : clip)),
    };
  }
  return {
    ...project,
    clips: project.clips.map((clip) => {
      if (!editable.has(clip.id)) return clip;
      const keys = [
        ...appearanceKeys,
        ...(source.kind === "text" && clip.kind === "text" ? textKeys : []),
        ...(source.kind === "shape" && clip.kind === "shape"
          ? [
              "fill" as const,
              "shapeStyle" as const,
              "annotationEffect" as const,
            ]
          : []),
      ];
      const patch = Object.fromEntries(
        keys.map((key) => [key, structuredClone(source[key])]),
      );
      return setTransform(
        { ...clip, ...patch },
        copiedTransform(source),
        0,
        false,
      );
    }),
  };
}

export function fitFrameTransform(
  value: Transform,
  size: { width: number; height: number },
  canvas: { width: number; height: number },
  rotation = 0,
): Pick<Transform, "x" | "y" | "scale"> {
  const { a, b, c, d } = rotationMatrix(value, rotation);
  const width = Math.abs(a) * size.width + Math.abs(c) * size.height;
  const height = Math.abs(b) * size.width + Math.abs(d) * size.height;
  return {
    x: 0.5,
    y: 0.5,
    scale: Math.max(
      0.05,
      Math.min(
        8,
        canvas.width / Math.max(1e-6, width),
        canvas.height / Math.max(1e-6, height),
      ),
    ),
  };
}

export type ArrangeDirection = "top" | "up" | "down" | "bottom";

// Layer order is track order in both preview and export. Split shared tracks
// so arranging selected objects never moves unrelated clips on the same track.
function arrangementPlan(
  project: Project,
  ids: readonly string[],
  direction: ArrangeDirection,
) {
  const editable = editableIds(project, ids);
  const selected = project.clips.filter((clip) => editable.has(clip.id));
  if (!selected.length || ids.some((id) => !editable.has(id))) return null;
  const sourceTracks = project.tracks.filter((track) =>
    selected.some((clip) => clip.trackId === track.id),
  );
  const shared = new Set(
    sourceTracks
      .filter((track) =>
        project.clips.some(
          (clip) => clip.trackId === track.id && !editable.has(clip.id),
        ),
      )
      .map((track) => track.id),
  );
  if (project.tracks.length + shared.size > 128) return null;
  const first = project.tracks.indexOf(sourceTracks[0]);
  const last = project.tracks.indexOf(sourceTracks.at(-1)!);
  const above = direction === "top" || direction === "up";
  const boundary = above ? first : last;
  const atEdge =
    direction === "top" || direction === "bottom"
      ? sourceTracks.every(
          (track, index) =>
            track ===
              project.tracks[
                above
                  ? index
                  : project.tracks.length - sourceTracks.length + index
              ] && !shared.has(track.id),
        )
      : (above ? boundary === 0 : boundary === project.tracks.length - 1) &&
        !shared.has(project.tracks[boundary].id);
  if (atEdge) return null;
  const sourceIds = new Set(sourceTracks.map((track) => track.id));
  const remaining = project.tracks.filter(
    (track) => !sourceIds.has(track.id) || shared.has(track.id),
  );
  let index = direction === "top" ? 0 : remaining.length;
  if (direction === "up" || direction === "down") {
    const anchor = shared.has(project.tracks[boundary].id)
      ? project.tracks[boundary]
      : project.tracks[boundary + (above ? -1 : 1)];
    index =
      remaining.findIndex((track) => track.id === anchor?.id) + (above ? 0 : 1);
  }
  return { editable, sourceTracks, shared, remaining, index };
}

export function canArrangeClips(
  project: Project,
  ids: readonly string[],
  direction: ArrangeDirection,
): boolean {
  return arrangementPlan(project, ids, direction) !== null;
}

export function arrangeClips(
  project: Project,
  ids: readonly string[],
  direction: ArrangeDirection,
): Project {
  const plan = arrangementPlan(project, ids, direction);
  if (!plan) return project;
  const { editable, sourceTracks, shared, remaining, index } = plan;
  const destinations = new Map(
    sourceTracks.map((track) => [
      track.id,
      shared.has(track.id)
        ? {
            ...newTrack(project.tracks.length),
            hidden: track.hidden,
            muted: track.muted,
            solo: track.solo,
          }
        : track,
    ]),
  );
  const tracks = [...remaining];
  tracks.splice(Math.max(0, index), 0, ...destinations.values());
  return {
    ...project,
    tracks: numberTracks(tracks),
    clips: project.clips.map((clip) =>
      editable.has(clip.id)
        ? { ...clip, trackId: destinations.get(clip.trackId)!.id }
        : clip,
    ),
  };
}
