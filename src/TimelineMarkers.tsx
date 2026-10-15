import { useRef, useState, type CSSProperties } from "react";
import { Flag } from "lucide-react";
import type { Marker } from "../shared/model";
import {
  dragMarker,
  legacyMarkerColor,
  markerEnd,
  markerTextColor,
  putMarker,
  removeMarker,
  type MarkerDragMode,
} from "../shared/markers";
import type { Editor } from "./useEditor";
import { timeLabel } from "./Preview";
import "./TimelineMarkers.css";

function TimelineMarker({
  marker,
  editor,
  zoom,
  snap,
  onEdit,
}: {
  marker: Marker;
  editor: Editor;
  zoom: number;
  snap: boolean;
  onEdit: (marker: Marker) => void;
}) {
  const [draft, setDraft] = useState<Marker | null>(null);
  const gesture = useRef<{
    pointerId: number;
    x: number;
    original: Marker;
    mode: MarkerDragMode;
  } | null>(null);
  const moved = useRef(false);
  const current = draft ?? marker;
  const range = (current.duration ?? 0) > 0;
  const update = (next: Marker) =>
    editor.apply((project) => putMarker(project, next));
  const cancel = () => {
    gesture.current = null;
    setDraft(null);
  };
  const position = (x: number) => {
    const drag = gesture.current!;
    let delta = (x - drag.x) / zoom;
    if (snap) {
      const points = [
        0,
        editor.playhead,
        ...editor.project.clips.flatMap((clip) => [
          clip.start,
          clip.start + clip.duration,
        ]),
        ...editor.project.markers
          .filter((item) => item.id !== marker.id)
          .flatMap((item) => [item.time, markerEnd(item)]),
      ];
      const edges =
        drag.mode === "move"
          ? [drag.original.time, markerEnd(drag.original)]
          : [
              drag.mode === "start"
                ? drag.original.time
                : markerEnd(drag.original),
            ];
      let adjustment = 6 / zoom;
      for (const point of points)
        for (const edge of edges) {
          const distance = point - edge - delta;
          if (Math.abs(distance) < Math.abs(adjustment)) adjustment = distance;
        }
      if (Math.abs(adjustment) < 6 / zoom) delta += adjustment;
    }
    return dragMarker(
      drag.original,
      drag.mode,
      delta,
      editor.project.canvas.fps,
    );
  };
  const tooltip = `${current.label}\n${timeLabel(current.time)}${range ? ` — ${timeLabel(markerEnd(current))}` : ""}${current.comments ? `\n${current.comments}` : ""}\n拖动移动 · 双击或右键编辑${range ? " · 拖动两端调整范围" : ""}`;
  return (
    <div
      className={`timeline-marker ${range ? "range-marker" : "point-marker"}`}
      data-marker-id={marker.id}
      style={
        {
          left: current.time * zoom,
          width: range ? Math.max(8, current.duration! * zoom) : 14,
          "--marker-color": current.color ?? legacyMarkerColor,
          "--marker-text": markerTextColor(current.color ?? legacyMarkerColor),
        } as CSSProperties
      }
      title={tooltip}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onEdit(marker);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onEdit(marker);
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (
          !moved.current &&
          !(event.target as HTMLElement).closest("[data-marker-edge]")
        ) {
          editor.setPlaying(false);
          editor.seek(marker.time);
        }
      }}
      onKeyDown={(event) => {
        if (
          ![
            "Escape",
            "Delete",
            "Backspace",
            "Enter",
            "ArrowLeft",
            "ArrowRight",
          ].includes(event.key)
        )
          return;
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
        if (gesture.current) return;
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          editor.apply((project) => removeMarker(project, marker.id));
        } else if (event.key === "Enter") {
          event.preventDefault();
          onEdit(marker);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const mode = (event.target as HTMLElement).dataset.markerEdge as
            MarkerDragMode | undefined;
          update(
            dragMarker(
              marker,
              mode ?? "move",
              (event.key === "ArrowLeft" ? -1 : 1) *
                (event.shiftKey ? 1 : 1 / editor.project.canvas.fps),
              editor.project.canvas.fps,
            ),
          );
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        (event.target as HTMLElement)
          .closest<HTMLButtonElement>("button")
          ?.focus();
        const mode = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-marker-edge]",
        )?.dataset.markerEdge as MarkerDragMode | undefined;
        moved.current = false;
        gesture.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          original: marker,
          mode: mode ?? "move",
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        editor.setPlaying(false);
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        if (gesture.current?.pointerId !== event.pointerId) return;
        if (Math.abs(event.clientX - gesture.current.x) >= 3)
          moved.current = true;
        if (moved.current) setDraft(position(event.clientX));
      }}
      onPointerUp={(event) => {
        if (gesture.current?.pointerId !== event.pointerId) return;
        if (moved.current) update(position(event.clientX));
        cancel();
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      <button
        type="button"
        className="marker-body"
        aria-label={`标记：${current.label}`}
      >
        <Flag size={11} fill="currentColor" />
        <span>{current.label}</span>
      </button>
      {range &&
        (["start", "end"] as const).map((edge) => (
          <button
            key={edge}
            type="button"
            className={`marker-edge ${edge}`}
            data-marker-edge={edge}
            role="separator"
            aria-label={`${current.label}：${edge === "start" ? "开始" : "结束"}`}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuenow={edge === "start" ? current.time : markerEnd(current)}
          />
        ))}
    </div>
  );
}

export default function TimelineMarkers({
  editor,
  zoom,
  snap,
  onEdit,
}: {
  editor: Editor;
  zoom: number;
  snap: boolean;
  onEdit: (marker: Marker) => void;
}) {
  return editor.project.markers.map((marker) => (
    <TimelineMarker
      key={`${editor.project.id}-${marker.id}`}
      {...{ marker, editor, zoom, snap, onEdit }}
    />
  ));
}
