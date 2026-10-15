import EffectSection from "./EffectSection";
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
    <EffectSection title="剪辑速度" onReset={() => editor.changeClipSpeed(clip.id, 1)} onRemove={() => editor.removeSpeedEffect(clip.id)}>
      <label className="field">
        速度
        <div className="speed-number">
          <input
            aria-label="剪辑速度（倍）"
            type="number"
            min={speedLimits.min}
            max={speedLimits.max}
            step="0.01"
            value={Number(clip.speed.toFixed(2))}
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
    </EffectSection>
  );
}
