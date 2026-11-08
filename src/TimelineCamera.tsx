import { useMemo } from "react";
import {
  cameraAnimationClip,
  commitCameraAnimation,
} from "../shared/canvas-camera";
import type { AnimationRange } from "../shared/animation-ranges";
import type { Editor } from "./useEditor";
import { TimelineAnimations } from "./TimelineAnimations";

export const cameraLaneHeight = 44;

/** Adapt the project camera to the same arrows and editing tools as clip animations. */
export default function TimelineCamera({
  editor,
  zoom,
  viewportStart,
  viewportEnd,
  copy,
}: {
  editor: Editor;
  zoom: number;
  viewportStart: number;
  viewportEnd: number;
  copy: (range: AnimationRange, cut?: boolean) => void;
}) {
  const clip = useMemo(
    () => cameraAnimationClip(editor.project),
    [editor.project.clips, editor.project.camera],
  );
  return (
    <div
      className="timeline-camera"
      aria-label="画布缩放与平移时间轴"
      onDoubleClick={(event) => {
        if (event.target !== event.currentTarget) return;
        editor.seek(
          Math.max(
            0,
            (event.clientX - event.currentTarget.getBoundingClientRect().left) /
              zoom,
          ),
        );
        editor.addCanvasZoomPan();
      }}
    >
      <TimelineAnimations
        clip={clip}
        zoom={zoom}
        editor={editor}
        fps={editor.project.canvas.fps}
        selected={editor.cameraSelected}
        selectedFrame={editor.selectedCameraFrame}
        locked={false}
        viewportStart={viewportStart}
        viewportEnd={viewportEnd}
        locate={editor.editCameraFrame}
        select={(range) => editor.editCameraFrame(range.end, "end")}
        commit={(value) =>
          editor.apply((project) => commitCameraAnimation(project, value))
        }
        copy={copy}
        remove={(range) => editor.deleteAnimation(clip.id, range)}
      />
    </div>
  );
}
