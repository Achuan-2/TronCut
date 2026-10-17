import {
  annotationSvgBody,
  shapeStyleSchema,
} from "../shared/annotation-style";
import { penBrushes, type PenBrush } from "../shared/freehand";

const previewPoints = Array.from({ length: 65 }, (_, i) => {
  const t = i / 64;
  return { x: 16 + t * 108, y: 34 - Math.sin(t * Math.PI * 3) * (18 - t * 10) };
});

export default function PenBrushPicker({
  value,
  color,
  onChange,
}: {
  value: PenBrush;
  color: string;
  onChange: (brush: PenBrush) => void;
}) {
  return (
    <div className="pen-brushes" role="group" aria-label="笔刷">
      {penBrushes.map((brush) => (
        <button
          key={brush.id}
          type="button"
          className="pen-brush-card"
          aria-label={`${brush.name}笔刷`}
          aria-pressed={value === brush.id}
          title={brush.name}
          onClick={() => onChange(brush.id)}
        >
          <svg
            viewBox="0 0 140 68"
            aria-hidden="true"
            dangerouslySetInnerHTML={{
              __html: annotationSvgBody({
                shape: "freehand",
                shapeStyle: shapeStyleSchema.parse({
                  stroke: color,
                  strokeWidth: brush.id === "marker" ? 17 : 9,
                  brush: brush.id,
                  fillEnabled: false,
                }),
                drawing: {
                  enabled: false,
                  duration: 1,
                  delay: 0,
                  points: previewPoints,
                },
              }),
            }}
          />
          <span>{brush.name}</span>
        </button>
      ))}
    </div>
  );
}

export const penColors = [
  "#ffffff",
  "#bdbdbd",
  "#737373",
  "#343434",
  "#000000",
  "#ffd1dc",
  "#ff8585",
  "#ff4949",
  "#ff2020",
  "#b91c1c",
  "#ffb68d",
  "#ffdc63",
  "#a5dc78",
  "#35c3a0",
  "#4bc5ed",
  "#6e8cfa",
  "#b299ed",
  "#ec9ed4",
];
