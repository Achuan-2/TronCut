import { useState } from "react";
import {
  defaultAiSettings,
  aiProviderUpdateSchema,
  type AiProviderProfile,
  type AiProviderUpdate,
} from "../shared/preferences";

export type ProviderDraft = AiProviderProfile & {
  apiKey: string;
  clearApiKey: boolean;
};
export const providerUpdate = ({
  hasApiKey: _hasApiKey,
  ...update
}: ProviderDraft): AiProviderUpdate => update;

export default function AiProvidersFields({
  providers,
  setProviders,
  activeId,
  setActiveId,
  perform,
  toast,
}: {
  providers: ProviderDraft[];
  setProviders: (value: ProviderDraft[]) => void;
  activeId: string;
  setActiveId: (value: string) => void;
  perform: (fn: () => Promise<void>) => Promise<void>;
  toast: (message: string) => void;
}) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [available, setAvailable] = useState<string[]>([]);
  const [fetched, setFetched] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [manual, setManual] = useState("");
  const provider = providers.find((p) => p.id === providerId) ?? providers[0];
  const allModels = providers.flatMap((p) =>
    p.models.map((m) => ({ ...m, provider: p.name })),
  );
  const matches = available.filter((name) =>
    name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const reset = () => {
    setAvailable([]);
    setFetched(false);
    setQuery("");
    setSelected([]);
    setManual("");
  };
  const change = (patch: Partial<ProviderDraft>) =>
    setProviders(
      providers.map((p) => (p.id === provider?.id ? { ...p, ...patch } : p)),
    );
  const addModels = (names: string[]) => {
    if (!provider) return;
    const unique = [
      ...new Set(
        names
          .map((name) => name.trim())
          .filter((name) => name && name.length <= 200),
      ),
    ]
      .filter((name) => !provider.models.some((m) => m.model === name))
      .slice(0, 100 - provider.models.length);
    const added = unique.map((model) => ({ id: crypto.randomUUID(), model }));
    change({ models: [...provider.models, ...added] });
    if (!activeId && added[0]) setActiveId(added[0].id);
    setSelected([]);
    setManual("");
  };
  return (
    <>
      <h3>AI 服务与模型</h3>
      <p className="field-help">
        同一服务共用 API
        地址和密钥，可获取模型列表后搜索、多选添加，也可以手动填写模型 ID。
      </p>
      <label className="field vertical">
        当前使用的模型
        <select
          aria-label="当前 AI 模型"
          value={activeId}
          disabled={!allModels.length}
          onChange={(e) => setActiveId(e.target.value)}
        >
          {!allModels.length && <option value="">尚未添加模型</option>}
          {allModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.model} · {m.provider}
            </option>
          ))}
        </select>
      </label>
      <div className="preferences-model-actions">
        <button
          type="button"
          disabled={providers.length >= 100}
          onClick={() => {
            const next: ProviderDraft = {
              id: crypto.randomUUID(),
              name: `服务 ${providers.length + 1}`,
              baseUrl: defaultAiSettings.baseUrl,
              models: [],
              hasApiKey: false,
              apiKey: "",
              clearApiKey: false,
            };
            setProviders([...providers, next]);
            setProviderId(next.id);
            reset();
          }}
        >
          添加服务
        </button>
        {provider && (
          <button
            type="button"
            onClick={() => {
              const remaining = providers.filter((p) => p.id !== provider.id);
              if (provider.models.some((m) => m.id === activeId))
                setActiveId(remaining.flatMap((p) => p.models)[0]?.id ?? "");
              setProviders(remaining);
              setProviderId(remaining[0]?.id ?? "");
              reset();
            }}
          >
            删除服务
          </button>
        )}
      </div>
      {provider && (
        <>
          <label className="field vertical">
            配置服务
            <select
              aria-label="配置 AI 服务"
              value={provider.id}
              onChange={(e) => {
                setProviderId(e.target.value);
                reset();
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field vertical">
            服务名称
            <input
              aria-label="AI 服务名称"
              value={provider.name}
              maxLength={100}
              onChange={(e) => change({ name: e.target.value })}
            />
          </label>
          <label className="field vertical">
            API 基础地址
            <input
              aria-label="AI API 基础地址"
              value={provider.baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(e) => {
                const baseUrl = e.target.value;
                let changedOrigin = false;
                try {
                  changedOrigin =
                    new URL(baseUrl).origin !==
                    new URL(provider.baseUrl).origin;
                } catch {
                  /* Validate complete addresses when saving. */
                }
                change({
                  baseUrl,
                  ...(changedOrigin
                    ? { apiKey: "", hasApiKey: false, clearApiKey: false }
                    : {}),
                });
                reset();
              }}
            />
          </label>
          <label className="field vertical">
            API 密钥
            <input
              aria-label="AI API 密钥"
              type="password"
              autoComplete="new-password"
              value={provider.apiKey}
              placeholder={
                provider.hasApiKey
                  ? "已保存密钥，留空保持不变"
                  : "本地服务可留空"
              }
              onChange={(e) => {
                change({ apiKey: e.target.value, clearApiKey: false });
                setAvailable([]);
                setFetched(false);
                setSelected([]);
              }}
            />
          </label>
          {provider.hasApiKey && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={provider.clearApiKey}
                onChange={(e) =>
                  change({ clearApiKey: e.target.checked, apiKey: "" })
                }
              />
              删除此服务已保存的密钥
            </label>
          )}
          <div className="preferences-model-actions">
            <button
              type="button"
              disabled={
                !aiProviderUpdateSchema.safeParse(providerUpdate(provider))
                  .success
              }
              onClick={() =>
                void perform(async () => {
                  const models = await window.framecraft!.listAiModels(
                    providerUpdate(provider),
                  );
                  setAvailable(models);
                  setFetched(true);
                  setSelected([]);
                })
              }
            >
              获取模型列表
            </button>
            <button
              type="button"
              disabled={!provider.models.length}
              onClick={() =>
                void perform(async () => {
                  const modelId = provider.models.some((m) => m.id === activeId)
                    ? activeId
                    : provider.models[0].id;
                  await window.framecraft!.testAiConnection({
                    aiProviders: providers.map(providerUpdate),
                    activeAiModelId: modelId,
                  });
                  toast("AI 连接测试成功");
                })
              }
            >
              测试连接
            </button>
          </div>
          {fetched && (
            <div className="ai-model-catalog">
              <input
                aria-label="搜索可用模型"
                placeholder="搜索模型名称…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="ai-model-results">
                {matches.slice(0, 200).map((name) => {
                  const added = provider.models.some((m) => m.model === name);
                  return (
                    <label key={name} className="check-field">
                      <input
                        type="checkbox"
                        aria-label={`选择模型 ${name}`}
                        disabled={
                          added ||
                          (!selected.includes(name) &&
                            provider.models.length + selected.length >= 100)
                        }
                        checked={added || selected.includes(name)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, name]
                              : selected.filter((id) => id !== name),
                          )
                        }
                      />
                      <span>{name}</span>
                      {added && <small>已添加</small>}
                    </label>
                  );
                })}
                {!matches.length && (
                  <p className="field-help">
                    {available.length
                      ? "没有匹配的模型，请尝试其他名称。"
                      : "服务返回的模型列表为空，可以手动添加模型 ID。"}
                  </p>
                )}
                {matches.length > 200 && (
                  <p className="field-help">
                    当前显示前 200 项，输入名称可继续缩小范围。
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={!selected.length || provider.models.length >= 100}
                onClick={() => addModels(selected)}
              >
                添加所选模型（{selected.length}）
              </button>
            </div>
          )}
          <label className="field vertical">
            手动添加模型
            <div className="ai-manual-model">
              <input
                aria-label="手动模型 ID"
                value={manual}
                maxLength={200}
                placeholder="填写服务提供的模型 ID"
                onChange={(e) => setManual(e.target.value)}
              />
              <button
                type="button"
                disabled={
                  !manual.trim() ||
                  provider.models.length >= 100 ||
                  provider.models.some((m) => m.model === manual.trim())
                }
                onClick={() => addModels([manual])}
              >
                添加模型
              </button>
            </div>
          </label>
          <h4>此服务已添加的模型（{provider.models.length}）</h4>
          <div className="ai-added-models">
            {provider.models.map((model) => (
              <div key={model.id}>
                <label className="check-field">
                  <input
                    type="radio"
                    name="active-ai-model"
                    aria-label={`使用模型 ${model.model}`}
                    checked={activeId === model.id}
                    onChange={() => setActiveId(model.id)}
                  />
                  <span>{model.model}</span>
                </label>
                <button
                  type="button"
                  aria-label={`移除模型 ${model.model}`}
                  onClick={() => {
                    change({
                      models: provider.models.filter((m) => m.id !== model.id),
                    });
                    if (activeId === model.id)
                      setActiveId(
                        allModels.find((m) => m.id !== model.id)?.id ?? "",
                      );
                  }}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
          <p className="field-help">
            密钥使用系统安全存储加密，不写入工程。更换服务来源后需重新填写密钥；字幕
            AI 功能使用当前模型。
          </p>
        </>
      )}
    </>
  );
}
