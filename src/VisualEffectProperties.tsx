import type { Clip } from "../shared/model";
import {
  additionalVisualEffectPresets,
  defaultVisualEffect,
  type AdditionalVisualEffectId,
  type VisualEffects,
} from "../shared/visual-effects";
import EffectSection from "./EffectSection";
import type { Editor } from "./useEditor";
import { PropertySlider } from "./TransformControls";
import {
  maskFields,
  clearMaskChannels,
  type MaskGeometry,
} from "../shared/mask-state";

type Field = {
  key: string;
  label: string;
  type?: "color" | "check";
  min?: number;
  max?: number;
  step?: number;
  scale?: number;
  options?: [string, string][];
};
const percent = (key: string, label: string, min = 0, max = 100): Field => ({
  key,
  label,
  min,
  max,
  scale: 100,
});
const shapes: Field[] = [
  {
    key: "shape",
    label: "形状",
    options: [
      ["ellipse", "椭圆"],
      ["rectangle", "矩形"],
    ],
  },
  { key: "invert", label: "颠倒", type: "check" },
  { key: "rotation", label: "旋转 (°)", min: -3600, max: 3600 },
  percent("x", "中心 X (%)", -100, 200),
  percent("y", "中心 Y (%)", -100, 200),
  percent("width", "区域宽度 (%)", 1, 300),
  percent("height", "区域高度 (%)", 1, 300),
  { key: "radius", label: "角", min: 0, max: 500 },
  { key: "feather", label: "羽化", min: -100, max: 100 },
];
const fields: Record<AdditionalVisualEffectId, Field[]> = {
  "media-matte": [
    {
      key: "mode",
      label: "模式",
      options: [
        ["alpha", "透明度"],
        ["alpha-invert", "透明度反转"],
        ["luma", "亮度"],
        ["luma-invert", "亮度反转"],
      ],
    },
    percent("strength", "强度 (%)"),
  ],
  mask: [
    ...shapes.map((field) =>
      field.key === "feather" ? { ...field, label: "混合" } : field,
    ),
    percent("opacity", "遮挡区域不透明度 (%)"),
  ],
  shadow: [
    { key: "angle", label: "角度 (°)", min: -3600, max: 3600 },
    { key: "color", label: "颜色", type: "color" },
    { key: "offset", label: "偏移", min: 0, max: 500 },
    percent("opacity", "不透明度 (%)"),
    { key: "blur", label: "模糊", min: 0, max: 200 },
  ],
  "remove-color": [
    { key: "color", label: "颜色", type: "color" },
    percent("tolerance", "容差 (%)"),
    percent("softness", "柔和度 (%)"),
    percent("spill", "色彩抑制 (%)"),
    percent("defringe", "去边 (%)", -100, 100),
    { key: "invert", label: "颠倒", type: "check" },
  ],
  tint: [
    { key: "color", label: "颜色", type: "color" },
    percent("strength", "强度 (%)"),
    {
      key: "range",
      label: "范围",
      options: [
        ["all", "全部灰色"],
        ["shadows", "阴影"],
        ["midtones", "中间调"],
        ["highlights", "高光"],
      ],
    },
  ],
  "blur-region": [
    { key: "blur", label: "模糊", min: 0, max: 200 },
    { key: "color", label: "色调", type: "color" },
    percent("opacity", "色调不透明度 (%)"),
    ...shapes,
  ],
  border: [
    { key: "color", label: "颜色", type: "color" },
    { key: "width", label: "粗细", min: 0, max: 100 },
    { key: "useAlpha", label: "使用透明度", type: "check" },
  ],
};

