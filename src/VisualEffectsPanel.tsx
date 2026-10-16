import { useState } from "react";
import {
  Gauge,
  RectangleHorizontal,
  Search,
  X,
  Blend,
  Scan,
  Layers,
  Pipette,
  PaintBucket,
  ScanLine,
  Square,
} from "lucide-react";
import type { Editor } from "./useEditor";
import { visualEffectPresets } from "../shared/preset-library";
import {
  visualEffectDragType,
  visualEffectMime,
  supportsVisualEffect,
} from "../shared/visual-effect-drag";
import PresetTile from "./PresetTile";

export function VisualEffectCard({
  preset,
  editor,
  selected,
  onSelect,
}: {
  preset: (typeof visualEffectPresets)[number];
  editor: Editor;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const icons = {
    "clip-speed": Gauge,
    "rounded-corners": RectangleHorizontal,
    "media-matte": Layers,
    mask: Scan,
    shadow: Blend,
    "remove-color": Pipette,
    tint: PaintBucket,
    "blur-region": ScanLine,
    border: Square,
  };
  const Icon = icons[preset.id];
  return (
    <PresetTile
      kind="effect"
      id={preset.id}
      name={preset.name}
      library={editor.presetLibrary}
    >
      <button
        className={`visual-effect-card ${selected ? "selected" : ""}`}
        data-effect={preset.id}
        draggable
        title="拖到画布对象或时间轴片段，或双击应用到所选片段"
        onClick={onSelect}
        onDragStart={(event) => {
          event.dataTransfer.setData(visualEffectMime, preset.id);
          event.dataTransfer.setData(
            visualEffectDragType(preset.id),
            preset.id,
          );
          event.dataTransfer.effectAllowed = "copy";
        }}
        onDoubleClick={() => editor.addVisualEffect(preset.id)}
      >
        <div className={`effect-card-preview ${preset.id}`}>
          <Icon size={40} />
        </div>
        <b>{preset.name}</b>
      </button>
    </PresetTile>
  );
}

export default function VisualEffectsPanel({ editor }: { editor: Editor }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("clip-speed");
  const effects = visualEffectPresets;
  const selectedEffect = effects.find((effect) => effect.id === selected)!;
  const canApply = editor.project.clips.some(
    (clip) =>
      editor.selectedIds.includes(clip.id) &&
      supportsVisualEffect(clip, selectedEffect.id) &&
      !editor.project.tracks.find((track) => track.id === clip.trackId)?.locked,
  );
  return (
    <div className="visual-effects-panel">
      <div className="media-search effect-search">
        <Search size={15} />
        <input
          aria-label="搜索视觉效果"
          placeholder="搜索视觉效果…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button aria-label="清除视觉效果搜索" onClick={() => setQuery("")}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="visual-effects-grid">
        {effects
          .filter((effect) => effect.name.includes(query.trim()))
          .map((effect) => (
            <VisualEffectCard
              key={effect.id}
              preset={effect}
              editor={editor}
              selected={selected === effect.id}
              onSelect={() => setSelected(effect.id)}
            />
          ))}
      </div>
      <button
        className="wide-button"
        disabled={!canApply}
        onClick={() => editor.addVisualEffect(selectedEffect.id)}
      >
        应用到所选片段
      </button>
    </div>
  );
}
