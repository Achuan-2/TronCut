import { animation } from "../shared/editor";
import { animationPresets } from "../shared/preset-library";
import type { Editor } from "./useEditor";
import PresetTile from "./PresetTile";

export default function AnimationPresetCard({
  preset,
  editor,
  toast,
}: {
  preset: (typeof animationPresets)[number];
  editor: Editor;
  toast: (message: string) => void;
}) {
  return (
    <PresetTile
      kind="animation"
      id={preset.id}
      name={preset.name}
      library={editor.presetLibrary}
    >
      <button
        className="animation-card"
        onClick={() => {
          if (!editor.selected) {
            toast("请先选中片段");
            return;
          }
          editor.updateClip(editor.selected.id, (clip) =>
            animation(
              clip,
              preset.id,
              editor.playhead - clip.start,
              editor.preferences.timing.animation,
            ),
          );
        }}
      >
        <div className={`animation-demo ${preset.id}`}>
          <span />
        </div>
        <span>{preset.name}</span>
        <small>{editor.preferences.timing.animation} 秒 · 平滑曲线</small>
      </button>
    </PresetTile>
  );
}
