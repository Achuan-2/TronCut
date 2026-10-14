import { RotateCcw, X } from "lucide-react";
import type { Clip } from "../shared/model";
import { durationParts, speedLimits } from "../shared/clip-speed";
import type { Editor } from "./useEditor";

export default function SpeedProperties({
  clip,
  editor,
}: {
  clip: Clip;
  editor: Editor;
}) {
  const fps = editor.project.canvas.fps;
  const parts = durationParts(clip.duration, fps);
  return (
    <section className="speed-properties" aria-label="剪辑速度属性">
      <div className="speed-heading">
        <h3>剪辑速度</h3>
        <button
          type="button"
          title="恢复正常速度"
          aria-label="恢复正常速度"
          onClick={() => editor.changeClipSpeed(clip.id, 1)}
        >
          <RotateCcw size={14} />
        </button>
        <button
          type="button"
          title="移除剪辑速度"
          aria-label="移除剪辑速度"
          onClick={() => editor.removeSpeedEffect(clip.id)}
        >
          <X size={15} />
        </button>
      </div>
      <label className="field">
        速度
        <div className="speed-number">
          <input
            aria-label="剪辑速度（倍）"
            type="number"
            min={speedLimits.min}
            max={speedLimits.max}
            step="0.01"
            value={Number(clip.speed.toFixed(4))}
            onChange={(event) =>
              editor.changeClipSpeed(clip.id, Number(event.target.value))
            }
          />
          <span>×</span>
        </div>
      </label>
      <div className="speed-duration">
        <span>持续时间</span>
        <div>
          {(["minutes", "seconds", "frames"] as const).map((key, i) => (
            <label key={key}>
              {["分钟", "秒", "帧"][i]}
              <input
                type="number"
                aria-label={`剪辑持续时间（${["分钟", "秒", "帧"][i]}）`}
                min={0}
                max={
                  key === "minutes" ? 1440 : key === "seconds" ? 59 : fps - 1
                }
                step={1}
                value={parts[key]}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isInteger(value) || value < 0) return;
                  const next = { ...parts, [key]: value };
                  editor.changeSpeedDuration(
                    clip.id,
                    next.minutes * 60 + next.seconds + next.frames / fps,
                  );
                }}
              />
            </label>
          ))}
        </div>
      </div>
      <p className="small-note">音视频同步变速，保留原始音调。</p>
    </section>
  );
}
