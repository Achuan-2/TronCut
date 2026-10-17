import { useState } from "react";
import {
  Type,
  Shapes,
  ArrowUpRight,
  Plus,
  Droplets,
  Pencil,
  PenTool,
} from "lucide-react";
import { textPresets } from "../shared/model";
import {
  annotationMime,
  arrowPresets,
  shapePresets,
  sketchPresets,
  annotationEffectPresets,
  type AnnotationTemplate,
} from "../shared/annotations";
import AnnotationPresetPreview from "./AnnotationPresetPreview";
import PenBrushPicker, { penColors } from "./PenBrushPicker";
import type { Editor } from "./useEditor";

export default function AnnotationsPanel({ editor }: { editor: Editor }) {
  const [category, setCategory] = useState<
    "text" | "shapes" | "arrows" | "effects" | "sketch" | "pen"
  >("text");
  const [style, setStyle] = useState("all");
  const drag = (event: React.DragEvent, template: AnnotationTemplate) => {
    event.dataTransfer.setData(annotationMime, JSON.stringify(template));
    event.dataTransfer.effectAllowed = "copy";
  };
  return (
    <div className="annotations-panel">
      <div
        className="annotation-categories"
        role="tablist"
        aria-label="标注分类"
      >
        {[
          { id: "text", label: "文本", name: "文字标注", icon: Type },
          { id: "shapes", label: "形状", name: "形状标注", icon: Shapes },
          { id: "arrows", label: "箭头", name: "箭头标注", icon: ArrowUpRight },
          {
            id: "effects",
            label: "模糊和高亮",
            name: "模糊和高亮",
            icon: Droplets,
          },
          { id: "sketch", label: "草图运动", name: "草图运动", icon: Pencil },
          { id: "pen", label: "涂鸦笔", name: "涂鸦笔", icon: PenTool },
        ].map(({ id, label, name, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-label={name}
            aria-selected={category === id}
            onClick={() => setCategory(id as typeof category)}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <p className="panel-intro">拖到画布或时间线添加，也可点击模板。</p>
      {category === "text" ? (
        <>
          <label className="field">
            样式
            <select
              aria-label="标注文本样式"
              value={style}
              onChange={(event) => setStyle(event.target.value)}
            >
              <option value="all">全部</option>
              <option value="basic">基本</option>
              <option value="fancy">花字</option>
            </select>
          </label>
          <div className="text-presets">
            {style !== "fancy" && (
              <button
                className="preset-card"
                title="纯文本"
                aria-label="纯文本"
                draggable
                onDragStart={(event) =>
                  drag(event, { kind: "text", preset: 0, plain: true })
                }
                onClick={() =>
                  editor.addAnnotation({ kind: "text", preset: 0, plain: true })
                }
              >
                <span>ABC</span>
                <small>纯文本</small>
                <Plus size={14} />
              </button>
            )}
            {style !== "basic" &&
              textPresets.map((preset, i) => (
                <button
                  key={preset.name}
                  className="preset-card"
                  draggable
                  onDragStart={(event) =>
                    drag(event, { kind: "text", preset: i })
                  }
                  onClick={() =>
                    editor.addAnnotation({ kind: "text", preset: i })
                  }
                >
                  <span
                    style={{
                      color: preset.style.color,
                      WebkitTextStroke: `${preset.style.outlineWidth / 2}px ${preset.style.outline}`,
                      paintOrder: "stroke fill",
                    }}
                  >
                    花字
                  </span>
                  <small>{preset.name}</small>
                  <Plus size={14} />
                </button>
              ))}
          </div>
          <p className="small-note">
            双击画布文字编辑，字体、描边和自动字号在文本属性中调整。
          </p>
        </>
      ) : category === "pen" ? (
        <div className="annotation-pen-settings">
          <p className="small-note">
            可连续绘制多笔，切换笔刷和颜色，点击“完成绘制”保存为一个可编辑对象。
          </p>
          <PenBrushPicker
            value={editor.penSettings.brush}
            color={editor.penSettings.color}
            onChange={(brush) =>
              editor.setPenSettings({ ...editor.penSettings, brush })
            }
          />
          <div
            className="pen-color-palette"
            role="group"
            aria-label="涂鸦笔常用颜色"
          >
            {penColors.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`笔色 ${color}`}
                aria-pressed={editor.penSettings.color === color}
                style={{ backgroundColor: color }}
                onClick={() =>
                  editor.setPenSettings({ ...editor.penSettings, color })
                }
              />
            ))}
          </div>
          <label className="field">
            颜色
            <input
              type="color"
              aria-label="涂鸦笔颜色"
              value={editor.penSettings.color}
              onChange={(event) =>
                editor.setPenSettings({
                  ...editor.penSettings,
                  color: event.target.value,
                })
              }
            />
          </label>
          <label className="field">
            笔宽
            <input
              type="number"
              aria-label="涂鸦笔笔宽"
              min={1}
              max={100}
              value={editor.penSettings.width}
              onChange={(event) =>
                editor.setPenSettings({
                  ...editor.penSettings,
                  width: Math.max(
                    1,
                    Math.min(100, Number(event.target.value) || 1),
                  ),
                })
              }
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={editor.penSettings.animate}
              onChange={(event) =>
                editor.setPenSettings({
                  ...editor.penSettings,
                  animate: event.target.checked,
                })
              }
            />
            播放绘制过程
          </label>
          <label className="field">
            绘制时长（秒）
            <input
              type="number"
              aria-label="涂鸦笔绘制时长"
              min={0.1}
              max={60}
              step={0.1}
              value={editor.penSettings.duration}
              onChange={(event) =>
                editor.setPenSettings({
                  ...editor.penSettings,
                  duration: Math.max(
                    0.1,
                    Math.min(60, Number(event.target.value) || 1),
                  ),
                })
              }
            />
          </label>
          <button
            className="wide-button"
            aria-pressed={editor.canvasMode === "draw"}
            onClick={() => {
              editor.setPlaying(false);
              if (editor.editingTextId)
                editor.endTextEdit(editor.editingTextId);
              if (editor.canvasMode === "draw") editor.finishDrawing();
              else editor.setCanvasMode("draw");
            }}
          >
            {editor.canvasMode === "draw" ? "完成绘制" : "启用涂鸦笔"}
          </button>
          {editor.canvasMode === "draw" && (
            <button
              className="wide-button"
              onClick={() => editor.setCanvasMode("select")}
            >
              取消绘制
            </button>
          )}
        </div>
      ) : (
        <div className="shape-presets">
          {(category === "arrows"
            ? arrowPresets
            : category === "shapes"
              ? shapePresets
              : category === "sketch"
                ? sketchPresets
                : annotationEffectPresets
          ).map((preset) => (
            <button
              key={preset.id}
              aria-label={preset.name}
              title={preset.name}
              data-annotation={preset.id}
              draggable
              onDragStart={(event) => drag(event, preset.template)}
              onClick={() => editor.addAnnotation(preset.template)}
            >
              <AnnotationPresetPreview template={preset.template} />
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
