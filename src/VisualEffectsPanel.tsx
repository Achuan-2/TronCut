import { useState } from "react";
import { Gauge, RectangleHorizontal, Search, X } from "lucide-react";
import { supportsClipSpeed } from "../shared/clip-speed";
import { supportsMediaFrame } from "../shared/media-frame";
import type { Editor } from "./useEditor";

export default function VisualEffectsPanel({ editor }: { editor: Editor }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("clip-speed");
  const effects = [
    {
      id: "rounded-corners",
      name: "圆角倒角",
      icon: RectangleHorizontal,
      supports: supportsMediaFrame,
      apply: () => editor.addRoundedCorners(),
    },
    {
      id: "clip-speed",
      name: "剪辑速度",
      icon: Gauge,
      supports: supportsClipSpeed,
      apply: () => editor.addSpeedEffect(),
    },
  ];
  const selectedEffect = effects.find((effect) => effect.id === selected)!;
  const canApply = editor.project.clips.some(
    (clip) =>
      editor.selectedIds.includes(clip.id) &&
      selectedEffect.supports(clip) &&
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
            <button
              key={effect.id}
              className={`visual-effect-card ${selected === effect.id ? "selected" : ""}`}
              data-effect={effect.id}
              draggable
              title="拖到片段，或双击应用到所选片段"
              onClick={() => setSelected(effect.id)}
              onDragStart={(event) => {
                event.dataTransfer.setData("troncut-effect", effect.id);
                event.dataTransfer.effectAllowed = "copy";
              }}
              onDoubleClick={effect.apply}
            >
              <div className={`effect-card-preview ${effect.id}`}>
                <effect.icon size={40} />
              </div>
              <b>{effect.name}</b>
            </button>
          ))}
      </div>
      <button
        className="wide-button"
        disabled={!canApply}
        onClick={selectedEffect.apply}
      >
        应用到所选片段
      </button>
    </div>
  );
}
