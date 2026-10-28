import {
  defaultTransform,
  projectDuration,
  type Clip,
  type Project,
  type Transform,
} from "./model";
import { cameraAt, clampCamera } from "./canvas";
import { setTransform } from "./editor";
import { addAnimationKeyframe } from "./animation-edit";

// Adapt the project camera to the shared animation tools without adding a media
// object or changing any clip transforms. Camera times are project times.
export function cameraAnimationClip(project: Project): Clip {
  return {
    id: "canvas-camera",
    trackId: "canvas-camera",
    kind: "shape",
    name: "画布缩放与平移",
    start: 0,
    duration: Math.max(1 / project.canvas.fps, projectDuration(project)),
    sourceIn: 0,
    speed: 1,
    volume: 0,
    podcast: false,
    transform: project.camera?.transform ?? defaultTransform,
    keyframes: project.camera?.keyframes ?? [],
  };
}

export function commitCameraAnimation(project: Project, clip: Clip): Project {
  return {
    ...project,
    camera: {
      transform: clampCamera(clip.transform),
      keyframes: clip.keyframes.map((frame) => ({
        ...frame,
        value: clampCamera(frame.value),
      })),
    },
  };
}

export function updateCanvasCamera(
  project: Project,
  patch: Partial<Transform>,
  time: number,
  duration = 1,
): Project {
  const clip = cameraAnimationClip(project);
  return commitCameraAnimation(
    project,
    setTransform(
      clip,
      clampCamera({ ...cameraAt(project, time), ...patch }),
      time,
      true,
      duration,
    ),
  );
}

export function addCanvasCameraAnimation(
  project: Project,
  time: number,
  duration = 1,
) {
  const added = addAnimationKeyframe(
    cameraAnimationClip(project),
    time,
    project.canvas.fps,
    duration,
  );
  return added
    ? { project: commitCameraAnimation(project, added.clip), time: added.time }
    : null;
}
