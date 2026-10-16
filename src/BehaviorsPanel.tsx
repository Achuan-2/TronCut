import { useEffect, useState } from "react";
import {
  glyphMotion,
  behaviorFromPreset,
  supportsBehaviors,
  type BehaviorPreset,
} from "../shared/behaviors";
import type { Editor } from "./useEditor";
import PresetTile from "./PresetTile";

export function BehaviorCard({
  preset,
  editor,
}: {
  preset: BehaviorPreset;
  editor: Editor;
}) {
  const [time, setTime] = useState<number | null>(null);
  useEffect(() => {
    if (time === null) return;
    const start = performance.now();
    let frame = 0;
    const tick = () => {
      setTime(((performance.now() - start) / 1000) % 3);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [time === null]);
  const behavior = { ...behaviorFromPreset(preset, 2.6), id: preset.id };
  const objectMotion = glyphMotion(
    { behaviors: [behavior] },
    time ?? 1.1,
    0,
    7,
    "object",
  );
  return (
    <PresetTile
      kind="behavior"
      id={preset.id}
      name={preset.name}
      custom={preset.id.startsWith("user-")}
      library={editor.presetLibrary}
    >
      <button
        className="behavior-card"
        draggable
        title="拖到文字、图片或视频片段，或双击应用"
        onMouseEnter={() => setTime(0)}
        onMouseLeave={() => setTime(null)}
        onFocus={() => setTime(0)}
        onBlur={() => setTime(null)}
        onDragStart={(event) => {
          event.dataTransfer.setData("troncut-behavior", preset.id);
          event.dataTransfer.effectAllowed = "copy";
        }}
        onDoubleClick={() => editor.addBehavior(preset.id)}
      >
        <span className="behavior-card-preview" aria-hidden="true">
          <span
            className="behavior-card-word"
            style={{
              opacity: objectMotion.opacity,
              transform: `translate(${objectMotion.x}em, ${objectMotion.y}em) rotateZ(${objectMotion.rotation}deg) rotateY(${objectMotion.rotationY}deg) rotateX(${objectMotion.rotationX}deg) scale(${objectMotion.scale})`,
            }}
          >
            {Array.from("TronCut").map((text, index) => {
              const motion = glyphMotion(
                { behaviors: [behavior] },
                time ?? 1.1,
                index,
                7,
                "text",
              );
              return (
                <span
                  key={index}
                  style={{
                    opacity: motion.opacity,
                    transform: `translate(${motion.x}em, ${motion.y}em) rotateZ(${motion.rotation}deg) rotateY(${motion.rotationY}deg) rotateX(${motion.rotationX}deg) scale(${motion.scale})`,
                  }}
                >
                  {text}
                </span>
              );
            })}
          </span>
        </span>
        <b>{preset.name}</b>
      </button>
    </PresetTile>
  );
}
export default function BehaviorsPanel({ editor }: { editor: Editor }) {
  const canApply = editor.project.clips.some(
    (clip) =>
      editor.selectedIds.includes(clip.id) &&
      supportsBehaviors(clip) &&
      !editor.project.tracks.find((track) => track.id === clip.trackId)?.locked,
  );
  return (
    <div className="behaviors-panel">
      <p className="panel-intro">
        拖到文字、图片或视频片段，或双击应用到所选片段。悬停预览动效。
      </p>
      <div className="behavior-grid">
        {editor.presetLibrary.behaviors.map((preset) => (
          <BehaviorCard key={preset.id} preset={preset} editor={editor} />
        ))}
      </div>
      {!canApply && <p className="small-note">选择片段后可双击添加行为。</p>}
    </div>
  );
}
