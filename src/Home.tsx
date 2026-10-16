import {
  Circle,
  FolderOpen,
  FolderPlus,
  Film,
  Clock3,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import type { RecentProject, RecoveryInfo } from "../shared/recent-projects";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const durationLabel = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export default function Home({
  recent,
  recovery,
  loading,
  disabled,
  onNew,
  onRecord,
  onOpen,
  onRecent,
  onRemoveRecent,
  onRecover,
  onContinue,
}: {
  recent: RecentProject[];
  recovery: RecoveryInfo | null;
  loading: boolean;
  disabled: boolean;
  onNew: () => void;
  onRecord: () => void;
  onOpen: () => void;
  onRecent: (file: string) => void;
  onRemoveRecent: (file: string) => void;
  onRecover: () => void;
  onContinue?: () => void;
}) {
  const [menu, setMenu] = useState<{
    file: string;
    x: number;
    y: number;
  } | null>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!menu) return;
    menuRoot.current?.querySelector("button")?.focus();
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (!menuRoot.current?.contains(event.target as Node)) setMenu(null);
    };
    const close = () => setMenu(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);
  useEffect(() => {
    if (
      disabled ||
      (menu &&
        !recent.some(
          (project) => project.file === menu.file && project.missing,
        ))
    )
      setMenu(null);
  }, [disabled, recent, menu]);
  return (
    <div className="home-page">
      <aside className="home-sidebar">
        <div className="home-nav-selected">
          <FolderOpen size={21} />
          首页
        </div>
        <p>录制 · 剪辑 · 表达</p>
        <div className="home-sidebar-note">
          <b>TronCut</b>
          <span>把想法，变成作品。</span>
        </div>
      </aside>
      <div className="home-content">
        <div className="home-welcome">
          <div>
            <span className="home-eyebrow">开始你的下一部作品</span>
            <h1>欢迎使用 TronCut</h1>
          </div>
          {onContinue && (
            <button disabled={disabled} onClick={onContinue}>
              继续编辑
              <ArrowRight size={16} />
            </button>
          )}
        </div>
        <div className="home-actions">
          <button aria-label="新建录制" disabled={disabled} onClick={onRecord}>
            <span className="home-action-icon record">
              <Circle size={39} fill="currentColor" />
            </span>
            <b>新建录制</b>
            <span>录制屏幕、摄像头和声音</span>
          </button>
          <button aria-label="新建项目" disabled={disabled} onClick={onNew}>
            <span className="home-action-icon">
              <FolderPlus size={40} />
            </span>
            <b>新建项目</b>
            <span>从空白时间线开始创作</span>
          </button>
          <button aria-label="打开项目" disabled={disabled} onClick={onOpen}>
            <span className="home-action-icon">
              <FolderOpen size={40} />
            </span>
            <b>打开项目</b>
            <span>继续编辑已有作品</span>
          </button>
        </div>
        {recovery && (
          <div className="home-recovery">
            <RotateCcw size={22} />
            <div>
              <b>上次未保存的编辑</b>
              <p>
                {recovery.name} ·{" "}
                {new Date(recovery.modifiedAt).toLocaleString("zh-CN")} ·{" "}
                {durationLabel(recovery.duration)}
              </p>
            </div>
            <button disabled={disabled} onClick={onRecover}>
              恢复编辑
              <ArrowRight size={15} />
            </button>
          </div>
        )}
        <section
          className="home-recent"
          aria-labelledby="recent-projects-heading"
        >
          <h2 id="recent-projects-heading">
            <Clock3 size={20} />
            最近项目
            <span>{recent.length ? `${recent.length} 个项目` : ""}</span>
          </h2>
          {loading ? (
            <p className="home-empty">正在读取最近项目…</p>
          ) : recent.length ? (
            <div className="recent-project-grid">
              {recent.map((project) => (
                <button
                  className={`recent-project ${project.missing ? "missing" : ""}`}
                  key={project.file}
                  disabled={disabled}
                  aria-disabled={disabled || project.missing}
                  onClick={() => {
                    if (!project.missing) onRecent(project.file);
                  }}
                  onContextMenu={(event) => {
                    if (!project.missing || disabled) return;
                    event.preventDefault();
                    setMenu({
                      file: project.file,
                      x: Math.max(
                        8,
                        Math.min(event.clientX, window.innerWidth - 220),
                      ),
                      y: Math.max(
                        8,
                        Math.min(event.clientY, window.innerHeight - 60),
                      ),
                    });
                  }}
                  title={project.file}
                >
                  <div className="recent-project-cover">
                    {project.thumbnail ? (
                      <img src={project.thumbnail} alt="" />
                    ) : (
                      <Film size={43} />
                    )}
                    <span>{durationLabel(project.duration)}</span>
                    {project.missing && <b>文件已移动或不存在</b>}
                  </div>
                  <strong>{project.name}</strong>
                  <span className="recent-project-meta">
                    {new Date(project.modifiedAt).toLocaleDateString("zh-CN")} ·{" "}
                    {(project.bytes / 1024).toFixed(1)} KB
                  </span>
                  <span className="recent-project-path">{project.file}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="home-empty">
              <FolderOpen size={32} />
              <b>还没有最近项目</b>
              <p>新建并保存项目，或打开已有项目后，它们会显示在这里。</p>
            </div>
          )}
        </section>
      </div>
      {menu &&
        createPortal(
          <div
            ref={menuRoot}
            className="context-menu"
            role="menu"
            aria-label="最近项目操作"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              role="menuitem"
              onClick={() => {
                onRemoveRecent(menu.file);
                setMenu(null);
              }}
            >
              从最近项目中移除
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
