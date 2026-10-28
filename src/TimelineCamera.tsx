import { useRef, useState } from "react";
import {
  cameraAnimationClip,
  commitCameraAnimation,
} from "../shared/canvas-camera";
import {
  animationRanges,
  retimeAnimation,
  type AnimationRange,
  type AnimationDragMode,
} from "../shared/animation-ranges";
import { removeAnimation } from "../shared/animation-edit";
import type { Clip } from "../shared/model";
import type { Editor } from "./useEditor";
import { timeLabel } from "./Preview";

export const cameraLaneHeight = 44;

export default function TimelineCamera({
  editor,
  zoom,
}: {
  editor: Editor;
  zoom: number;
}) {
  const clip = cameraAnimationClip(editor.project);
  const [draft, setDraft] = useState<Clip | null>(null);
  const [menu, setMenu] = useState<AnimationRange | null>(null);
  const drag = useRef<{
    x: number;
    clip: Clip;
    range: AnimationRange;
    mode: AnimationDragMode;
    value: Clip;
  } | null>(null);
  const displayed = draft ?? clip;
  const commit = (value: Clip) =>
    editor.apply((project) => commitCameraAnimation(project, value));
  const remove = (range: AnimationRange) => {
    commit(removeAnimation(clip, range));
    setMenu(null);
  };
  if (editor.timelineBounds) return <div className="timeline-camera" />;
  return (
    <div
      className="timeline-camera"
      aria-label="画布缩放与平移时间轴"
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current) return;
        current.value = retimeAnimation(
          current.clip,
          current.range,
          current.mode,
          (event.clientX - current.x) / zoom,
          editor.project.canvas.fps,
        );
        setDraft(current.value);
      }}
      onPointerUp={() => {
        const current = drag.current;
        if (!current) return;
        if (current.value !== current.clip) {
          commit(current.value);
          const index = animationRanges(current.clip).findIndex(
            (range) =>
              range.start === current.range.start &&
              range.end === current.range.end,
          );
          const moved = animationRanges(current.value)[index];
          if (moved)
            editor.seek(current.mode === "start" ? moved.start : moved.end);
        }
        drag.current = null;
        setDraft(null);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDraft(null);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        setDraft(null);
      }}
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
      {animationRanges(displayed).map((range, index) => (
        <div
          key={index}
          className="camera-animation"
          data-start={range.start}
          data-end={range.end}
          style={{
            left: range.start * zoom,
            width: Math.max(2, (range.end - range.start) * zoom),
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu(range);
          }}
        >
          {(["move", "start", "end"] as const).map((mode) => (
            <button
              key={mode}
              className={`camera-animation-${mode}`}
              aria-label={`画布运镜${mode === "move" ? "动画" : mode === "start" ? "开始" : "结束"} ${timeLabel(mode === "start" ? range.start : range.end)}`}
              title={`画布缩放与平移 ${timeLabel(range.start)} → ${timeLabel(range.end)}；拖动调整，Delete 删除`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                editor.setPlaying(false);
                editor.seek(mode === "start" ? range.start : range.end);
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                setMenu(null);
                drag.current = {
                  x: event.clientX,
                  clip,
                  range,
                  mode,
                  value: clip,
                };
              }}
              onKeyDown={(event) => {
                if (event.key !== "Delete" && event.key !== "Backspace") return;
                event.preventDefault();
                event.stopPropagation();
                remove(range);
              }}
            >
              {mode === "move" ? "→" : ""}
            </button>
          ))}
        </div>
      ))}
      {menu && (
        <button
          className="camera-animation-remove"
          style={{ left: menu.start * zoom }}
          onClick={() => remove(menu)}
          onBlur={() => setMenu(null)}
          autoFocus
        >
          删除画布运镜
        </button>
      )}
    </div>
  );
}
