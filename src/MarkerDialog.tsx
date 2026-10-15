import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Marker } from "../shared/model";
import {
  legacyMarkerColor,
  markerColors,
  markerEnd,
  markerFrameTime,
} from "../shared/markers";
import { timeLabel } from "./Preview";

export default function MarkerDialog({
  marker,
  fps,
  existing,
  onSave,
  onDelete,
  onClose,
}: {
  marker: Marker;
  fps: number;
  existing: boolean;
  onSave: (marker: Marker) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [label, setLabel] = useState(marker.label);
  const [comments, setComments] = useState(marker.comments ?? "");
  const [color, setColor] = useState(marker.color ?? legacyMarkerColor);
  const [range, setRange] = useState((marker.duration ?? 0) > 0);
  const [start, setStart] = useState(String(marker.time));
  const [end, setEnd] = useState(String(markerEnd(marker) || marker.time + 1));
  const from = markerFrameTime(Number(start), fps);
  const to = markerFrameTime(Number(end), fps);
  const valid =
    start !== "" &&
    Number.isFinite(Number(start)) &&
    Number.isFinite(from) &&
    Number(start) >= 0 &&
    (!range ||
      (end !== "" &&
        Number.isFinite(Number(end)) &&
        Number.isFinite(to) &&
        to > from &&
        to - from <= 86400));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="marker-dialog"
      aria-labelledby="marker-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid)
            onSave({
              ...marker,
              label: label.trim() || "未命名标记",
              comments,
              color,
              time: from,
              duration: range ? to - from : 0,
            });
        }}
      >
        <div className="modal-heading">
          <h3 id="marker-dialog-title">{existing ? "编辑标记" : "添加标记"}</h3>
          <button type="button" aria-label="关闭标记编辑" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <label className="field">
          名称
          <input
            autoFocus
            aria-label="标记名称"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="field">
          备注
          <textarea
            aria-label="标记备注"
            rows={4}
            maxLength={10000}
            value={comments}
            onChange={(event) => setComments(event.target.value)}
            placeholder="添加剪辑说明或修改意见"
          />
        </label>
        <label className="marker-range-toggle">
          <input
            type="checkbox"
            checked={range}
            onChange={(event) => {
              setRange(event.target.checked);
              if (to <= from) setEnd(String(from + 1));
            }}
          />
          区域标记
        </label>
        <div className="marker-time-fields">
          <label className="field">
            {range ? "开始（秒）" : "位置（秒）"}
            <input
              aria-label="标记开始时间（秒）"
              type="number"
              min={0}
              step="any"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          {range && (
            <label className="field">
              结束（秒）
              <input
                aria-label="标记结束时间（秒）"
                type="number"
                min={0}
                step="any"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
            </label>
          )}
        </div>
        <p className="small-note" role="status">
          {valid
            ? `${timeLabel(from)}${range ? ` — ${timeLabel(to)} · 时长 ${timeLabel(to - from)}` : ""}`
            : "请填写有效时间，区域结束须晚于开始，时长不超过 24 小时。"}
        </p>
        <div className="marker-color-heading">颜色</div>
        <div className="marker-colors" role="group" aria-label="标记颜色">
          {markerColors.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-label={`标记颜色：${item.name}`}
              aria-pressed={color.toLowerCase() === item.value}
              title={item.name}
              style={{ background: item.value }}
              onClick={() => setColor(item.value)}
            />
          ))}
          <label className="marker-custom-color">
            自定义
            <input
              aria-label="自定义标记颜色"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
          </label>
        </div>
        <div className="marker-dialog-actions">
          {existing && (
            <button type="button" className="marker-delete" onClick={onDelete}>
              删除标记
            </button>
          )}
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            保存标记
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
