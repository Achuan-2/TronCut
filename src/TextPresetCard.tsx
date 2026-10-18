import { Plus } from "lucide-react";
import { annotationMime, type AnnotationTemplate } from "../shared/annotations";
import type { TextPreset } from "../shared/preset-library";
import type { Editor } from "./useEditor";
import PresetTile from "./PresetTile";

export default function TextPresetCard({
  preset,
  editor,
}: {
  preset: TextPreset;
  editor: Editor;
}) {
  const template: AnnotationTemplate = {
    kind: "text",
    preset: 0,
    style: preset.style,
  };
  return (
    <PresetTile
      kind="text"
      id={preset.id}
      name={preset.name}
      custom={preset.id.startsWith("user-")}
      library={editor.presetLibrary}
    >
      <button
        className="preset-card"
        draggable
        title={preset.name}
        aria-label={preset.name}
        onDragStart={(event) => {
          event.dataTransfer.setData(annotationMime, JSON.stringify(template));
          event.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => editor.addAnnotation(template)}
      >
        <span
          style={{
            color: preset.style.color,
            fontFamily: preset.style.fontFamily,
            WebkitTextStroke: `${preset.style.outlineWidth / 2}px ${preset.style.outline}`,
            paintOrder: "stroke fill",
            background: preset.style.fillEnabled
              ? preset.style.fill
              : undefined,
            borderRadius: preset.style.fillRadius,
          }}
        >
          花字
        </span>
        <small>{preset.name}</small>
        <Plus size={14} />
      </button>
    </PresetTile>
  );
}