export default function VisualEffectProperties({
  clip,
  editor,
  sampledClip = clip,
}: {
  clip: Clip;
  editor: Editor;
  sampledClip?: Clip;
}) {
  return additionalVisualEffectPresets.map(({ id, name }) => {
    const settings = clip.visualEffects?.[id];
    if (!settings) return null;
    const values = (sampledClip.visualEffects?.[id] ??
      settings) as unknown as Record<string, number | boolean | string>;
    const update = (patch: Record<string, unknown>) => {
      if (
        id === "mask" &&
        Object.keys(patch).every((key) => Object.hasOwn(maskFields, key))
      ) {
        editor.updateMask(clip.id, patch as Partial<MaskGeometry>);
        return;
      }
      editor.updateClip(clip.id, {
        visualEffects: {
          ...clip.visualEffects,
          [id]: { ...settings, ...patch },
        } as VisualEffects,
      });
    };
    return (
      <EffectSection
        key={`${clip.id}-${id}`}
        title={name}
        enabled={settings.enabled}
        onToggle={(enabled) => update({ enabled })}
        onReset={() =>
          editor.updateClip(clip.id, (source) => ({
            ...(id === "mask" ? clearMaskChannels(source) : source),
            visualEffects: {
              ...source.visualEffects,
              [id]: defaultVisualEffect(id),
            },
          }))
        }
        onRemove={() => {
          const next = { ...clip.visualEffects };
          delete next[id];
          editor.updateClip(clip.id, (source) => ({
            ...(id === "mask" ? clearMaskChannels(source) : source),
            visualEffects: next,
          }));
        }}
      >
        <fieldset disabled={!settings.enabled}>
          {id === "mask" && (
            <p className="field-help">
              拖动画布上的遮罩边框或八个控制点调整区域。开启自动动画后修改位置、大小，或选择时间轴动画的起点、终点编辑，可制作滑动显示效果。
            </p>
          )}
          {id === "media-matte" && (
            <p className="field-help">
              以本对象的透明度或亮度控制所有下方轨道；本对象作为哑光源。
            </p>
          )}
          {id === "shadow" && (
            <div
              className="shadow-directions"
              role="group"
              aria-label="阴影方向"
            >
              {[135, 90, 45, 180, null, 0, 225, 270, 315].map(
                (angle, index) => (
                  <button
                    key={index}
                    aria-label={`阴影方向：${["左上", "上", "右上", "左", "居中", "右", "左下", "下", "右下"][index]}`}
                    aria-pressed={
                      angle === null
                        ? values.offset === 0
                        : values.offset !== 0 &&
                          ((Number(values.angle) % 360) + 360) % 360 === angle
                    }
                    onClick={() =>
                      update(
                        angle === null
                          ? { offset: 0 }
                          : { angle, offset: Number(values.offset) || 10 },
                      )
                    }
                  />
                ),
              )}
            </div>
          )}
          {[
            ...fields[id],
            {
              key: "easeIn",
              label: "缓入 (秒)",
              min: 0,
              max: clip.duration,
              step: 0.01,
            },
            {
              key: "easeOut",
              label: "缓出 (秒)",
              min: 0,
              max: clip.duration,
              step: 0.01,
            },
          ].map((field) => {
            const value = values[field.key];
            const label = `${name}${field.label}`;
            if (
              typeof value === "number" &&
              !["x", "y", "angle", "rotation", "easeIn", "easeOut"].includes(
                field.key,
              )
            ) {
              return (
                <PropertySlider
                  key={field.key}
                  label={field.label}
                  ariaLabel={label}
                  value={value * (field.scale ?? 1)}
                  min={field.min ?? 0}
                  max={field.max ?? 100}
                  step={field.step ?? 1}
                  onChange={(value) =>
                    update({ [field.key]: value / (field.scale ?? 1) })
                  }
                />
              );
            }
            return (
              <label
                className={field.type === "check" ? "check-field" : "field"}
                key={field.key}
              >
                {field.type !== "check" && field.label}
                {field.options ? (
                  <select
                    aria-label={label}
                    value={String(value)}
                    onChange={(e) => update({ [field.key]: e.target.value })}
                  >
                    {field.options.map(([value, text]) => (
                      <option key={value} value={value}>
                        {text}
                      </option>
                    ))}
                  </select>
                ) : field.type === "check" ? (
                  <input
                    aria-label={label}
                    type="checkbox"
                    checked={!!value}
                    onChange={(e) => update({ [field.key]: e.target.checked })}
                  />
                ) : field.type === "color" ? (
                  <input
                    aria-label={label}
                    type="color"
                    value={String(value)}
                    onChange={(e) => update({ [field.key]: e.target.value })}
                  />
                ) : (
                  <input
                    aria-label={label}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 1}
                    value={
                      Math.round(Number(value) * (field.scale ?? 1) * 1000) /
                      1000
                    }
                    onChange={(e) => {
                      if (!e.target.value.trim()) return;
                      const next = Number(e.target.value);
                      if (
                        Number.isFinite(next) &&
                        next >= (field.min ?? -Infinity) &&
                        next <= (field.max ?? Infinity)
                      )
                        update({ [field.key]: next / (field.scale ?? 1) });
                    }}
                  />
                )}
                {field.type === "check" && field.label}
              </label>
            );
          })}
        </fieldset>
      </EffectSection>
    );
  });
}
