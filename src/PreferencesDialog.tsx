import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { defaultAiSettings } from "../shared/preferences";

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
  const [ai, setAi] = useState(defaultAiSettings);
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
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
          setAi(value.ai);
          setHasApiKey(value.hasApiKey);
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
            <p>AI 模型 · 字幕语义断句、精修与润色</p>
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
            API 基础地址
            <input
              aria-label="AI API 基础地址"
              type="url"
              value={ai.baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(event) =>
                setAi({ ...ai, baseUrl: event.target.value })
              }
            />
          </label>
          <label className="field vertical">
            模型名称
            <input
              aria-label="AI 模型名称"
              value={ai.model}
              placeholder="填写服务提供的模型 ID"
              onChange={(event) => setAi({ ...ai, model: event.target.value })}
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
                setApiKey(event.target.value);
                setClearApiKey(false);
              }}
            />
          </label>
          {hasApiKey && (
            <label className="caption-option">
              <input
                type="checkbox"
                checked={clearApiKey}
                onChange={(event) => {
                  setClearApiKey(event.target.checked);
                  setApiKey("");
                }}
              />
              删除已保存的密钥
            </label>
          )}
          <p className="caption-processing-note">
            密钥使用系统安全存储加密，不写入工程。更换服务地址的来源后，需要重新填写密钥。
          </p>
          <div className="preferences-actions">
            <button
              disabled={!ai.model.trim()}
              onClick={() =>
                run(async () => {
                  if (!window.framecraft) return;
                  await window.framecraft.testAiConnection({
                    ai,
                    apiKey,
                    clearApiKey,
                  });
                  toast("AI 连接测试成功");
                })
              }
            >
              测试连接
            </button>
            <button
              className="primary"
              disabled={!ai.model.trim()}
              onClick={() =>
                run(async () => {
                  if (!window.framecraft) return;
                  await window.framecraft.savePreferences({
                    ai,
                    apiKey,
                    clearApiKey,
                  });
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
