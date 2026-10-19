import type { Clip, Project } from "./model";
import { editableCanvasIds } from "./canvas-actions";
import { setTransform, transformAt } from "./editor";
import { rotationMatrix } from "./rotation";
import { isTrackActive } from "./tracks";
import { visualClipAt } from "./visual-state";
import { shapeSize } from "./annotation-style";

export type CanvasAlignment =
  "left" | "center" | "right" | "top" | "middle" | "bottom";
type Size = { width: number; height: number };

export function canvasAlignmentTargets(
  project: Project,
  ids: readonly string[],
  time: number,
) {
  const editable = editableCanvasIds(project, ids);
  return project.clips.filter(
    (clip) =>
      editable.has(clip.id) &&
      clip.kind !== "audio" &&
      isTrackActive(project.tracks, clip.trackId) &&
      time >= clip.start &&
      time < clip.start + clip.duration,
  );
}

/** Align projected frame edges within the selected objects' union, in one edit.
 * Text measurement is supplied by the renderer so it uses the actual local font.
 */
export function alignCanvasClips(
  project: Project,
  ids: readonly string[],
  alignment: CanvasAlignment,
  time: number,
  measureText: (clip: Clip) => Size,
  autoAnimate = false,
  animationDuration = 1,
): Project {
  const targets = canvasAlignmentTargets(project, ids, time);
  if (targets.length < 2) return project;
  const horizontal = ["left", "center", "right"].includes(alignment);
  const axis = horizontal ? "x" : "y";
  const dimension = horizontal ? project.canvas.width : project.canvas.height;
  const frames = targets.map((clip) => {
    const value = transformAt(clip, time - clip.start);
    const sampled = visualClipAt(clip, value);
    const asset = project.assets.find((asset) => asset.id === clip.assetId);
    const fit = asset
      ? Math.min(
          project.canvas.width / Math.max(1, asset.width),
          project.canvas.height / Math.max(1, asset.height),
        )
      : 1;
    const size =
      clip.kind === "text"
        ? measureText(sampled)
        : asset
          ? {
              width:
                asset.width *
                fit *
                (1 - sampled.crop!.left - sampled.crop!.right),
              height:
                asset.height *
                fit *
                (1 - sampled.crop!.top - sampled.crop!.bottom),
            }
          : shapeSize(sampled);
    const { a, b, c, d } = rotationMatrix(value, clip.rotation);
    const extent =
      (horizontal
        ? Math.abs(a) * size.width + Math.abs(c) * size.height
        : Math.abs(b) * size.width + Math.abs(d) * size.height) * value.scale;
    const center = value[axis] * dimension;
    return {
      clip,
      value,
      extent,
      min: center - extent / 2,
      max: center + extent / 2,
    };
  });
  const min = Math.min(...frames.map((frame) => frame.min));
  const max = Math.max(...frames.map((frame) => frame.max));
  const changes = new Map<string, Clip>();
  for (const frame of frames) {
    const center =
      alignment === "left" || alignment === "top"
        ? min + frame.extent / 2
        : alignment === "right" || alignment === "bottom"
          ? max - frame.extent / 2
          : (min + max) / 2;
    const position = Math.max(-4, Math.min(4, center / dimension));
    if (Math.abs(position - frame.value[axis]) < 1e-9) continue;
    changes.set(
      frame.clip.id,
      setTransform(
        frame.clip,
        { [axis]: position },
        time - frame.clip.start,
        autoAnimate,
        animationDuration,
      ),
    );
  }
  return changes.size
    ? {
        ...project,
        clips: project.clips.map((clip) => changes.get(clip.id) ?? clip),
      }
    : project;
}
