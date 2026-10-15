import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  defaultAiSettings,
  type AiModelProfile,
  type PreferencesUpdate,
} from "../shared/preferences";

type ModelDraft = AiModelProfile & { apiKey: string; clearApiKey: boolean };
const newModel = (): ModelDraft => ({
  id: crypto.randomUUID(),
  ...defaultAiSettings,
  hasApiKey: false,
  apiKey: "",
  clearApiKey: false,
});

export default function PreferencesDialog({
  onClose,
  run,
  toast,
  busy,
}: {
  onClose: () => void;
  run: (fn: () => Promise<unknown>) => void;
  toast: (text: string) => void;
  busy: boolean;
}) {
  const [models, setModels] = useState<ModelDraft[]>(() => [newModel()]);
  const [activeId, setActiveId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!window.framecraft) {
      setError("首选项需要运行桌面版");
      return;
    }
    void window.framecraft
      .preferences()
      .then((value) => {
        if (active) {
          const drafts = value.aiModels.length
            ? value.aiModels.map((model) => ({
                ...model,
                apiKey: "",
                clearApiKey: false,
              }))
            : [newModel()];
          setModels(drafts);
          setActiveId(value.activeAiModelId || drafts[0].id);
          setLoaded(true);
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, []);
  const ai = models.find((model) => model.id === activeId) ?? models[0];
  const { apiKey, hasApiKey, clearApiKey } = ai;
  const setAi = (patch: Partial<ModelDraft>) =>
    setModels((current) =>
      current.map((model) =>
        model.id === ai.id ? { ...model, ...patch } : model,
      ),
    );
  const update: PreferencesUpdate = {
    aiModels: models.map(({ hasApiKey: _hasApiKey, ...model }) => model),
    activeAiModelId: ai.id,
  };
  const valid = models.every(
    (model) => model.model.trim() && model.baseUrl.trim(),
  );
  return (
    <div
      className="modal-backdrop"
      onPointerDown={() => !busy && onClose()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !busy) onClose();
      }}
    >
      <div
        className="preferences-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="preferences-title">首选项</h2>
            <p>AI 模型 · 字幕语义断句与纠错精修</p>
          </div>
          <button aria-label="关闭首选项" disabled={busy} onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <p className="caption-processing-note">
          支持 OpenAI 兼容接口，可连接云端服务或本地模型。保存后在字幕面板中选择
          AI 功能。
        </p>
        {error && <p role="alert">{error}</p>}
        <fieldset disabled={!loaded || busy}>
          <label className="field vertical">
            当前模型
            <select
              aria-label="当前 AI 模型"
              value={ai.id}
              onChange={(event) => setActiveId(event.target.value)}
            >
              {models.map((model, index) => (
                <option key={model.id} value={model.id}>
                  {model.model || `新模型 ${index + 1}`} · {model.baseUrl}
                </option>
              ))}
            </select>
          </label>
          <div className="preferences-model-actions">
            <button
              disabled={models.length >= 100}
              onClick={() => {
                const model = newModel();
                setModels((current) => [...current, model]);
                setActiveId(model.id);
              }}
            >
              添加模型
            </button>
            <button
              onClick={() => {
                const remaining = models.filter((model) => model.id !== ai.id);
                if (!remaining.length) remaining.push(newModel());
                setModels(remaining);
                setActiveId(remaining[0].id);
              }}
            >
              删除当前模型
            </button>
          </div>
          <label className="field vertical">
            API 基础地址
            <input
              aria-label="AI API 基础地址"
              type="url"
              value={ai.baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(event) => setAi({ baseUrl: event.target.value })}
            />
          </label>
          <label className="field vertical">
            模型名称
            <input
              aria-label="AI 模型名称"
              value={ai.model}
              placeholder="填写服务提供的模型 ID"
              onChange={(event) => setAi({ model: event.target.value })}
            />
          </label>
          <label className="field vertical">
            API 密钥
            <input
              aria-label="AI API 密钥"
              type="password"
              autoComplete="new-password"
              value={apiKey}
              placeholder={
                hasApiKey
                  ? "已保存密钥；留空保持不变"
                  : "填写密钥；本地服务可留空"
              }
              onChange={(event) => {
                setAi({ apiKey: event.target.value, clearApiKey: false });
              }}
            />
          </label>
          {hasApiKey && (
            <label className="caption-option">
              <input
                type="checkbox"
                checked={clearApiKey}
                onChange={(event) => {
                  setAi({ clearApiKey: event.target.checked, apiKey: "" });
                }}
              />
              删除已保存的密钥
            </label>
          )}
          <p className="caption-processing-note">
            每个模型分别保存接口地址和密钥，字幕 AI
            功能使用当前模型。密钥使用系统安全存储加密，不写入工程。更换服务地址的来源后，需要重新填写密钥。
          </p>
          <div className="preferences-actions">
            <button
              disabled={!ai.model.trim() || !ai.baseUrl.trim()}
              onClick={() =>
                run(async () => {
                  if (!window.framecraft) return;
                  await window.framecraft.testAiConnection({
                    aiModels: update.aiModels?.filter(
                      (model) => model.id === ai.id,
                    ),
                    activeAiModelId: ai.id,
                  });
                  toast("AI 连接测试成功");
                })
              }
            >
              测试连接
            </button>
            <button
              className="primary"
              disabled={!valid}
              onClick={() =>
                run(async () => {
                  if (!window.framecraft) return;
                  await window.framecraft.savePreferences(update);
                  toast("首选项已保存");
                  onClose();
                })
              }
            >
              保存首选项
            </button>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
