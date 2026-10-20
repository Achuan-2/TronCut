import { useEffect, useRef, useState } from "react";
import { X, FolderOpen, RotateCcw } from "lucide-react";
import {
  storagePreferencesSchema,
  type StoragePreferences,
  type StorageDirectoryKind,
} from "../shared/storage";
import {
  preferencesUpdateSchema,
  type Preferences,
  type PreferencesUpdate,
} from "../shared/preferences";
import {
  defaultEditorPreferences,
  type EditorPreferences,
} from "../shared/editor-preferences";
import { editCommands } from "../shared/edit-menu";
import CursorStyleSelect from "./CursorStyleSelect";
import AiProvidersFields, {
  providerUpdate,
  type ProviderDraft,
} from "./AiProvidersFields";

const tabs = [
  { id: "program", name: "程序" },
  { id: "timing", name: "计时" },
  { id: "shortcuts", name: "快捷键" },
  { id: "project", name: "项目" },
  { id: "ai", name: "AI 模型" },
];
export default function PreferencesDialog({
  onClose,
  onSaved,
  initialTab = "program",
  toast,
  busy,
}: {
  onClose: () => void;
  onSaved: (value: Preferences) => void;
  initialTab?: string;
  toast: (text: string) => void;
  busy: boolean;
}) {
  const [tab, setTab] = useState(initialTab);
  const [settings, setSettings] = useState<EditorPreferences>(
    structuredClone(defaultEditorPreferences),
  );
  const [providers, setProviders] = useState<ProviderDraft[]>([]);
  const [storage, setStorage] = useState(() =>
    storagePreferencesSchema.parse({}),
  );
  const [storageDefaults, setStorageDefaults] =
    useState<StoragePreferences>(storage);
  const savedStorage = useRef(storage);
  const [activeId, setActiveId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [shortcutQuery, setShortcutQuery] = useState("");
  const dialog = useRef<HTMLFormElement>(null);
  useEffect(() => {
    let active = true;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.current
      ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
      ?.focus();
    if (!window.framecraft) {
      setError("首选项需要运行桌面版");
      return;
    }
    void window.framecraft
      .preferences()
      .then((value) => {
        if (!active) return;
        setStorage(value.storage);
        savedStorage.current = value.storage;
        setStorageDefaults(value.storageDefaults);
        setSettings({
          program: value.program,
          timing: value.timing,
          project: value.project,
          recording: value.recording,
        });
        setProviders(
          value.aiProviders.map((p) => ({
            ...p,
            apiKey: "",
            clearApiKey: false,
          })),
        );
        setActiveId(value.activeAiModelId);
        setLoaded(true);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const blocked = busy || working;
  useEffect(() => {
    if (error)
      dialog.current
        ?.querySelector('[role="alert"]')
        ?.scrollIntoView({ block: "nearest" });
  }, [error]);
  const update: PreferencesUpdate = {
    ...settings,
    storage,
    aiProviders: providers.map(providerUpdate),
    activeAiModelId: activeId,
  };
  const valid = preferencesUpdateSchema.safeParse(update).success;
  async function perform(fn: () => Promise<void>) {
    if (blocked) return;
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(String(e).replace(/^Error: /, ""));
    } finally {
      setWorking(false);
    }
  }
  const program = <K extends keyof EditorPreferences["program"]>(
    key: K,
    value: EditorPreferences["program"][K],
  ) => setSettings((s) => ({ ...s, program: { ...s.program, [key]: value } }));
  const timing = (key: keyof EditorPreferences["timing"], value: number) => {
    if (Number.isFinite(value) && value >= 0.1 && value <= 600)
      setSettings((s) => ({ ...s, timing: { ...s.timing, [key]: value } }));
  };
  const project = (patch: Partial<EditorPreferences["project"]>) =>
    setSettings((s) => ({ ...s, project: { ...s.project, ...patch } }));
  const storageField = (kind: StorageDirectoryKind, label: string) => (
    <div className="storage-directory-field">
      <label className="field vertical">
        {label}
        <input
          aria-label={label}
          readOnly
          value={storage[kind] || storageDefaults[kind]}
          title={storage[kind] || storageDefaults[kind]}
        />
      </label>
      <div className="preferences-actions">
        <button
          type="button"
          onClick={() =>
            void perform(async () => {
              const directory = await window.framecraft!.selectStorageDirectory(
                kind,
                storage[kind] || storageDefaults[kind],
              );
              if (directory !== null)
                setStorage((current) => ({ ...current, [kind]: directory }));
            })
          }
        >
          选择文件夹
        </button>
        <button
          type="button"
          aria-label={`${label}：恢复默认`}
          title="恢复默认位置"
          disabled={!storage[kind]}
          onClick={() => setStorage((current) => ({ ...current, [kind]: "" }))}
        >
          <RotateCcw size={16} />
        </button>
        <button
          type="button"
          aria-label={`${label}：打开当前文件夹`}
          title="打开当前文件夹（更改后请先保存）"
          disabled={storage[kind] !== savedStorage.current[kind]}
          onClick={() =>
            void perform(() => window.framecraft!.openStorageDirectory(kind))
          }
        >
          <FolderOpen size={16} />
        </button>
      </div>
    </div>
  );
  const shortcut = (value: string) =>
    value.replace(
      "CmdOrCtrl",
      window.framecraft?.platform === "darwin" ? "⌘" : "Ctrl",
    );
  const presets = [
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
    [1280, 720],
    [1080, 1920],
    [1080, 1080],
  ];
  const canvasPreset = presets.some(
    ([w, h]) => w === settings.project.width && h === settings.project.height,
  )
    ? `${settings.project.width}x${settings.project.height}`
    : "custom";
  return (
    <div
      className="modal-backdrop"
      onPointerDown={() => !blocked && onClose()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !blocked) onClose();
        if (e.key === "Tab") {
          const controls = [
            ...(dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
            ) ?? []),
          ];
          const first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <form
        ref={dialog}
        className="preferences-dialog preferences-grouped"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || !loaded || blocked) return;
          void perform(async () => {
            const saved = await window.framecraft!.savePreferences(update);
            onSaved(saved);
            toast("首选项已保存");
            onClose();
          });
        }}
      >
        <div className="modal-heading">
          <h2 id="preferences-title">首选项</h2>
          <button
            type="button"
            aria-label="关闭首选项"
            disabled={blocked}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <div
          className="preferences-tabs"
          role="tablist"
          aria-label="首选项分组"
        >
          {tabs.map((item) => (
            <button
              type="button"
              role="tab"
              key={item.id}
              aria-selected={tab === item.id}
              aria-controls={`preferences-${item.id}`}
              id={`preferences-tab-${item.id}`}
              disabled={blocked}
              onClick={() => setTab(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="preferences-content">
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <fieldset disabled={!loaded || blocked}>
            <section
              id={`preferences-${tab}`}
              role="tabpanel"
              aria-labelledby={`preferences-tab-${tab}`}
            >
              {tab === "program" && (
                <>
                  <h3>程序选项</h3>
                  <label className="field">
                    默认工具
                    <select
                      aria-label="默认工具"
                      value={settings.program.defaultTool}
                      onChange={(e) =>
                        program(
                          "defaultTool",
                          e.target.value as "select" | "crop",
                        )
                      }
                    >
                      <option value="select">选择</option>
                      <option value="crop">裁剪</option>
                    </select>
                  </label>
                  <label className="field">
                    画布显示比例
                    <select
                      aria-label="默认画布显示比例"
                      value={settings.program.previewZoom}
                      onChange={(e) =>
                        program(
                          "previewZoom",
                          e.target.value as typeof settings.program.previewZoom,
                        )
                      }
                    >
                      <option value="fit">适合窗口</option>
                      {["0.25", "0.5", "0.75", "1"].map((value) => (
                        <option key={value} value={value}>
                          {Number(value) * 100}%
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    预览画质
                    <select
                      aria-label="默认预览画质"
                      value={settings.program.previewQuality}
                      onChange={(e) =>
                        program(
                          "previewQuality",
                          e.target
                            .value as typeof settings.program.previewQuality,
                        )
                      }
                    >
                      <option value="smooth">流畅画质</option>
                      <option value="original">原画画质</option>
                    </select>
                  </label>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={settings.program.snapping}
                      onChange={(e) => program("snapping", e.target.checked)}
                    />
                    默认启用时间线吸附
                  </label>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={settings.program.waveforms}
                      onChange={(e) => program("waveforms", e.target.checked)}
                    />
                    显示时间线音频波形
                  </label>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={settings.program.selectionFollowsPlayhead}
                      onChange={(e) =>
                        program("selectionFollowsPlayhead", e.target.checked)
                      }
                    />
                    选择跟随播放指示器
                  </label>
                  <h3>项目恢复</h3>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={settings.program.autoRecovery}
                      onChange={(e) =>
                        program("autoRecovery", e.target.checked)
                      }
                    />
                    启用自动恢复备份
                  </label>
                  <label className="field">
                    修改停止后备份间隔
                    <input
                      type="number"
                      aria-label="自动恢复间隔"
                      min={1}
                      max={600}
                      value={settings.program.recoveryDelay}
                      disabled={!settings.program.autoRecovery}
                      onChange={(e) => {
                        const n = e.target.valueAsNumber;
                        if (n >= 1 && n <= 600) program("recoveryDelay", n);
                      }}
                    />
                    <span>秒</span>
                  </label>
                  <p className="field-help">
                    备份用于异常退出后的“恢复编辑”，不代替手动保存项目。
                  </p>
                  <h3>存储</h3>
                  {storageField("projectDirectory", "默认项目创建位置")}
                  <p className="field-help">
                    用于新建项目，已有项目保留原位置。
                  </p>
                  {storageField("backupDirectory", "备份文件夹")}
                  <p className="field-help">
                    保存时复制已有备份，保留源文件；目标文件夹中已有备份优先。
                  </p>
                  {storageField("onnxModelsDirectory", "ONNX 模型文件夹")}
                  <p className="field-help">
                    保存时复制已有模型，保留源文件；目标文件夹中已有文件优先。模型较大时请等待复制完成。
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      void perform(() =>
                        window.framecraft!.openPreferencesFolder(),
                      )
                    }
                  >
                    打开配置文件夹
                  </button>
                </>
              )}
              {tab === "timing" && (
                <>
                  <h3>默认持续时间</h3>
                  {(
                    Object.entries({
                      animation: "动画",
                      image: "图像",
                      text: "文字",
                      annotation: "注释",
                      transition: "转换",
                      caption: "手动字幕",
                    }) as [keyof EditorPreferences["timing"], string][]
                  ).map(([key, label]) => (
                    <label className="field" key={key}>
                      {label}
                      <input
                        type="number"
                        aria-label={`${label}默认时长`}
                        min={0.1}
                        max={600}
                        step={0.1}
                        value={settings.timing[key]}
                        onChange={(e) => timing(key, e.target.valueAsNumber)}
                      />
                      <span>秒</span>
                    </label>
                  ))}
                  <p className="field-help">
                    用于之后添加的素材与动画。语音识别和导入字幕仍使用原始时间。
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setSettings((s) => ({
                        ...s,
                        timing: structuredClone(
                          defaultEditorPreferences.timing,
                        ),
                      }))
                    }
                  >
                    还原计时默认值
                  </button>
                </>
              )}
              {tab === "project" && (
                <>
                  <h3>默认项目设置</h3>
                  <label className="field">
                    画布规格
                    <select
                      aria-label="默认画布规格"
                      value={canvasPreset}
                      onChange={(e) => {
                        if (e.target.value === "custom") return;
                        const [width, height] = e.target.value
                          .split("x")
                          .map(Number);
                        project({ width, height });
                      }}
                    >
                      {presets.map(([w, h]) => (
                        <option key={`${w}x${h}`} value={`${w}x${h}`}>
                          {w} × {h}
                        </option>
                      ))}
                      <option value="custom">自定义</option>
                    </select>
                  </label>
                  {(["width", "height"] as const).map((key, index) => (
                    <label className="field" key={key}>
                      {["宽度", "高度"][index]}
                      <input
                        type="number"
                        aria-label={`默认画布${["宽度", "高度"][index]}`}
                        min={16}
                        max={key === "width" ? 7680 : 4320}
                        value={settings.project[key]}
                        onChange={(e) => {
                          const n = e.target.valueAsNumber;
                          if (
                            Number.isInteger(n) &&
                            n >= 16 &&
                            n <= (key === "width" ? 7680 : 4320)
                          )
                            project({ [key]: n });
                        }}
                      />
                      <span>px</span>
                    </label>
                  ))}
                  <label className="field">
                    帧率
                    <select
                      aria-label="默认项目帧率"
                      value={settings.project.fps}
                      onChange={(e) => project({ fps: Number(e.target.value) })}
                    >
                      {[
                        15,
                        24,
                        25,
                        30,
                        50,
                        60,
                        120,
                        ...(![15, 24, 25, 30, 50, 60, 120].includes(
                          settings.project.fps,
                        )
                          ? [settings.project.fps]
                          : []),
                      ].map((value) => (
                        <option key={value} value={value}>
                          {value} fps
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    画布背景
                    <input
                      type="color"
                      aria-label="默认画布背景"
                      value={settings.project.background}
                      onChange={(e) => project({ background: e.target.value })}
                    />
                  </label>
                  <p className="field-help">
                    新建项目与新建录制使用这些值。已打开项目保留自己的画布设置。
                  </p>
                  <h3>录屏默认设置</h3>
                  <label className="field">
                    自动缩放范围
                    <select
                      aria-label="默认自动缩放范围"
                      value={
                        settings.recording.zoomBackground ? "scene" : "screen"
                      }
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          recording: {
                            ...s.recording,
                            zoomBackground: e.target.value === "scene",
                          },
                        }))
                      }
                    >
                      <option value="screen">仅录屏缩放，背景固定</option>
                      <option value="scene">录屏和背景一起缩放</option>
                    </select>
                  </label>
                  <label className="field">
                    默认鼠标样式
                    <CursorStyleSelect
                      label="默认鼠标样式"
                      value={settings.recording.cursor.style}
                      color={settings.recording.cursor.color}
                      onChange={(style) =>
                        setSettings((s) => ({
                          ...s,
                          recording: {
                            ...s.recording,
                            cursor: {
                              ...s.recording.cursor,
                              style,
                            },
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    默认鼠标大小
                    <input
                      aria-label="默认鼠标大小"
                      type="number"
                      min={8}
                      max={160}
                      value={settings.recording.cursor.size}
                      onChange={(e) => {
                        const size = e.target.valueAsNumber;
                        if (size >= 8 && size <= 160)
                          setSettings((s) => ({
                            ...s,
                            recording: {
                              ...s.recording,
                              cursor: { ...s.recording.cursor, size },
                            },
                          }));
                      }}
                    />
                    <span>px</span>
                  </label>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={settings.recording.cursor.smooth}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          recording: {
                            ...s.recording,
                            cursor: {
                              ...s.recording.cursor,
                              smooth: e.target.checked,
                            },
                          },
                        }))
                      }
                    />
                    自动平滑录屏鼠标
                  </label>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={settings.recording.cursor.clicks}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          recording: {
                            ...s.recording,
                            cursor: {
                              ...s.recording.cursor,
                              clicks: e.target.checked,
                            },
                          },
                        }))
                      }
                    />
                    显示鼠标点击高亮
                  </label>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={settings.recording.autoZoom}
                      onChange={(e) =>
                        setSettings((s) => ({
                          ...s,
                          recording: {
                            ...s.recording,
                            autoZoom: e.target.checked,
                          },
                        }))
                      }
                    />
                    录制后自动应用鼠标聚焦缩放
                  </label>
                  <p className="field-help">
                    与录制窗口共用默认值，鼠标与自动缩放需要原生录屏轨迹。
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setSettings((s) => ({
                        ...s,
                        project: structuredClone(
                          defaultEditorPreferences.project,
                        ),
                      }))
                    }
                  >
                    还原项目默认值
                  </button>
                </>
              )}
              {tab === "shortcuts" && (
                <>
                  <h3>快捷键一览</h3>
                  <input
                    aria-label="搜索快捷键"
                    placeholder="搜索编辑命令…"
                    value={shortcutQuery}
                    onChange={(e) => setShortcutQuery(e.target.value)}
                  />
                  <div className="preferences-shortcuts">
                    {[
                      ...editCommands.map((item) => ({
                        name: item.label,
                        key: shortcut(item.shortcut),
                      })),
                      { name: "播放 / 暂停", key: "Space" },
                      { name: "前一帧 / 后一帧", key: "← / →" },
                      {
                        name: "前一个 / 后一个媒体",
                        key: shortcut("CmdOrCtrl") + "+← / →",
                      },
                      { name: "保存项目", key: shortcut("CmdOrCtrl+S") },
                      { name: "导出视频", key: shortcut("CmdOrCtrl+E") },
                    ]
                      .filter((item) =>
                        `${item.name} ${item.key}`
                          .toLowerCase()
                          .includes(shortcutQuery.toLowerCase()),
                      )
                      .map((item) => (
                        <div key={item.name}>
                          <span>{item.name}</span>
                          <kbd>{item.key}</kbd>
                        </div>
                      ))}
                  </div>
                </>
              )}
              {tab === "ai" && (
                <AiProvidersFields
                  providers={providers}
                  setProviders={setProviders}
                  activeId={activeId}
                  setActiveId={setActiveId}
                  perform={perform}
                  toast={toast}
                />
              )}
            </section>
          </fieldset>
        </div>
        <div className="preferences-footer">
          <button type="button" disabled={blocked} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!loaded || !valid || blocked}
          >
            {working ? "正在处理…" : "确定"}
          </button>
        </div>
      </form>
    </div>
  );
}
