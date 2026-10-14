import { Gauge } from "lucide-react";
import { supportsClipSpeed } from "../shared/clip-speed";
import type { Editor } from "./useEditor";

export default function VisualEffectsPanel({ editor }: { editor: Editor }) {
  const canApply = editor.project.clips.some(
    (clip) =>
      editor.selectedIds.includes(clip.id) &&
      supportsClipSpeed(clip) &&
      !editor.project.tracks.find((track) => track.id === clip.trackId)?.locked,
  );
  return (
    <div className="visual-effects-panel">
      <p className="panel-intro">将效果拖到时间线中的视频或音频上。</p>
      <button
        className="visual-effect-card"
        draggable
        title="拖到片段，或双击应用到所选片段"
        onDragStart={(event) => {
          event.dataTransfer.setData("troncut-effect", "clip-speed");
          event.dataTransfer.effectAllowed = "copy";
        }}
        onDoubleClick={() => editor.addSpeedEffect()}
      >
        <Gauge size={52} />
        <b>剪辑速度</b>
        <span>加速 · 慢放</span>
      </button>
      <button
        className="wide-button"
        disabled={!canApply}
        onClick={() => editor.addSpeedEffect()}
      >
        <Gauge size={16} />
        应用到所选片段
      </button>
      <p className="small-note">
        展开片段下方的效果条，拖动末端调整速度。属性面板可输入倍速或持续时间。
      </p>
    </div>
  );
}
