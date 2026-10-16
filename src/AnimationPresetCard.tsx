import { animationMime, customAnimationId } from "../shared/animation-drag";
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
        aria-label={preset.name}
        draggable
        data-animation={preset.id}
        title="点击应用到所选片段，或拖到时间轴片段的指定位置、画布对象"
        onDragStart={(event) => {
          event.dataTransfer.setData(animationMime, customAnimationId);
          event.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => {
          if (!editor.addSelectedAnimation()) {
            toast("请选中可编辑的画面对象，并将播放头放在片段内");
            return;
          }
        }}
      >
        <div className={`animation-demo ${preset.id}`}>
          <span />
        </div>
        <span>{preset.name}</span>
        <small>
          {editor.preferences.timing.animation} 秒 · 编辑动画终点属性
        </small>
      </button>
    </PresetTile>
  );
}
