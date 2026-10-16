import { useState } from "react";
import type { Clip } from "../shared/model";
import { defaultCursorStyle } from "../shared/cursor";
import CursorStyleSelect from "./CursorStyleSelect";
import NumberInput from "./NumberInput";
import {
  recordingBackgrounds,
  type RecordingSettings,
} from "../shared/recording-settings";
import { recordingWallpaperUrl } from "../shared/recording-backgrounds";
import { updateRecordingObject } from "../shared/recording-objects";
import { groupSelection } from "../shared/timeline";
import RecordingBackgroundSelect from "./RecordingBackgroundSelect";
import RoundedCornersProperties from "./RoundedCornersProperties";
import EffectSection from "./EffectSection";
import type { Editor } from "./useEditor";

export default function RecordingObjectProperties({
  clip,
  editor,
}: {
  clip: Clip;
  editor: Editor;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const settings = clip.recording!;
  const cursor = clip.cursorStyle ?? settings.cursor ?? defaultCursorStyle;
  const asset = editor.project.assets.find(
    (asset) => asset.id === clip.assetId,
  );
  const hasCursor = !!asset?.cursor;
  const background = recordingBackgrounds[settings.preset];
  async function change(patch: Partial<RecordingSettings>) {
    setError("");
    const next = { ...settings, ...patch };
    const needsBackground =
      next.background &&
      (patch.preset !== undefined ||
        (patch.background === true &&
          !editor.project.clips.some(
            (member) =>
              member.groupId === clip.groupId &&
              member.recordingRole === "background",
          )));
    try {
      setBusy(true);
      const background = needsBackground
        ? await window.framecraft!.createRecordingBackground(
            editor.project.canvas.width,
            editor.project.canvas.height,
            next.preset,
          )
        : undefined;
      editor.apply((project) =>
        updateRecordingObject(project, clip.id, patch, background),
      );
    } catch (error) {
      setError(`更新录屏样式失败：${String(error)}`);
    } finally {
      setBusy(false);
    }
  }
  const fit = asset
    ? Math.min(
        editor.project.canvas.width / asset.width,
        editor.project.canvas.height / asset.height,
      )
    : 1;
  const size = asset
    ? { width: asset.width * fit, height: asset.height * fit }
    : editor.project.canvas;
  return (
    <fieldset className="recording-object-properties" disabled={busy}>
      <EffectSection title="录屏样式">
        <RecordingBackgroundSelect
          settings={settings}
          onChange={(patch) => void change(patch)}
          label="录屏对象背景"
        />
        {settings.background && (
          <div className="recording-background-swatch" aria-label="背景预览">
            {"file" in background ? (
              background.animated ? (
                <video
                  src={recordingWallpaperUrl(background.file)}
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              ) : (
                <img
                  src={recordingWallpaperUrl(background.file)}
                  alt={background.name}
                />
              )
            ) : (
              <div
                style={{
                  background: `linear-gradient(135deg,${background.colors.join(",")})`,
                }}
              />
            )}
          </div>
        )}
        <label className="field">
          留白 (%)
          <NumberInput
            aria-label="录屏对象留白"
            min={0}
            max={25}
            disabled={!settings.background}
            value={Number((settings.padding * 100).toFixed(2))}
            onValueChange={(value) => void change({ padding: value / 100 })}
          />
        </label>
      </EffectSection>
      {clip.mediaFrame ? (
        <RoundedCornersProperties clip={clip} editor={editor} size={size} />
      ) : (
        <button
          type="button"
          onClick={() =>
            editor.updateClip(clip.id, { mediaFrame: { radius: 0 } })
          }
        >
          添加圆角
        </button>
      )}
      <EffectSection title="鼠标样式">
        <label className="field">
          鼠标样式
          <CursorStyleSelect
            label="录屏对象鼠标样式"
            disabled={!hasCursor}
            value={cursor.style}
            color={cursor.color}
            onChange={(style) =>
              void change({
                cursor: {
                  ...cursor,
                  style,
                },
              })
            }
          />
        </label>
        <label className="field">
          鼠标大小 (px)
          <input
            aria-label="录屏对象鼠标大小"
            disabled={!hasCursor}
            type="number"
            min={8}
            max={160}
            value={cursor.size}
            onChange={(event) => {
              const size = event.target.valueAsNumber;
              if (size >= 8 && size <= 160)
                void change({ cursor: { ...cursor, size } });
            }}
          />
        </label>
        <label className="field">
          鼠标颜色
          <input
            aria-label="录屏对象鼠标颜色"
            type="color"
            disabled={!hasCursor}
            value={cursor.color}
            onChange={(event) =>
              void change({ cursor: { ...cursor, color: event.target.value } })
            }
          />
        </label>
        {(["smooth", "clicks"] as const).map((name, index) => (
          <label className="check-field" key={name}>
            <input
              type="checkbox"
              disabled={!hasCursor}
              checked={cursor[name]}
              onChange={(event) =>
                void change({
                  cursor: { ...cursor, [name]: event.target.checked },
                })
              }
            />
            {index ? "点击高亮" : "平滑移动"}
          </label>
        ))}
        {!hasCursor && (
          <p className="small-note">此录屏的鼠标已包含在画面中。</p>
        )}
      </EffectSection>
      <EffectSection title="自动缩放">
        <label className="check-field">
          <input
            type="checkbox"
            disabled={!hasCursor}
            checked={settings.autoZoom}
            onChange={(event) =>
              void change({ autoZoom: event.target.checked })
            }
          />
          自动缩放并跟随鼠标
        </label>
        <label className="field">
          放大倍数
          <select
            aria-label="录屏对象放大倍数"
            disabled={!hasCursor || !settings.autoZoom}
            value={settings.zoom}
            onChange={(event) =>
              void change({ zoom: Number(event.target.value) })
            }
          >
            {[1.5, 1.8, 2, 2.5, 3].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        <label className="field recording-zoom-scope">
          自动缩放范围
          <select
            aria-label="录屏对象缩放范围"
            value={settings.zoomBackground ? "scene" : "screen"}
            onChange={(event) =>
              void change({ zoomBackground: event.target.value === "scene" })
            }
          >
            <option value="screen">仅录屏缩放，背景固定</option>
            <option value="scene">录屏和背景一起缩放</option>
          </select>
        </label>
      </EffectSection>
      {busy && (
        <p role="status" className="small-note">
          正在更新样式…
        </p>
      )}
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      <button
        type="button"
        className="recording-ungroup"
        onClick={() => {
          editor.apply((project) =>
            groupSelection(project, editor.selectedIds, true),
          );
          editor.select(clip.id);
        }}
      >
        取消组合
      </button>
      <p className="small-note">
        取消组合后，可分别编辑画面、背景、摄像头和声音。
      </p>
    </fieldset>
  );
}
