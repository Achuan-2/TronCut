import type { Clip } from "../shared/model";
import {
  defaultFrameCorners,
  frameCorners,
  mediaFrameRadiusPercent,
} from "../shared/media-frame";
import EffectSection from "./EffectSection";
import { PropertySlider } from "./TransformControls";
import type { Editor } from "./useEditor";

export default function RoundedCornersProperties({
  clip,
  editor,
  size,
}: {
  clip: Clip;
  editor: Editor;
  size: { width: number; height: number };
}) {
  const frame = clip.mediaFrame!;
  const corners = frame.corners ?? defaultFrameCorners;
  const percent = Math.round(mediaFrameRadiusPercent(clip, size) * 100) / 100;
  const update = (patch: Partial<typeof frame>) =>
    editor.updateClip(clip.id, { mediaFrame: { ...frame, ...patch } });
  return (
    <EffectSection
      title="圆角倒角"
      enabled={frame.enabled !== false}
      onToggle={(enabled) => update({ enabled })}
      onReset={() =>
        update({
          radius: 20,
          unit: "percent",
          enabled: true,
          window: undefined,
          timing: undefined,
          corners: { ...defaultFrameCorners },
        })
      }
      onRemove={() => editor.removeTimelineEffect(clip.id, "rounded-corners")}
    >
      <fieldset disabled={frame.enabled === false}>
        <div className="corner-picker-row">
          <span>角</span>
          <div className="corner-picker" role="group" aria-label="圆角位置">
            {frameCorners.map((corner, index) => (
              <button
                key={corner}
                className={corner}
                aria-label={`圆角${["左上", "右上", "右下", "左下"][index]}`}
                aria-pressed={corners[corner]}
                onClick={() =>
                  update({
                    corners: { ...corners, [corner]: !corners[corner] },
                  })
                }
              />
            ))}
          </div>
        </div>
        <PropertySlider
          label="半径"
          ariaLabel="圆角 (%)"
          sliderAriaLabel="圆角半径百分比滑条"
          title="100% 为画面短边的一半"
          min={0}
          max={100}
          value={percent}
          unit="%"
          onChange={(radius) => update({ radius, unit: "percent" })}
        />
      </fieldset>
    </EffectSection>
  );
}
