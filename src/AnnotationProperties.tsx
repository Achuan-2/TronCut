import type { Clip } from "../shared/model";
import { shapeStyleSchema, type ShapeStyle } from "../shared/annotation-style";
import type { Editor } from "./useEditor";
import NumberInput from "./NumberInput";
import PenBrushPicker from "./PenBrushPicker";

export default function AnnotationProperties({
  clip,
  editor,
}: {
  clip: Clip;
  editor: Editor;
}) {
  const style = shapeStyleSchema.parse(clip.shapeStyle ?? {});
  const change = (patch: Partial<Clip>) => editor.updateClip(clip.id, patch);
  const styleChange = (patch: Partial<ShapeStyle>) =>
    change({
      shapeStyle: { ...style, ...patch },
      ...(clip.drawing?.strokes
        ? {
            drawing: {
              ...clip.drawing,
              strokes: clip.drawing.strokes.map((stroke) => ({
                ...stroke,
                style: { ...(stroke.style ?? style), ...patch },
              })),
            },
          }
        : {}),
    });
  const effect = clip.annotationEffect;
  const drawing = clip.drawing;
  return (
    <section className="annotation-properties" aria-label="标注属性">
      {effect ? (
        <>
          <h3 className="section-title">
            {
              {
                blur: "模糊",
                spotlight: "聚光灯",
                highlight: "突出显示",
                pixelate: "像素化",
              }[effect.type]
            }
          </h3>
          <label className="field">
            区域形状
            <select
              aria-label="标注区域形状"
              value={clip.shape === "ellipse" ? "ellipse" : "rectangle"}
              onChange={(event) =>
                change({ shape: event.target.value as "ellipse" | "rectangle" })
              }
            >
              <option value="rectangle">矩形</option>
              <option value="ellipse">椭圆</option>
            </select>
          </label>
          {(effect.type === "blur" || effect.type === "pixelate") && (
            <label className="field">
              {effect.type === "blur" ? "模糊强度" : "像素大小"}
              <NumberInput
                aria-label={
                  effect.type === "blur" ? "标注模糊强度" : "标注像素大小"
                }
                value={effect.amount}
                min={1}
                max={200}
                onValueChange={(amount) =>
                  change({ annotationEffect: { ...effect, amount } })
                }
              />
            </label>
          )}
          {(effect.type === "spotlight" || effect.type === "highlight") && (
            <label className="field">
              {effect.type === "spotlight" ? "背景暗度" : "高亮不透明度"}
              <NumberInput
                aria-label="标注效果不透明度"
                value={Math.round(effect.opacity * 100)}
                min={0}
                max={100}
                onValueChange={(opacity) =>
                  change({
                    annotationEffect: { ...effect, opacity: opacity / 100 },
                  })
                }
              />
            </label>
          )}
          {effect.type === "highlight" && (
            <label className="field">
              高亮颜色
              <input
                type="color"
                aria-label="高亮颜色"
                value={effect.color}
                onChange={(event) =>
                  change({
                    annotationEffect: { ...effect, color: event.target.value },
                  })
                }
              />
            </label>
          )}
        </>
      ) : (
        <>
          <h3 className="section-title">标注外观</h3>
          {drawing && (
            <PenBrushPicker
              value={style.brush ?? "round"}
              color={style.stroke}
              onChange={(brush) => styleChange({ brush })}
            />
          )}
          <label className="field">
            填充
            <input
              type="color"
              aria-label="标注填充颜色"
              value={clip.fill ?? "#00b5ef"}
              disabled={!style.fillEnabled}
              onChange={(event) => change({ fill: event.target.value })}
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={style.fillEnabled}
              onChange={(event) =>
                styleChange({ fillEnabled: event.target.checked })
              }
            />
            启用填充
          </label>
          <label className="field">
            描边颜色
            <input
              type="color"
              aria-label="标注描边颜色"
              value={style.stroke}
              onChange={(event) => styleChange({ stroke: event.target.value })}
            />
          </label>
          <label className="field">
            笔宽
            <NumberInput
              aria-label="标注笔宽"
              value={style.strokeWidth}
              min={0}
              max={100}
              onValueChange={(strokeWidth) => styleChange({ strokeWidth })}
            />
          </label>
          <label className="field">
            线型
            <select
              aria-label="标注线型"
              value={style.lineStyle}
              onChange={(event) =>
                styleChange({
                  lineStyle: event.target.value as ShapeStyle["lineStyle"],
                })
              }
            >
              <option value="solid">实线</option>
              <option value="dashed">虚线</option>
              <option value="dotted">点线</option>
            </select>
          </label>
          {clip.shape === "line" &&
            (["startHead", "endHead"] as const).map((key) => (
              <label className="field" key={key}>
                {key === "startHead" ? "起点" : "终点"}
                <select
                  aria-label={`标注${key === "startHead" ? "起点" : "终点"}样式`}
                  value={style[key]}
                  onChange={(event) =>
                    styleChange({ [key]: event.target.value })
                  }
                >
                  <option value="none">无</option>
                  <option value="arrow">箭头</option>
                  <option value="dot">圆点</option>
                </select>
              </label>
            ))}
        </>
      )}
      {drawing && (
        <>
          <h3 className="section-title">绘制动画</h3>
          <label className="check-field">
            <input
              type="checkbox"
              checked={drawing.enabled}
              onChange={(event) =>
                change({
                  drawing: {
                    ...drawing,
                    enabled: event.target.checked,
                    frozenProgress: undefined,
                  },
                })
              }
            />
            播放绘制过程
          </label>
          <label className="field">
            绘制时长（秒）
            <NumberInput
              aria-label="绘制动画时长"
              min={0.01}
              max={86400}
              step={0.1}
              value={drawing.duration}
              onValueChange={(duration) =>
                change({ drawing: { ...drawing, duration } })
              }
            />
          </label>
          <label className="field">
            延迟（秒）
            <NumberInput
              aria-label="绘制动画延迟"
              min={0}
              max={86400}
              step={0.1}
              value={drawing.delay}
              onValueChange={(delay) =>
                change({ drawing: { ...drawing, delay } })
              }
            />
          </label>
          <button
            className="wide-button"
            onClick={() => {
              editor.seek(clip.start);
              editor.setPlaying(true);
            }}
          >
            预览绘制
          </button>
        </>
      )}
    </section>
  );
}
