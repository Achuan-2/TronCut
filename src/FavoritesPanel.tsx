import { useState } from "react";
import {
  animationPresets,
  visualEffectPresets,
  type PresetKind,
} from "../shared/preset-library";
import type { Editor } from "./useEditor";
import { BehaviorCard } from "./BehaviorsPanel";
import AnimationPresetCard from "./AnimationPresetCard";
import { VisualEffectCard } from "./VisualEffectsPanel";
import TextPresetCard from "./TextPresetCard";

export default function FavoritesPanel({
  editor,
  toast,
}: {
  editor: Editor;
  toast: (message: string) => void;
}) {
  const [filter, setFilter] = useState<PresetKind | "all">("all");
  const library = editor.presetLibrary;
  const textPresets = library.textPresets.filter((preset) =>
    library.isFavorite("text", preset.id),
  );
  const behaviors = library.behaviors.filter((preset) =>
    library.isFavorite("behavior", preset.id),
  );
  const animations = animationPresets.filter((preset) =>
    library.isFavorite("animation", preset.id),
  );
  const effects = visualEffectPresets.filter((preset) =>
    library.isFavorite("effect", preset.id),
  );
  const groups = [
    { kind: "text", name: "花字", count: textPresets.length },
    { kind: "behavior", name: "行为", count: behaviors.length },
    { kind: "animation", name: "动画", count: animations.length },
    { kind: "effect", name: "视觉效果", count: effects.length },
  ] as const;
  const visible = groups.filter(
    (group) => group.count && (filter === "all" || filter === group.kind),
  );
  return (
    <div className="favorites-panel">
      <label className="favorites-filter">
        类型
        <select
          aria-label="收藏类型"
          value={filter}
          onChange={(event) => setFilter(event.target.value as typeof filter)}
        >
          <option value="all">全部</option>
          <option value="text">花字</option>
          <option value="behavior">行为</option>
          <option value="animation">动画</option>
          <option value="effect">视觉效果</option>
        </select>
      </label>
      {!visible.length && (
        <p className="small-note">
          暂无收藏。点击预设卡片右上角的星标，或右键选择“收藏”。
        </p>
      )}
      {visible.map((group) => (
        <section
          key={group.kind}
          className="favorites-group"
          aria-label={`收藏的${group.name}`}
        >
          <h3>{group.name}</h3>
          <div
            className={
              group.kind === "text"
                ? "text-presets"
                : group.kind === "animation"
                  ? "animation-presets"
                  : group.kind === "effect"
                    ? "visual-effects-grid"
                    : "behavior-grid"
            }
          >
            {group.kind === "text"
              ? textPresets.map((preset) => (
                  <TextPresetCard
                    key={preset.id}
                    preset={preset}
                    editor={editor}
                  />
                ))
              : group.kind === "behavior"
                ? behaviors.map((preset) => (
                    <BehaviorCard
                      key={preset.id}
                      preset={preset}
                      editor={editor}
                    />
                  ))
                : group.kind === "animation"
                  ? animations.map((preset) => (
                      <AnimationPresetCard
                        key={preset.id}
                        preset={preset}
                        editor={editor}
                        toast={toast}
                      />
                    ))
                  : effects.map((preset) => (
                      <VisualEffectCard
                        key={preset.id}
                        preset={preset}
                        editor={editor}
                      />
                    ))}
          </div>
        </section>
      ))}
    </div>
  );
}
