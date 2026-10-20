import type { Clip, Project } from "../shared/model";
import { shapeSize } from "../shared/annotation-style";
import { defaultCrop } from "../shared/effects";
import { textBoxFor } from "./text";

/** Normalized object dimensions for edge pivots and directional media reveals. */
export function behaviorObjectSize(clip: Clip, project: Project) {
  if (
    !clip.behaviors?.some(
      (behavior) =>
        behavior.enabled &&
        [behavior.incoming, behavior.during, behavior.outgoing].some(
          (phase) =>
            phase.style === "hinge" ||
            (phase.style === "reveal" && phase.type === "whole"),
        ),
    )
  )
    return { width: 0.08, height: 0.08 };
  const asset = project.assets.find((asset) => asset.id === clip.assetId);
  const size =
    asset ?? (clip.kind === "text" ? textBoxFor(clip) : shapeSize(clip));
  const fit = asset
    ? Math.min(
        project.canvas.width / Math.max(1, asset.width),
        project.canvas.height / Math.max(1, asset.height),
      )
    : 1;
  const crop = clip.crop ?? defaultCrop;
  return {
    width:
      (size.width * fit * (1 - crop.left - crop.right)) / project.canvas.width,
    height:
      (size.height * fit * (1 - crop.top - crop.bottom)) /
      project.canvas.height,
  };
}
