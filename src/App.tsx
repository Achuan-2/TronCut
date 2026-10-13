import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Circle,
  FileJson,
  FolderOpen,
  Save,
  X,
  Check,
  Monitor,
  Plus,
} from "lucide-react";
import {
  createProject,
  type Clip,
  uid,
  defaultTransform,
} from "../shared/model";
import type { Capabilities } from "../shared/bridge";
import {
  deleteClips,
  splitSelection,
  pasteClips,
  groupSelection,
} from "../shared/timeline";
import { useEditor } from "./useEditor";
import Preview from "./Preview";
import Timeline from "./Timeline";
import Panels, { Inspector, type Tab } from "./Panels";
import Recorder from "./Recorder";

export default function App() {
  const editor = useEditor(),
    [tab, setTab] = useState<Tab>("media"),
    [recording, setRecording] = useState(false),
    [caps, setCaps] = useState<Capabilities>(),
    [toastMessage, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<{
      percent: number;
      label: string;
    } | null>(null),
    [menu, setMenu] = useState(false),
    [file, setFile] = useState(""),
    [importReport, setImportReport] = useState<string[] | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    clipClipboard = useRef<Clip[]>([]);
  const initialized = useRef(false);
  const toast = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  }, []);
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
      } catch (e) {
        toast(String(e).replace(/^Error: /, ""));
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [toast],
  );
  const bridge = () => {
    if (!window.framecraft)
      throw new Error("此功能需要桌面版，请运行 pnpm dev");
    return window.framecraft;
  };
  const refreshCapabilities = useCallback(() => {
    window.framecraft
      ?.capabilities()
      .then(setCaps)
      .catch((e) => toast(String(e)));
  }, [toast]);
  useEffect(() => {
    refreshCapabilities();
    return window.framecraft?.onProgress(setProgress);
  }, [refreshCapabilities]);
  useEffect(() => {
    void window.framecraft?.markDirty(editor.dirty);
  }, [editor.dirty]);
  const save = (saveAs = false) =>
    run(async () => {
      const result = await bridge().saveProject(editor.project, saveAs);
      if (result) {
        editor.markSaved(result.project);
        setFile(result.file);
        toast("工程已保存，所有素材已归档到工程文件夹");
      }
    });
  const open = () =>
    run(async () => {
      if (editor.dirty && !confirm("当前工程有未保存修改，确定打开其他工程？"))
        return;
      const result = await bridge().openProject();
      if (result) {
        editor.replace(result.project);
        setFile(result.file);
        const missing = result.project.assets.filter((a) => a.missing).length;
        toast(missing ? `工程已打开，${missing} 个素材离线` : "工程已打开");
      }
    });
  const importMedia = () =>
    run(async () => {
      const assets = await bridge().importMedia();
      if (assets.length) {
        editor.addAssets(assets);
        toast(`已导入 ${assets.length} 个素材，双击加入时间线`);
      }
    });
  const importCamtasia = () =>
    run(async () => {
      if (editor.dirty && !confirm("当前工程有未保存修改，确定导入其他工程？"))
        return;
      const project = await bridge().importCamtasia();
      if (project) {
        editor.replace(project, true);
        setFile("");
        setImportReport(project.importReport ?? []);
      }
    });
  const newProject = () => {
    if (editor.dirty && !confirm("当前工程有未保存修改，确定新建工程？"))
      return;
    void run(async () => {
      await window.framecraft?.newProject();
      editor.replace(createProject(), true);
      setFile("");
    });
  };
  const exportVideo = () =>
    run(async () => {
      editor.setPlaying(false);
      const result = await bridge().exportVideo(editor.project);
      if (result) toast(`视频已导出：${result}`);
    });
  const commands = useRef<(command: string) => void>(() => {});
  commands.current = (command) => {
    if (busy || recording) return;
    if (command === "openPending") {
      void run(async () => {
        if (
          editor.dirty &&
          !confirm("当前工程有未保存修改，确定打开其他工程？")
        )
          return;
        const result = await bridge().initialProject();
        if (result) {
          editor.replace(result.project);
          setFile(result.file);
        }
      });
      return;
    }
    (
      ({
        new: newProject,
        open,
        save: () => void save(),
        saveAs: () => void save(true),
        import: importMedia,
        camtasia: importCamtasia,
        export: exportVideo,
        undo: editor.undo,
        redo: editor.redo,
      }) as Record<string, () => void>
    )[command]?.();
  };
  useEffect(
    () => window.framecraft?.onShortcut((command) => commands.current(command)),
    [],
  );
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    const target = event.target as HTMLElement;
    if (
      target.closest('input, textarea, select, [contenteditable="true"]') ||
      busy ||
      recording
    )
      return;
    const selected = editor.selected,
      locked = editor.project.tracks.find(
        (t) => t.id === selected?.trackId,
      )?.locked;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      editor.selectMany(editor.project.clips.map((c) => c.id));
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "g"
    ) {
      event.preventDefault();
      editor.apply((p) =>
        groupSelection(p, editor.selectedIds, event.shiftKey),
      );
    } else if (event.key === "Escape") {
      editor.select(null);
    } else if (event.code === "Space") {
      event.preventDefault();
      editor.setPlaying(!editor.playing);
    } else if (
      event.key.toLowerCase() === "s" &&
      !event.ctrlKey &&
      !event.metaKey &&
      selected &&
      !locked
    )
      editor.apply((p) =>
        splitSelection(p, editor.selectedIds, editor.playhead),
      );
    else if (
      ["Delete", "Backspace"].includes(event.key) &&
      selected &&
      !locked
    ) {
      event.preventDefault();
      editor.apply((p) => deleteClips(p, editor.selectedIds, event.shiftKey));
      editor.select(null);
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "c" &&
      selected
    ) {
      event.preventDefault();
      clipClipboard.current = structuredClone(
        editor.project.clips.filter((c) => editor.selectedIds.includes(c.id)),
      );
      toast(`已复制 ${clipClipboard.current.length} 个片段`);
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "v" &&
      clipClipboard.current.length
    ) {
      event.preventDefault();
      const result = pasteClips(
        editor.project,
        clipClipboard.current,
        editor.playhead,
      );
      editor.apply(result.project);
      editor.selectMany(result.ids);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      editor.setPlaying(false);
      editor.seek((t) =>
        Math.max(
          0,
          t + (event.key === "ArrowLeft" ? -1 : 1) / editor.project.canvas.fps,
        ),
      );
    }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (window.framecraft && editor.dirty)
        void window.framecraft.writeRecovery(editor.project).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [editor.project, editor.dirty]);
  useEffect(() => {
    void (async () => {
      if (initialized.current) return;
      initialized.current = true;
      const initial = await window.framecraft?.initialProject();
      if (initial) {
        editor.replace(initial.project);
        setFile(initial.file);
        return;
      }
      const result = await window.framecraft?.readRecovery();
      if (result) {
        editor.replace(result.project, true);
        setFile(result.file ?? "");
        toast("已恢复上次自动保存的工程");
      }
    })().catch((error) => toast(String(error)));
  }, []);
  const recorded = (
    results: Parameters<React.ComponentProps<typeof Recorder>["onRecorded"]>[0],
  ) => {
    editor.apply((p) => {
      const tracks = [...p.tracks],
        clips: Clip[] = [];
      for (const { asset, kind } of results) {
        const track = {
          id: uid(),
          name:
            kind === "screen"
              ? "屏幕录制"
              : kind === "camera"
                ? "摄像头"
                : "麦克风",
          kind:
            kind === "microphone" ? ("audio" as const) : ("visual" as const),
          hidden: false,
          muted: false,
          locked: false,
        };
        if (kind === "camera") tracks.unshift(track);
        else tracks.push(track);
        clips.push({
          id: uid(),
          trackId: track.id,
          assetId: asset.id,
          kind: asset.kind,
          name: asset.name,
          start: editor.playhead,
          duration: asset.duration,
          sourceIn: 0,
          speed: 1,
          volume: 1,
          podcast: false,
          transform:
            kind === "camera"
              ? { x: 0.83, y: 0.8, scale: 0.25, opacity: 1 }
              : { ...defaultTransform },
          keyframes: [],
        });
      }
      return {
        ...p,
        tracks,
        clips: [...p.clips, ...clips],
        assets: [...p.assets, ...results.map((r) => r.asset)],
      };
    });
  };
  return (
    <main className="app-shell" onClick={() => menu && setMenu(false)}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <span />
          </div>
          <div>
            <b>TronCut</b>
            <small>让表达，自在发生</small>
          </div>
        </div>
        <div className="project-title">
          <input
            aria-label="工程名称"
            value={editor.project.name}
            onChange={(e) => {
              if (e.target.value.trim())
                editor.apply((p) => ({ ...p, name: e.target.value }));
            }}
          />
          <span>{editor.dirty ? "未保存" : file ? "已保存" : "起始工程"}</span>
        </div>
        <div className="header-actions">
          <button
            className="record-button"
            disabled={busy || recording}
            onClick={() => {
              editor.setPlaying(false);
              setRecording(true);
            }}
          >
            <Circle size={11} fill="currentColor" />
            录制
          </button>
          <button
            className="save-button"
            title="保存工程 Ctrl+S"
            disabled={busy || recording}
            onClick={() => void save()}
          >
            <Save size={17} />
            <span>保存</span>
          </button>
          <button
            className="export-button"
            disabled={busy || recording}
            onClick={() => void exportVideo()}
          >
            导出视频
            <ArrowUpRight size={17} />
          </button>
        </div>
      </header>
      <div className="workspace-bar">
        <div className="workspace-tabs">
          <button className="active">
            <Monitor size={14} />
            编辑工作区
          </button>
          <button
            className="project-menu-trigger"
            onClick={(e) => {
              e.stopPropagation();
              setMenu(!menu);
            }}
          >
            <FileJson size={14} />
            工程
            <ChevronDown size={12} />
          </button>
        </div>
        <span className="workspace-status">
          <i />
          {caps?.ffmpeg
            ? "媒体引擎就绪"
            : window.framecraft
              ? "媒体引擎待配置"
              : "浏览器预览 · 文件与录屏请用桌面版"}
          <span className="separator-dot">·</span>本地创作
        </span>
        {menu && (
          <div className="project-menu" onClick={() => setMenu(false)}>
            <button onClick={newProject}>
              <Plus size={15} />
              新建工程
            </button>
            <button onClick={() => void open()}>
              <FolderOpen size={15} />
              打开工程
            </button>
            <button onClick={() => void save(true)}>
              <Save size={15} />
              另存为
            </button>
            <button onClick={() => void importCamtasia()}>
              <FileJson size={15} />
              导入 Camtasia 工程
            </button>
          </div>
        )}
      </div>
      <div className="editor-workspace">
        <Panels
          editor={editor}
          tab={tab}
          setTab={setTab}
          importMedia={importMedia}
          importCamtasia={importCamtasia}
          run={(fn) => void run(fn)}
          toast={toast}
          capabilities={caps}
          refreshCapabilities={refreshCapabilities}
          busy={busy}
        />
        <Preview editor={editor} />
        <Inspector editor={editor} />
      </div>
      <Timeline editor={editor} />
      {toastMessage && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toastMessage}</span>
          <button onClick={() => setToast("")}>
            <X size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-overlay">
          <div className="task-card">
            <span className="spinner" />
            <h3>{progress?.label ?? "正在处理…"}</h3>
            {progress && (
              <>
                <div className="progress-bar">
                  <i style={{ width: `${progress.percent}%` }} />
                </div>
                <span>{Math.round(progress.percent)}%</span>
                <button onClick={() => void window.framecraft?.cancelTask()}>
                  取消任务
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {recording && (
        <Recorder
          onClose={() => setRecording(false)}
          onRecorded={recorded}
          toast={toast}
        />
      )}
      {importReport && (
        <div className="modal-backdrop">
          <div className="report-modal">
            <div className="modal-heading">
              <div>
                <h2>Camtasia 导入报告</h2>
                <p>导入后的效果需要核对，原始工程数据完整保留。</p>
              </div>
              <button onClick={() => setImportReport(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="report-lines">
              {importReport.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            <button
              className="wide-button primary"
              onClick={() => setImportReport(null)}
            >
              进入编辑器
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
