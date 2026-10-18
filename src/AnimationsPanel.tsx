import { useState } from "react";
import { animationPresets } from "../shared/preset-library";
import type { Editor } from "./useEditor";
import ZoomPanPanel from "./ZoomPanPanel";
import AnimationPresetCard from "./AnimationPresetCard";

const categories = [
  { id: "zoompan", name: "缩放与平移" },
  { id: "presets", name: "动画" },
] as const;
type Category = (typeof categories)[number]["id"];
const autoAnimateHelp =
  "移动播放头后修改右侧属性，会自动记录位置、缩放和不透明度，无需拖拽动画箭头。";

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
      <div className="animation-auto-control">
        <label title={autoAnimateHelp}>
          <input
            type="checkbox"
            aria-label="开启自动动画"
            title={autoAnimateHelp}
            checked={editor.autoAnimate}
            onChange={(event) => editor.setAutoAnimate(event.target.checked)}
          />
          <span>开启自动动画</span>
        </label>
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
              点击为所选片段添加动画，或拖到时间轴片段的指定位置、画布对象。
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
          </>
        )}
      </div>
    </>
  );
}
