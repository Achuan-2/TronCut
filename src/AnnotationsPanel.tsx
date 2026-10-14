import { useState } from "react";
import { Type, Shapes, ArrowUpRight, Plus } from "lucide-react";
import { textPresets } from "../shared/model";
import { annotationMime, type AnnotationTemplate } from "../shared/annotations";
import type { Editor } from "./useEditor";

export default function AnnotationsPanel({ editor }: { editor: Editor }) {
  const [category, setCategory] = useState<"text" | "shapes" | "arrows">(
    "text",
  );
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
      ) : (
        <div className="shape-presets">
          {(category === "arrows"
            ? (["arrow"] as const)
            : (["rectangle", "ellipse"] as const)
          ).map((shape) => (
            <button
              key={shape}
              draggable
              onDragStart={(event) => drag(event, { kind: "shape", shape })}
              onClick={() => editor.addAnnotation({ kind: "shape", shape })}
            >
              <svg
                width="100"
                height="54"
                viewBox="0 0 120 60"
                fill="currentColor"
              >
                {shape === "rectangle" ? (
                  <rect x="15" y="9" width="90" height="42" rx="7" />
                ) : shape === "ellipse" ? (
                  <ellipse cx="60" cy="30" rx="42" ry="22" />
                ) : (
                  <path d="M10 22H76V8L110 30L76 52V38H10Z" />
                )}
              </svg>
              <span>
                {
                  { rectangle: "圆角矩形", ellipse: "椭圆", arrow: "箭头" }[
                    shape
                  ]
                }
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
