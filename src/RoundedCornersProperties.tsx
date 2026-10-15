import type { Clip } from "../shared/model";
import { defaultFrameCorners, frameCorners } from "../shared/media-frame";
import EffectSection from "./EffectSection";
import type { Editor } from "./useEditor";

export default function RoundedCornersProperties({
  clip,
  editor,
}: {
  clip: Clip;
  editor: Editor;
}) {
  const frame = clip.mediaFrame!;
  const corners = frame.corners ?? defaultFrameCorners;
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
          enabled: true,
          corners: { ...defaultFrameCorners },
        })
      }
      onRemove={() => editor.updateClip(clip.id, { mediaFrame: undefined })}
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
        <div className="property-slider-row">
          <span>半径</span>
          <input
            aria-label="圆角半径滑条"
            type="range"
            min={0}
            max={200}
            step={1}
            value={frame.radius}
            onChange={(event) => update({ radius: Number(event.target.value) })}
          />
          <input
            aria-label="圆角 (px)"
            type="number"
            min={0}
            max={200}
            step={1}
            value={frame.radius}
            onChange={(event) => {
              const radius = Number(event.target.value);
              if (Number.isFinite(radius) && radius >= 0 && radius <= 200)
                update({ radius });
            }}
          />
        </div>
      </fieldset>
    </EffectSection>
  );
}
