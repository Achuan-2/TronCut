import { useState } from "react";
import { Check, Diamond } from "lucide-react";
import { animationPresets } from "../shared/preset-library";
import type { Editor } from "./useEditor";
import ZoomPanPanel from "./ZoomPanPanel";
import AnimationPresetCard from "./AnimationPresetCard";

const categories = [
  { id: "zoompan", name: "缩放与平移" },
  { id: "presets", name: "动画" },
] as const;
type Category = (typeof categories)[number]["id"];

export default function AnimationsPanel({
  editor,
  active,
  toast,
}: {
  editor: Editor;
  active: boolean;
  toast: (message: string) => void;
}) {
  const [category, setCategory] = useState<Category>("zoompan");
  // Remember the category while letting hidden previews release their media.
  if (!active) return null;
  return (
    <>
      <div
        className="animation-panel-tabs"
        role="tablist"
        aria-label="动画分类"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? 1
                : category === "zoompan"
                  ? 1
                  : 0;
          setCategory(categories[index].id);
          event.currentTarget
            .querySelectorAll<HTMLButtonElement>("button")
            [index]?.focus();
        }}
      >
        {categories.map(({ id, name }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`animation-category-${id}`}
            aria-controls={`animation-panel-${id}`}
            aria-selected={category === id}
            tabIndex={category === id ? 0 : -1}
            onClick={() => setCategory(id)}
          >
            {name}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`animation-panel-${category}`}
        aria-labelledby={`animation-category-${category}`}
      >
        {category === "zoompan" ? (
          <ZoomPanPanel editor={editor} />
        ) : (
          <>
            <p className="panel-intro">
              选中片段，点击即添加。
              <br />
              也可以在时间线上右键添加动画。
            </p>
            <div className="animation-presets">
              {animationPresets.map((preset) => (
                <AnimationPresetCard
                  key={preset.id}
                  preset={preset}
                  editor={editor}
                  toast={toast}
                />
              ))}
            </div>
            <div className="tip-card">
              <Diamond size={19} />
              <b>开启自动动画</b>
              <p>
                移动播放头，再修改右侧属性。TronCut
                会自动记录位置、缩放和不透明度，无需拖拽动画箭头。
              </p>
              <button
                onClick={() => editor.setAutoAnimate(!editor.autoAnimate)}
              >
                {editor.autoAnimate ? "已开启" : "开启自动动画"}
                {editor.autoAnimate && <Check size={14} />}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
