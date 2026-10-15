import type { CaptionProcessingOptions } from "../shared/caption-processing";

export default function CaptionProcessingFields({
  value,
  onChange,
  existing = false,
  segmentationOnly = false,
}: {
  value: CaptionProcessingOptions;
  onChange: (value: CaptionProcessingOptions) => void;
  existing?: boolean;
  segmentationOnly?: boolean;
}) {
  const usesAi = value.segmentation === "ai" || value.refinement !== "none";
  return (
    <fieldset className="caption-processing-fields">
      <legend>
        {segmentationOnly ? "断句设置" : existing ? "AI纠错精修" : "断句与精修"}
      </legend>
      {!existing && (
        <>
          <label className="field vertical">
            断句方式
            <select
              aria-label="断句方式"
              value={value.segmentation}
              onChange={(event) =>
                onChange({
                  ...value,
                  segmentation: event.target
                    .value as CaptionProcessingOptions["segmentation"],
                })
              }
            >
              <option value="standard">标准断句（默认）</option>
              <option value="ai">AI 语义断句（更像人工）</option>
              <option value="custom">自定义字数上限</option>
              <option value="unlimited">不限制长度</option>
            </select>
          </label>
          {value.segmentation === "custom" && (
            <label className="field vertical">
              每条字幕字数上限
              <input
                aria-label="每条字幕字数上限"
                type="number"
                min="8"
                max="120"
                value={value.maxChars}
                onChange={(event) =>
                  onChange({ ...value, maxChars: Number(event.target.value) })
                }
              />
            </label>
          )}
          <p className="caption-processing-note">
            标准断句优先按标点和词语切分，保留英文名称；缺少逐字时间时，段内时间为估算。
          </p>
        </>
      )}
      {!segmentationOnly && !existing && (
        <label className="field vertical">
          文字精修
          <select
            aria-label="文字精修"
            value={value.refinement}
            onChange={(event) =>
              onChange({
                ...value,
                refinement: event.target
                  .value as CaptionProcessingOptions["refinement"],
              })
            }
          >
            {!existing && <option value="none">不精修，保留识别原文</option>}
            <option value="correct">AI 纠错精修</option>
            <option value="polish">AI 润色</option>
          </select>
        </label>
      )}
      {usesAi && (
        <>
          <details className="caption-instruction">
            <summary>补充要求（可选）</summary>
            <textarea
              aria-label="字幕精修补充要求"
              rows={2}
              maxLength={2000}
              placeholder="可补充提供原文稿，或填写要求，例如：保留专业名词，使用中文标点，保持口语表达。"
              value={value.instruction}
              onChange={(event) =>
                onChange({ ...value, instruction: event.target.value })
              }
            />
          </details>
          <p className="caption-processing-note">
            AI
            功能使用“编辑 → 首选项 → AI 模型”中选择的模型，字幕文本会发送到所配置的服务。失败时自动保留规则断句和原文。
          </p>
        </>
      )}
    </fieldset>
  );
}
