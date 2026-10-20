import { useRef, useState } from "react";
import type { Clip } from "../shared/model";
import {
  frameExtensionError,
  setFrameExtension,
} from "../shared/frame-extension";
import type { Editor } from "./useEditor";

export default function TimelineFrameExtension({
  clip,
  start,
  duration,
  zoom,
  editor,
  onEdit,
  onContextMenu,
}: {
  clip: Clip;
  start: number;
  duration: number;
  zoom: number;
  editor: Editor;
  onEdit: (x: number, y: number) => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const drag = useRef<{ x: number; duration: number } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = !!editor.project.tracks.find(
    (track) => track.id === clip.trackId,
  )?.locked;
  return (
    <div
      className="frame-extension-region"
      data-start={start}
      data-duration={duration}
      style={{
        left: start * zoom,
        width: Math.max(4, (preview ?? duration) * zoom),
      }}
      title={
        error ??
        `帧定格 · ${Number(duration.toFixed(3))} 秒；拖动移动视频，双击修改，拖动右边缘调整时长`
      }
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (!locked) onEdit(event.clientX, event.clientY);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(event.clientX, event.clientY);
      }}
    >
      <span>帧定格</span>
      <button
        type="button"
        className="frame-extension-handle"
        aria-label="调整帧定格时长"
        disabled={locked}
        onPointerDown={(event) => {
          if (event.button !== 0 || locked) return;
          event.preventDefault();
          event.stopPropagation();
          editor.setPlaying(false);
          editor.select(clip.id);
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, duration };
          setError(null);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const fps = editor.project.canvas.fps;
          const seconds = Math.max(
            1 / fps,
            Math.round(
              (duration + (event.clientX - drag.current.x) / zoom) * fps,
            ) / fps,
          );
          const error = frameExtensionError(
            editor.project,
            clip.id,
            start,
            seconds,
          );
          setError(error);
          if (!error) {
            drag.current.duration = seconds;
            setPreview(seconds);
          }
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          event.stopPropagation();
          const seconds = drag.current.duration;
          drag.current = null;
          editor.apply((project) =>
            setFrameExtension(project, clip.id, start, seconds),
          );
          setPreview(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setPreview(null);
          setError(null);
        }}
      />
    </div>
  );
}
