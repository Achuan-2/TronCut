import { useEffect, useRef, useState } from "react";
import { FolderOpen, X } from "lucide-react";
import type { Project } from "../shared/model";
import { projectDuration } from "../shared/model";
import {
  defaultExportFileName,
  resolvedExportSettings,
  exportDimensions,
  exportQualities,
  exportResolutions,
  videoFormats,
  videoExportFileName,
  videoExportRequestSchema,
  type ExportSettings,
  type VideoExportRequest,
} from "../shared/export-settings";

export default function ExportDialog({
  project,
  busy,
  onClose,
  onExport,
}: {
  project: Project;
  busy: boolean;
  onClose: () => void;
  onExport: (request: VideoExportRequest) => Promise<void>;
}) {
  const [settings, setSettings] = useState(() =>
    resolvedExportSettings(project.exportSettings),
  );
  const [directory, setDirectory] = useState("");
  const [fileName, setFileName] = useState(() =>
    defaultExportFileName(project.name),
  );
  const [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const focus = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    focus.current?.focus();
    if (!window.framecraft) {
      setError("导出视频需要运行桌面版");
      return;
    }
    window.framecraft
      .exportDirectory()
      .then((value) => {
        if (active) setDirectory(value);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  const change = (patch: Partial<Required<ExportSettings>>) =>
    setSettings((s) => ({ ...s, ...patch }));
  const dimensions = exportDimensions(project.canvas, settings.resolution);
  const blocked = busy || choosing;
  const request = videoExportRequestSchema.safeParse({
    directory,
    fileName,
    settings,
  });
  async function browse() {
    if (!window.framecraft) return;
    setChoosing(true);
    setError("");
    try {
      const selected = await window.framecraft.selectExportDirectory(directory);
      if (selected) setDirectory(selected);
    } catch (e) {
      setError(String(e));
    } finally {
      setChoosing(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onPointerDown={() => !blocked && onClose()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !blocked) onClose();
      }}
    >
      <form
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!request.success || blocked) return;
          setError("");
          void onExport(request.data).catch((e) =>
            setError(String(e).replace(/^Error: /, "")),
          );
        }}
      >
        <div className="modal-heading">
          <div>
            <h2 id="export-dialog-title">导出视频</h2>
            <p>选择保存位置与输出规格</p>
          </div>
          <button
            type="button"
            aria-label="关闭导出设置"
            disabled={blocked}
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </div>
        <fieldset disabled={blocked}>
          <label className="field vertical">
            导出位置
            <div className="export-directory">
              <input
                aria-label="导出位置"
                value={directory}
                placeholder="默认使用项目所在文件夹"
                onChange={(event) => setDirectory(event.target.value)}
              />
              <button type="button" onClick={() => void browse()}>
                <FolderOpen size={16} />
                浏览…
              </button>
            </div>
          </label>
          <label className="field vertical">
            文件名
            <div className="export-file-name">
              <input
                ref={focus}
                aria-label="导出文件名"
                value={fileName}
                maxLength={180}
                onChange={(event) => setFileName(event.target.value)}
              />
              <span>.{settings.format}</span>
            </div>
          </label>
          <div className="export-settings-grid">
            <label className="field vertical">
              导出分辨率
              <select
                aria-label="导出分辨率"
                value={settings.resolution}
                onChange={(event) =>
                  change({
                    resolution: event.target
                      .value as typeof settings.resolution,
                  })
                }
              >
                {Object.entries(exportResolutions).map(([id, preset]) => {
                  const size = exportDimensions(
                    project.canvas,
                    id as typeof settings.resolution,
                  );
                  return (
                    <option key={id} value={id}>
                      {preset.name} · {size.width} × {size.height}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="field vertical">
              导出质量
              <select
                aria-label="导出质量"
                value={settings.quality}
                onChange={(event) =>
                  change({
                    quality: event.target.value as typeof settings.quality,
                  })
                }
              >
                {Object.entries(exportQualities).map(([id, value]) => (
                  <option key={id} value={id}>
                    {value.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field vertical">
              导出格式
              <select
                aria-label="导出格式"
                value={settings.format}
                onChange={(event) =>
                  change({
                    format: event.target.value as typeof settings.format,
                  })
                }
              >
                {Object.entries(videoFormats).map(([id, value]) => (
                  <option key={id} value={id}>
                    {value.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="field-help">
            {exportQualities[settings.quality].description}。
            {videoFormats[settings.format].description}。
          </p>
          <div className="export-summary" aria-label="导出摘要">
            <strong>{videoExportFileName(fileName, settings.format)}</strong>
            <span>
              {dimensions.width} × {dimensions.height} · {project.canvas.fps}{" "}
              fps · {projectDuration(project).toFixed(2)} 秒
            </span>
            <small>
              保持画面比例；未保存的项目默认导出到系统“视频”文件夹。
            </small>
          </div>
        </fieldset>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        {projectDuration(project) <= 0 && (
          <p className="field-help">时间线为空，请先添加素材再导出。</p>
        )}
        {!request.success && fileName && (
          <p className="field-help">{request.error.issues[0]?.message}</p>
        )}
        <div className="export-dialog-actions">
          <button type="button" disabled={blocked} onClick={onClose}>
            取消
          </button>
          <button
            type="submit"
            className="primary"
            disabled={
              blocked || !request.success || projectDuration(project) <= 0
            }
          >
            {busy ? "正在导出…" : "开始导出"}
          </button>
        </div>
      </form>
    </div>
  );
}
