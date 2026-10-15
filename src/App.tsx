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
  Plus,
  Minus,
  Square,
  Copy,
  Home as HomeIcon,
  Settings2,
} from "lucide-react";
import {
  createProject,
  type Clip,
  uid,
  defaultTransform,
  newTrack,
} from "../shared/model";
import type { Capabilities, WindowState } from "../shared/bridge";
import {
  deleteClips,
  splitSelection,
  pasteClips,
  groupSelection,
} from "../shared/timeline";
import { useEditor } from "./useEditor";
import Preview from "./Preview";
import Timeline from "./Timeline";
import type { AnimationRange } from "../shared/animation-ranges";
import Panels, { Inspector, type Tab } from "./Panels";
import Recorder from "./Recorder";
import Home from "./Home";
import type { RecentProject, RecoveryInfo } from "../shared/recent-projects";
import PreferencesDialog from "./PreferencesDialog";

export default function App() {
  const editor = useEditor(),
    [screen, setScreen] = useState<"home" | "editor">("home"),
    [hasSession, setHasSession] = useState(false),
    [recent, setRecent] = useState<RecentProject[]>([]),
    [recovery, setRecovery] = useState<RecoveryInfo | null>(null),
    [homeLoading, setHomeLoading] = useState(true),
    [tab, setTab] = useState<Tab>("media"),
    [recording, setRecording] = useState(false),
    [caps, setCaps] = useState<Capabilities>(),
    [toastMessage, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [mediaImporting, setMediaImporting] = useState(false),
    [progress, setProgress] = useState<{
      percent: number;
      label: string;
    } | null>(null),
    [menu, setMenu] = useState(false),
    [windowState, setWindowState] = useState<WindowState>({
      maximized: false,
      fullscreen: false,
    }),
    [file, setFile] = useState(""),
    [importReport, setImportReport] = useState<string[] | null>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    clipClipboard = useRef<Clip[]>([]),
    clipClipboardToken = useRef("");
  const initialized = useRef(false);
  const mediaImportLock = useRef(false);
  const actionsBlocked =
    busy || mediaImporting || recording || !!editor.narrationRecording;
  const toast = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  }, []);
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      if (mediaImportLock.current) return;
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
  const importIntoTimeline = async (fn: () => Promise<void>) => {
    if (mediaImportLock.current || busy || recording) return;
    mediaImportLock.current = true;
    setMediaImporting(true);
    try {
      await fn();
    } catch (error) {
      toast(String(error).replace(/^Error: /, ""));
    } finally {
      mediaImportLock.current = false;
      setMediaImporting(false);
    }
  };
  const bridge = () => {
    if (!window.framecraft)
      throw new Error("此功能需要桌面版，请运行 pnpm dev");
    return window.framecraft;
  };
  useEffect(() => {
    const desktop = window.framecraft;
    void desktop
      ?.windowState()
      .then(setWindowState)
      .catch((error) => toast(String(error)));
    return desktop?.onWindowState(setWindowState);
  }, [toast]);
  useEffect(() => {
    document.title =
      screen === "home"
        ? "首页 — TronCut"
        : `${editor.project.name}${editor.dirty ? " *" : ""} — TronCut`;
  }, [screen, editor.project.name, editor.dirty]);
  const refreshHome = useCallback(async () => {
    setHomeLoading(true);
    try {
      const [recent, recovery] = await Promise.all([
        window.framecraft?.recentProjects(),
        window.framecraft?.recoveryInfo(),
      ]);
      setRecent(recent ?? []);
      setRecovery(recovery ?? null);
    } finally {
      setHomeLoading(false);
    }
  }, []);
  const enterEditor = () => {
    setScreen("editor");
    setHasSession(true);
    setMenu(false);
  };
  const goHome = () => {
    editor.setPlaying(false);
    setMenu(false);
    setScreen("home");
    void refreshHome().catch((error) => toast(String(error)));
  };
  const showWindowMenu = (
    name: "edit" | "view",
    element: HTMLButtonElement,
  ) => {
    const bounds = element.getBoundingClientRect();
    void window.framecraft
      ?.showWindowMenu(name, bounds.left, bounds.bottom)
      .catch((error) => toast(String(error)));
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
        void refreshHome().catch(() => {});
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
        enterEditor();
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
        enterEditor();
      }
    });
  const copyAnimation = (
    clipId: string,
    range: AnimationRange,
    cut = false,
  ) => {
    editor.clearBehaviorClipboard();
    const token = editor.copyAnimation(clipId, range, cut);
    if (!token) return;
    clipClipboard.current = [];
    clipClipboardToken.current = "";
    void window.framecraft
      ?.copyClipClipboard(token)
      .catch((error) => toast(String(error)));
    toast(cut ? "已剪切动画" : "已复制动画");
  };
  const paste = () =>
    importIntoTimeline(async () => {
      const result = window.framecraft
        ? await window.framecraft.importClipboardMedia()
        : {
            assets: [],
            clipToken:
              editor.behaviorClipboardToken() ??
              editor.animationClipboardToken() ??
              clipClipboardToken.current,
          };
      if (result.assets.length) {
        editor.setPlaying(false);
        editor.addAssets(result.assets, true, { pasteToTop: true });
        setTab("media");
        toast(`已粘贴 ${result.assets.length} 个素材到时间线`);
      } else if (
        result.clipToken &&
        result.clipToken === editor.behaviorClipboardToken()
      ) {
        if (editor.selectedId) {
          editor.pasteBehavior(editor.selectedId);
          toast("已粘贴行为");
        }
      } else if (
        result.clipToken &&
        result.clipToken === editor.animationClipboardToken()
      ) {
        if (editor.pasteCopiedAnimation()) toast("已粘贴动画");
        else toast("请选中可编辑片段，并将播放头放到足够长的空闲动画区间");
      } else if (
        result.clipToken &&
        result.clipToken === clipClipboardToken.current &&
        clipClipboard.current.length
      ) {
        let ids: string[] = [];
        editor.apply((project) => {
          const pasted = pasteClips(
            project,
            clipClipboard.current,
            editor.playhead,
          );
          ids = pasted.ids;
          return pasted.project;
        });
        editor.selectMany(ids);
      } else {
        toast("剪贴板中没有可粘贴的图片、视频或片段");
      }
    });
  const dropFiles = (files: File[], time: number, trackId?: string) =>
    importIntoTimeline(async () => {
      if (editor.project.tracks.find((track) => track.id === trackId)?.locked) {
        toast("轨道已锁定，请拖入其他轨道");
        return;
      }
      const assets = await bridge().importDroppedMedia(files);
      if (!assets.length) {
        toast("没有可导入的图片、视频或音频文件");
        return;
      }
      editor.setPlaying(false);
      editor.addAssets(assets, true, { time, trackId });
      setTab("media");
      toast(`已添加 ${assets.length} 个素材到时间线`);
    });
  const captureFrame = () =>
    importIntoTimeline(async () => {
      editor.setPlaying(false);
      const time = editor.playhead;
      const asset = await bridge().captureFrame(
        editor.project,
        time,
        editor.selectedKeyframe?.clipId,
      );
      editor.addAssets([asset], true, { time, newTrackForImages: true });
      setTab("media");
      toast("当前帧已作为图片插入新轨道");
    });
  const pasteHandler = useRef<(event: ClipboardEvent) => void>(() => {});
  pasteHandler.current = (event) => {
    if (
      (event.target as HTMLElement).closest(
        'input, textarea, select, [contenteditable="true"]',
      ) ||
      busy ||
      preferencesOpen ||
      recording ||
      screen === "home"
    )
      return;
    event.preventDefault();
    void paste();
  };
  useEffect(() => {
    const listener = (event: ClipboardEvent) => pasteHandler.current(event);
    window.addEventListener("paste", listener);
    return () => window.removeEventListener("paste", listener);
  }, []);
  useEffect(() => {
    // Prevent Chromium from navigating away when a file is dropped outside a lane.
    const preventFileNavigation = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);
  const newProject = (record = false) => {
    if (editor.dirty && !confirm("当前工程有未保存修改，确定新建工程？"))
      return;
    void run(async () => {
      await window.framecraft?.newProject();
      editor.replace(createProject());
      setFile("");
      setRecovery(null);
      enterEditor();
      if (record) setRecording(true);
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
    if (actionsBlocked || preferencesOpen) return;
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
          enterEditor();
        }
      });
      return;
    }
    if (screen === "home" && !["new", "open", "camtasia"].includes(command))
      return;
    (
      ({
        new: () => newProject(),
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
      preferencesOpen ||
      recording ||
      screen === "home"
    )
      return;
    const selected = editor.selected,
      locked = editor.project.tracks.find(
        (t) => t.id === selected?.trackId,
      )?.locked;
    const animation = editor.selectedAnimation;
    if (
      editor.selectedTransition &&
      ["Delete", "Backspace"].includes(event.key)
    ) {
      event.preventDefault();
      if (!locked) editor.updateTransition(editor.selectedTransition, null);
    } else if (
      editor.selectedBehavior &&
      ["Delete", "Backspace"].includes(event.key)
    ) {
      event.preventDefault();
      if (!locked)
        editor.removeBehavior(
          editor.selectedBehavior.clipId,
          editor.selectedBehavior.behaviorId,
        );
    } else if (
      editor.selectedBehavior &&
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "c"
    ) {
      event.preventDefault();
      editor.copyBehavior(
        editor.selectedBehavior.clipId,
        editor.selectedBehavior.behaviorId,
      );
    } else if (
      animation &&
      selected &&
      (event.ctrlKey || event.metaKey) &&
      ["c", "x"].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      if (event.key.toLowerCase() === "c" || !locked)
        copyAnimation(selected.id, animation, event.key.toLowerCase() === "x");
    } else if (
      animation &&
      selected &&
      ["Delete", "Backspace"].includes(event.key)
    ) {
      event.preventDefault();
      if (!locked) editor.deleteAnimation(selected.id, animation);
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "a"
    ) {
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
      editor.clearAnimationClipboard();
      editor.clearBehaviorClipboard();
      clipClipboard.current = structuredClone(
        editor.project.clips.filter((c) => editor.selectedIds.includes(c.id)),
      );
      clipClipboardToken.current = uid();
      void window.framecraft
        ?.copyClipClipboard(clipClipboardToken.current)
        .catch((error) => toast(String(error)));
      toast(`已复制 ${clipClipboard.current.length} 个片段`);
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "v"
    ) {
      event.preventDefault();
      void paste();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      if (event.ctrlKey || event.metaKey) editor.jumpMedia(direction);
      else editor.stepFrame(direction);
    }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (window.framecraft && hasSession && editor.dirty)
        void window.framecraft.writeRecovery(editor.project).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
  }, [editor.project, editor.dirty, hasSession]);
  useEffect(() => {
    void (async () => {
      if (initialized.current) return;
      initialized.current = true;
      const initial = await window.framecraft?.initialProject();
      if (initial) {
        editor.replace(initial.project);
        setFile(initial.file);
        enterEditor();
        return;
      }
      await refreshHome();
    })().catch((error) => {
      setHomeLoading(false);
      toast(String(error));
    });
  }, []);
  const recover = () =>
    run(async () => {
      if (editor.dirty && !confirm("当前工程有未保存修改，确定恢复上次编辑？"))
        return;
      const result = await bridge().readRecovery();
      if (!result) {
        setRecovery(null);
        toast("没有可恢复的编辑");
        return;
      }
      editor.replace(result.project, true);
      setFile(result.file ?? "");
      enterEditor();
      toast("已恢复上次自动保存的工程");
    });
  const openRecent = (file: string) =>
    run(async () => {
      if (editor.dirty && !confirm("当前工程有未保存修改，确定打开其他工程？"))
        return;
      const result = await bridge().openRecentProject(file);
      editor.replace(result.project);
      setFile(result.file);
      enterEditor();
    });
  const recorded = (
    results: Parameters<React.ComponentProps<typeof Recorder>["onRecorded"]>[0],
  ) => {
    editor.apply((p) => {
      const tracks = [...p.tracks],
        clips: Clip[] = [];
      for (const { asset, kind } of results) {
        const track = newTrack(tracks.length);
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
          <b>TronCut</b>
        </div>
        {screen === "editor" && (
          <button
            aria-label="返回首页"
            title="返回首页"
            disabled={actionsBlocked}
            onClick={goHome}
          >
            <HomeIcon size={16} />
          </button>
        )}
        <nav
          className="header-menus"
          aria-label="主菜单"
          hidden={screen === "home"}
        >
          <button
            className="project-menu-trigger"
            disabled={actionsBlocked}
            aria-expanded={menu}
            onClick={(event) => {
              event.stopPropagation();
              setMenu(!menu);
            }}
          >
            工程
            <ChevronDown size={11} />
          </button>
          {window.framecraft && (
            <>
              <button
                disabled={actionsBlocked}
                onClick={(event) => showWindowMenu("edit", event.currentTarget)}
              >
                编辑
              </button>
              <button
                disabled={actionsBlocked}
                onClick={(event) => showWindowMenu("view", event.currentTarget)}
              >
                视图
              </button>
            </>
          )}
          {menu && !actionsBlocked && (
            <div className="project-menu" onClick={() => setMenu(false)}>
              <button onClick={() => newProject()}>
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
        </nav>
        <div className="project-title">
          {screen === "home" ? (
            <span>首页</span>
          ) : (
            <>
              <input
                aria-label="工程名称"
                disabled={actionsBlocked}
                value={editor.project.name}
                onChange={(e) => {
                  if (e.target.value.trim())
                    editor.apply((p) => ({ ...p, name: e.target.value }));
                }}
              />
              <span
                className="project-save-state"
                title={editor.dirty ? "未保存" : file ? "已保存" : "起始工程"}
              >
                {editor.dirty ? "*" : ""}
              </span>
            </>
          )}
        </div>
        <span
          className="workspace-status"
          title={
            mediaImporting
              ? "正在添加素材…"
              : caps?.ffmpeg
                ? "媒体引擎就绪"
                : window.framecraft
                  ? "媒体引擎待配置"
                  : "浏览器预览 · 文件与录屏请用桌面版"
          }
        >
          <i
            className={
              mediaImporting ? "importing" : caps?.ffmpeg ? "ready" : "pending"
            }
          />
          <span className="engine-label">
            {mediaImporting
              ? "正在添加素材…"
              : caps?.ffmpeg
                ? "媒体引擎就绪"
                : window.framecraft
                  ? "媒体引擎待配置"
                  : "浏览器预览"}
          </span>
        </span>
        <button
          className="preferences-trigger"
          title="首选项"
          aria-label="首选项"
          disabled={actionsBlocked}
          onClick={() => {
            editor.setPlaying(false);
            setPreferencesOpen(true);
          }}
        >
          <Settings2 size={16} />
          <span>首选项</span>
        </button>
        <div className="header-actions" hidden={screen === "home"}>
          <button
            className="record-button"
            disabled={actionsBlocked}
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
            disabled={actionsBlocked}
            onClick={() => void save()}
          >
            <Save size={17} />
            <span>保存</span>
          </button>
          <button
            className="export-button"
            aria-label="导出视频"
            title="导出视频 Ctrl+E"
            disabled={actionsBlocked}
            onClick={() => void exportVideo()}
          >
            导出
            <ArrowUpRight size={17} />
          </button>
        </div>
        {window.framecraft && (
          <div className="window-controls" aria-label="窗口控制">
            <button
              aria-label="最小化"
              title="最小化"
              onClick={() => void bridge().minimizeWindow()}
            >
              <Minus size={16} />
            </button>
            <button
              aria-label={
                windowState.maximized || windowState.fullscreen
                  ? "还原窗口"
                  : "最大化"
              }
              title={
                windowState.maximized || windowState.fullscreen
                  ? "还原窗口"
                  : "最大化"
              }
              onClick={() => void bridge().toggleMaximizeWindow()}
            >
              {windowState.maximized || windowState.fullscreen ? (
                <Copy size={13} />
              ) : (
                <Square size={13} />
              )}
            </button>
            <button
              className="window-close"
              aria-label="关闭窗口"
              title="关闭窗口"
              onClick={() => void bridge().closeWindow()}
            >
              <X size={17} />
            </button>
          </div>
        )}
      </header>
      {screen === "home" ? (
        <Home
          recent={recent}
          recovery={hasSession ? null : recovery}
          loading={homeLoading}
          disabled={actionsBlocked}
          onNew={() => newProject()}
          onRecord={() => newProject(true)}
          onOpen={() => void open()}
          onRecent={(file) => void openRecent(file)}
          onRecover={() => void recover()}
          onContinue={hasSession ? enterEditor : undefined}
        />
      ) : (
        <>
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
              busy={busy || mediaImporting}
              onPreferences={() => setPreferencesOpen(true)}
            />
            <Preview editor={editor} />
            <Inspector editor={editor} />
          </div>
          <Timeline
            editor={editor}
            onCopyAnimation={copyAnimation}
            onDropFiles={dropFiles}
            onCaptureFrame={() => void captureFrame()}
            dropDisabled={busy || recording || mediaImporting}
          />
        </>
      )}
      {preferencesOpen && (
        <PreferencesDialog
          onClose={() => setPreferencesOpen(false)}
          run={(fn) => void run(fn)}
          toast={toast}
          busy={busy}
        />
      )}
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
