import type { Editor } from "./useEditor";

export default function GroupTimelineMask({
  editor,
  zoom,
  width,
}: {
  editor: Editor;
  zoom: number;
  width: number;
}) {
  const bounds = editor.timelineBounds;
  if (!bounds) return null;
  return (
    <>
      {[
        { side: "before", left: 0, width: bounds.start * zoom },
        {
          side: "after",
          left: bounds.end * zoom,
          width: Math.max(0, width - bounds.end * zoom),
        },
      ].map((part) => (
        <div
          key={part.side}
          className={`group-timeline-mask ${part.side}`}
          data-start={bounds.start}
          data-end={bounds.end}
          style={{ left: part.left, width: part.width }}
          title="组合范围外"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "none";
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      ))}
    </>
  );
}
