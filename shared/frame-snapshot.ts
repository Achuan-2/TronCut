import { type Project } from "./model";
import { transformAt } from "./editor";
import { cameraAt } from "./canvas";
import { fadeOpacity } from "./effects";
import { shiftBehaviors } from "./behaviors";
import { transitionRange, transitionTransform } from "./transitions";
import { isTrackActive } from "./tracks";
import { freezeVisualEffects } from "./visual-effects";

/** Freeze visible layers at one timeline instant while retaining source timestamps. */
export function frameSnapshot(
  project: Project,
  time: number,
  endpointClipId?: string,
): Project {
  const visible = new Set(
    project.tracks
      .filter((track) => isTrackActive(project.tracks, track.id))
      .map((track) => track.id),
  );
  return {
    ...project,
    camera: project.camera
      ? { transform: cameraAt(project, time), keyframes: [] }
      : undefined,
    clips: project.clips
      .filter((clip) => {
        const range = transitionRange(project, clip);
        return (
          clip.kind !== "audio" &&
          visible.has(clip.trackId) &&
          time >= range.start &&
          (time < range.end ||
            (clip.id === endpointClipId &&
              Math.abs(time - clip.start - clip.duration) < 1e-6))
        );
      })
      .map((clip) => {
        const local = Math.max(0, Math.min(clip.duration, time - clip.start));
        const transform = transitionTransform(
          project,
          clip,
          transformAt(clip, local),
          time,
        );
        return {
          ...clip,
          visualEffects: freezeVisualEffects(clip, local),
          start: 0,
          duration: 1 / project.canvas.fps,
          sourceIn: clip.sourceIn + local * clip.speed,
          transitions: undefined,
          speed: 1,
          transform: {
            ...transform,
            opacity: transform.opacity * fadeOpacity(clip, local),
          },
          animationOffset: undefined,
          keyframes: [],
          fadeIn: 0,
          fadeOut: 0,
          ...(clip.behaviors ? { behaviors: shiftBehaviors(clip, local) } : {}),
        };
      }),
  };
}
