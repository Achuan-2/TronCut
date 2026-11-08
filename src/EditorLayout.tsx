import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import "./EditorLayout.css";

const storageKey = "troncut.timeline-height";
const minimumHeight = 180;
const workspaceMinimumHeight = 280;
const dividerHeight = 6;

function readHeight(): number | null {
  try {
    const value = Number(localStorage.getItem(storageKey));
    return Number.isFinite(value) && value >= minimumHeight ? value : null;
  } catch {
    return null;
  }
}

export default function EditorLayout({
  workspace,
  timeline,
}: {
  workspace: ReactNode;
  timeline: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    pointerId: number;
    y: number;
    height: number;
  } | null>(null);
  const [preferredHeight, setPreferredHeight] = useState(readHeight);
  const [preview, setPreview] = useState<number | null>(null);
  const [availableHeight, setAvailableHeight] = useState(0);
  const [compact, setCompact] = useState(() => window.innerHeight <= 800);

  useEffect(() => {
    const element = root.current!;
    const observer = new ResizeObserver(() => {
      setAvailableHeight(element.clientHeight);
      setCompact(window.innerHeight <= 800);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const maximumHeight = availableHeight
    ? Math.max(
        minimumHeight,
        availableHeight - workspaceMinimumHeight - dividerHeight,
      )
    : Math.max(
        minimumHeight,
        window.innerHeight - workspaceMinimumHeight - dividerHeight,
      );
  const clamp = (value: number) =>
    Math.max(minimumHeight, Math.min(maximumHeight, Math.round(value)));
  const height = clamp(preview ?? preferredHeight ?? (compact ? 258 : 300));
  const cancel = () => {
    gesture.current = null;
    setPreview(null);
  };
  const commit = (value: number | null) => {
    cancel();
    const next = value === null ? null : clamp(value);
    setPreferredHeight(next);
    try {
      if (next === null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(next));
    } catch {
      // The layout remains usable when browser storage is unavailable.
    }
  };

  return (
    <div
      ref={root}
      className={`editor-layout${preview === null ? "" : " resizing"}`}
      style={{ "--timeline-height": `${height}px` } as CSSProperties}
    >
      {workspace}
      <button
        type="button"
        role="separator"
        className="timeline-resize-handle"
        aria-label="调整时间轴整体高度"
        aria-orientation="horizontal"
        aria-valuemin={minimumHeight}
        aria-valuemax={maximumHeight}
        aria-valuenow={height}
        title="拖动调整时间轴整体高度；双击恢复默认高度"
        onDoubleClick={() => commit(null)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = {
            pointerId: event.pointerId,
            y: event.clientY,
            height,
          };
          setPreview(height);
        }}
        onPointerMove={(event) => {
          const drag = gesture.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          setPreview(clamp(drag.height + drag.y - event.clientY));
        }}
        onPointerUp={(event) => {
          const drag = gesture.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          commit(drag.height + drag.y - event.clientY);
        }}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          } else if (
            ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
          ) {
            event.preventDefault();
            event.stopPropagation();
            commit(
              event.key === "Home"
                ? minimumHeight
                : event.key === "End"
                  ? maximumHeight
                  : height +
                    (event.key === "ArrowUp" ? 1 : -1) *
                      (event.shiftKey ? 40 : 10),
            );
          }
        }}
      />
      {timeline}
    </div>
  );
}
