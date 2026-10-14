import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  StepBack,
  StepForward,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  type Asset,
  type Clip,
  type Project,
  type Transform,
  projectDuration,
} from "../shared/model";
import { transformAt } from "../shared/editor";
import {
  defaultCrop,
  defaultEffects,
  fadeOpacity,
  previewFilter,
} from "../shared/effects";
import { cursorAt, cursorSvg, defaultCursorStyle } from "../shared/cursor";
import { cameraAt, resizeHandles, resizeTransform } from "../shared/canvas";
import { setVideoZoomPan, unzoomVideoPreview } from "../shared/video-zoom-pan";
import { resizeTextBox, textLineHeight, type TextBox } from "../shared/text";
import { textBoxFor, fittedTextFont } from "./text";
import {
  croppedTransform,
  dragCrop,
  type Crop,
  type ContentTransform,
  defaultContentTransform,
  contentLayout,
  croppedContent,
  panContent,
} from "../shared/crop";
import CanvasToolbar, {
  type CanvasMode,
  type CanvasZoom,
} from "./CanvasToolbar";
import type { Editor } from "./useEditor";
import { visualClipAt } from "../shared/visual-state";
import { annotationMime, parseAnnotation } from "../shared/annotations";

export function timeLabel(t: number): string {
  const seconds = Math.max(0, t);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}.${String(Math.floor((seconds % 1) * 100)).padStart(2, "0")}`;
}
export function useMediaUrl(asset?: Asset) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    setUrl("");
    if (asset && window.framecraft)
      window.framecraft
        .mediaUrl(asset.id)
        .then((url) => {
          if (alive) setUrl(url);
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, [asset?.id, asset?.path]);
  return url;
}
function MediaLayer({
  clip,
  asset,
  localTime,
  playing,
  muted,
  audioOnly = false,
}: {
  clip: Clip;
  asset: Asset;
  localTime: number;
  playing: boolean;
  muted: boolean;
  audioOnly?: boolean;
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null),
    url = useMediaUrl(asset);
  useEffect(() => {
    const media = ref.current;
    if (!media) return;
    const sourceTime = clip.sourceIn + localTime * clip.speed;
    if (
      Number.isFinite(media.duration) &&
      Math.abs(media.currentTime - sourceTime) > (playing ? 0.22 : 0.025)
    )
      media.currentTime = Math.min(media.duration, sourceTime);
    media.playbackRate = clip.speed;
    media.preservesPitch = true;
    media.volume = Math.min(1, clip.volume);
    media.muted = muted;
    if (playing) void media.play().catch(() => {});
    else media.pause();
  }, [localTime, playing, clip.speed, clip.sourceIn, clip.volume, muted, url]);
  if (!url || asset.missing)
    return (
      <div className="offline">
        素材离线
        <br />
        {asset.name}
      </div>
    );
  const syncLoaded = () => {
    if (ref.current)
      ref.current.currentTime = clip.sourceIn + localTime * clip.speed;
  };
  if (clip.kind === "image")
    return <img draggable={false} src={url} alt={asset.name} />;
  if (audioOnly || clip.kind === "audio")
    return (
      <audio ref={ref} src={url} onLoadedMetadata={syncLoaded} preload="auto" />
    );
  return (
    <video
      ref={ref}
      src={url}
      onLoadedMetadata={syncLoaded}
      preload="auto"
      playsInline
    />
  );
}
function PreviewLayer({
  clip,
  project,
  editor,
  scale,
  muted,
  interactive = true,
  cameraScale = 1,
  mode = "select",
}: {
  clip: Clip;
  project: Project;
  editor: Editor;
  scale: number;
  muted: boolean;
  interactive?: boolean;
  cameraScale?: number;
  mode?: CanvasMode;
}) {
  const transform = transformAt(clip, editor.playhead - clip.start),
    asset = project.assets.find((a) => a.id === clip.assetId);
  clip = visualClipAt(clip, transform);
  const editing = interactive && editor.editingTextId === clip.id;
  const textInput = useRef<HTMLTextAreaElement>(null);
  const track = project.tracks.find((t) => t.id === clip.trackId);
  useEffect(() => {
    if (editing) {
      textInput.current?.focus();
      textInput.current?.select();
    }
  }, [editing]);
  useEffect(() => {
    if (
      editing &&
      (track?.locked ||
        track?.hidden ||
        editor.selectedId !== clip.id ||
        editor.playing)
    )
      editor.endTextEdit(clip.id);
  }, [
    editing,
    track?.locked,
    track?.hidden,
    editor.selectedId,
    editor.playing,
    editor.endTextEdit,
    clip.id,
  ]);
  useEffect(
    () => () => {
      if (interactive) editor.endTextEdit(clip.id);
    },
    [editor.endTextEdit, clip.id, interactive],
  );
  const [drag, setDrag] = useState<{
    x: number;
    y: number;
    mode: "move" | "resize" | "crop" | "content";
    handle?: { x: number; y: number };
    original: Transform;
    value: Transform;
    originalBox?: TextBox;
    box?: TextBox;
    fontSize?: number;
    originalCrop?: Crop;
    crop?: Crop;
    originalContent?: ContentTransform;
    content?: ContentTransform;
  } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const setGesture = (value: typeof drag) => {
    // Pointer-up can arrive before React renders the latest pointer-move. Keep
    // the live gesture in a ref so a fast drag still commits its final position.
    dragRef.current = value;
    setDrag(value);
  };
  const displayed = drag?.value ?? transform;
  const textBox = clip.kind === "text" ? (drag?.box ?? textBoxFor(clip)) : null;
  const style: CSSProperties = {
    left: `${displayed.x * 100}%`,
    top: `${displayed.y * 100}%`,
    opacity: editing
      ? 1
      : displayed.opacity * fadeOpacity(clip, editor.playhead - clip.start),
    transform: `translate(-50%, -50%) rotateZ(${displayed.rotation ?? clip.rotation ?? 0}deg) rotateY(${displayed.rotationY ?? 0}deg) rotateX(${displayed.rotationX ?? 0}deg) scale(${displayed.scale})`,
    "--canvas-scale": scale,
  } as CSSProperties;
  if (textBox) {
    style.width = textBox.width * scale;
    style.height = textBox.height * scale;
    style.display = "flex";
    style.alignItems = "center";
    style.justifyContent = "center";
  }
  let mediaWidth = 0,
    mediaHeight = 0;
  if (clip.kind === "shape") {
    mediaWidth = 600 * scale;
    mediaHeight = 300 * scale;
    style.width = mediaWidth;
    style.height = mediaHeight;
  }
  const crop = drag?.crop ?? clip.crop ?? defaultCrop,
    effects = clip.effects ?? defaultEffects;
  const cursor = asset
    ? cursorAt(
        asset,
        clip,
        clip.sourceIn + (editor.playhead - clip.start) * clip.speed,
      )
    : null;
  const cursorStyle = clip.cursorStyle ?? defaultCursorStyle;
  if (!asset) {
    style.filter = previewFilter(clip).replace(
      `blur(${effects.blur}px)`,
      `blur(${effects.blur * scale}px)`,
    );
    style.transform += ` scale(${effects.flipX ? -1 : 1}, ${effects.flipY ? -1 : 1})`;
  }
  if (asset && clip.kind !== "audio") {
    const fit = Math.min(
      project.canvas.width / Math.max(1, asset.width),
      project.canvas.height / Math.max(1, asset.height),
    );
    mediaWidth = asset.width * fit * scale;
    mediaHeight = asset.height * fit * scale;
    style.width = mediaWidth * (1 - crop.left - crop.right);
    style.height = mediaHeight * (1 - crop.top - crop.bottom);
  }
  const selectable = interactive && !track?.locked && clip.kind !== "audio";
  const cropping =
    mode === "crop" && asset && ["image", "video"].includes(clip.kind);
  const contentView =
    drag?.mode === "crop"
      ? croppedContent(clip, crop)
      : (drag?.content ?? clip.contentTransform ?? defaultContentTransform);
  const layout = contentLayout(
    { ...clip, crop },
    { width: mediaWidth, height: mediaHeight },
    contentView,
  );
  return (
    <div
      className={`preview-layer ${clip.kind} ${interactive && editor.selectedIds.includes(clip.id) ? "selected" : ""} ${editing ? "editing" : ""} ${cropping ? "cropping" : ""}`}
      style={style}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        if (clip.kind !== "text" || editing || !selectable || mode !== "select")
          return;
        event.stopPropagation();
        setGesture(null);
        editor.beginTextEdit(clip.id);
      }}
      onPointerDown={(event) => {
        if (editing) {
          event.stopPropagation();
          return;
        }
        if (!selectable || event.button !== 0) return;
        event.stopPropagation();
        editor.setPlaying(false);
        editor.select(
          clip.id,
          event.ctrlKey || event.metaKey || event.shiftKey,
        );
        if (mode === "crop" && !cropping) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setGesture({
          x: event.clientX,
          y: event.clientY,
          mode: cropping ? "content" : "move",
          original: transform,
          value: transform,
          originalContent: clip.contentTransform ?? defaultContentTransform,
        });
      }}
      onPointerMove={(event) => {
        const gesture = dragRef.current;
        if (!gesture) return;
        const delta = {
          x: (event.clientX - gesture.x) / (scale * cameraScale),
          y: (event.clientY - gesture.y) / (scale * cameraScale),
        };
        if (gesture.mode === "content") {
          setGesture({
            ...gesture,
            content: panContent(
              clip,
              gesture.original,
              gesture.originalContent!,
              delta,
              { width: mediaWidth / scale, height: mediaHeight / scale },
            ),
          });
          return;
        }
        if (gesture.mode === "crop") {
          const sourceSize = {
            width: mediaWidth / scale,
            height: mediaHeight / scale,
          };
          const next = dragCrop(
            gesture.originalCrop!,
            gesture.original,
            delta,
            gesture.handle!,
            sourceSize,
            gesture.original.rotation ?? clip.rotation,
            effects.flipX,
            effects.flipY,
          );
          setGesture({
            ...gesture,
            crop: next,
            value: croppedTransform(
              clip,
              gesture.original,
              next,
              sourceSize,
              project.canvas,
            ),
          });
          return;
        }
        if (gesture.mode === "resize" && gesture.originalBox) {
          const resized = resizeTextBox(
            gesture.original,
            gesture.originalBox,
            delta,
            gesture.handle!,
            project.canvas,
            gesture.original.rotation ?? clip.rotation,
          );
          setGesture({
            ...gesture,
            value: resized.value,
            box: resized.box,
            fontSize: clip.autoResizeText
              ? fittedTextFont(clip, resized.box)
              : undefined,
          });
          return;
        }
        const value =
          gesture.mode === "resize"
            ? resizeTransform(
                gesture.original,
                delta,
                gesture.handle!,
                {
                  width:
                    textBox?.width ??
                    (mediaWidth * (1 - crop.left - crop.right)) / scale,
                  height:
                    textBox?.height ??
                    (mediaHeight * (1 - crop.top - crop.bottom)) / scale,
                },
                project.canvas,
                gesture.original.rotation ?? clip.rotation,
              )
            : {
                ...gesture.original,
                x: Math.max(
                  -4,
                  Math.min(
                    4,
                    gesture.original.x + delta.x / project.canvas.width,
                  ),
                ),
                y: Math.max(
                  -4,
                  Math.min(
                    4,
                    gesture.original.y + delta.y / project.canvas.height,
                  ),
                ),
              };
        setGesture({ ...gesture, value });
      }}
      onPointerUp={() => {
        const drag = dragRef.current;
        if (drag?.mode === "content") {
          if (drag.content)
            editor.updateContentTransform(clip.id, drag.content);
          setGesture(null);
          return;
        }
        if (drag?.mode === "crop" && drag.crop) {
          const crop = drag.crop;
          editor.updateCrop(clip.id, crop);
          setGesture(null);
          return;
        }
        if (
          drag &&
          (drag.original.x !== drag.value.x ||
            drag.original.y !== drag.value.y ||
            drag.original.scale !== drag.value.scale ||
            (drag.box &&
              (drag.box.width !== drag.originalBox?.width ||
                drag.box.height !== drag.originalBox?.height)))
        )
          editor.updateTransform(
            clip.id,
            {
              x: drag.value.x,
              y: drag.value.y,
              ...(drag.mode === "resize" && !drag.box
                ? { scale: drag.value.scale }
                : {}),
            },
            drag.box ? { textBox: drag.box } : {},
          );
        setGesture(null);
      }}
      onPointerCancel={() => setGesture(null)}
      onLostPointerCapture={() => setGesture(null)}
    >
      {asset ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            overflow: "hidden",
            position: "relative",
            transform: `scale(${effects.flipX ? -1 : 1}, ${effects.flipY ? -1 : 1})`,
          }}
        >
          <div
            style={{
              width: layout.width,
              height: layout.height,
              position: "absolute",
              left: layout.left,
              top: layout.top,
              filter: previewFilter(clip).replace(
                `blur(${effects.blur}px)`,
                `blur(${effects.blur * scale}px)`,
              ),
            }}
          >
            <MediaLayer
              clip={clip}
              asset={asset}
              localTime={editor.playhead - clip.start}
              playing={editor.playing}
              muted={muted}
            />
            {cursor && (
              <>
                {cursor.click && cursorStyle.clicks && (
                  <div
                    className="cursor-click"
                    style={{
                      left: (cursor.clickX ?? cursor.x) * layout.width,
                      top: (cursor.clickY ?? cursor.y) * layout.height,
                      width: cursorStyle.size * 2 * scale * contentView.scale,
                      height: cursorStyle.size * 2 * scale * contentView.scale,
                      borderColor: cursorStyle.color,
                    }}
                  />
                )}
                <img
                  className="cursor-overlay"
                  src={`data:image/svg+xml,${encodeURIComponent(cursorSvg(cursorStyle))}`}
                  alt="可编辑鼠标"
                  style={{
                    left: cursor.x * layout.width,
                    top: cursor.y * layout.height,
                    width: cursorStyle.size * scale * contentView.scale,
                    height: cursorStyle.size * scale * contentView.scale,
                    transform:
                      cursorStyle.style === "arrow"
                        ? "translate(-9%, -6%)"
                        : "translate(-50%, -50%)",
                  }}
                />
              </>
            )}
          </div>
        </div>
      ) : clip.kind === "text" ? (
        <div
          className="preview-text-content"
          style={{
            fontFamily: `${clip.style?.fontFamily}, "PingFang SC", sans-serif`,
            fontWeight: 700,
            fontSize: (drag?.fontSize ?? clip.style?.fontSize ?? 68) * scale,
            color: clip.style?.color,
            WebkitTextStroke: `${(clip.style?.outlineWidth ?? 0) * scale}px ${clip.style?.outline}`,
            paintOrder: "stroke fill",
            lineHeight: textLineHeight,
            whiteSpace: "pre",
            textAlign: "center",
          }}
        >
          {editing ? (
            <textarea
              ref={textInput}
              className="preview-text-editor"
              aria-label="画布文本内容"
              value={clip.text ?? ""}
              rows={1}
              wrap="off"
              maxLength={10000}
              spellCheck={false}
              onChange={(event) =>
                editor.updateClip(clip.id, {
                  text: event.target.value,
                  name: event.target.value.slice(0, 24) || "文本",
                })
              }
              onBlur={() => editor.endTextEdit(clip.id)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (
                  event.key === "Escape" ||
                  (event.key === "Enter" && (event.ctrlKey || event.metaKey))
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  editor.endTextEdit(clip.id);
                }
              }}
            />
          ) : (
            clip.text || " "
          )}
        </div>
      ) : (
        <svg
          width={600 * scale}
          height={300 * scale}
          viewBox="0 0 600 300"
          fill={clip.fill}
        >
          {clip.shape === "ellipse" ? (
            <ellipse cx="300" cy="150" rx="296" ry="146" />
          ) : clip.shape === "arrow" ? (
            <path d="M0 110H420V20L600 150L420 280V190H0Z" />
          ) : (
            <rect x="4" y="4" width="592" height="292" rx="24" />
          )}
        </svg>
      )}
      {selectable &&
        !editing &&
        ((mode === "select" && ["text", "shape"].includes(clip.kind)) ||
          (asset && ["image", "video"].includes(clip.kind))) &&
        editor.selectedIds.includes(clip.id) &&
        resizeHandles.map((handle) => (
          <button
            key={handle.name}
            className={`resize-handle ${cropping ? "crop-handle" : ""} ${handle.name}`}
            aria-label={`${cropping ? "裁剪" : "调整尺寸"} ${handle.name}`}
            title={
              cropping
                ? "拖动边缘裁剪素材"
                : clip.kind === "text"
                  ? "拖动调整文本框尺寸"
                  : "拖动调整尺寸（保持比例）"
            }
            style={{
              left: `${(handle.x + 1) * 50}%`,
              top: `${(handle.y + 1) * 50}%`,
              transform: `translate(-50%, -50%) scale(${1 / (displayed.scale * cameraScale)})`,
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              editor.setPlaying(false);
              event.currentTarget.setPointerCapture(event.pointerId);
              setGesture({
                x: event.clientX,
                y: event.clientY,
                mode: cropping ? "crop" : "resize",
                handle,
                original: transform,
                value: transform,
                originalCrop: cropping ? (clip.crop ?? defaultCrop) : undefined,
                originalBox:
                  editor.selectedKeyframe?.clipId === clip.id
                    ? undefined
                    : (textBox ?? undefined),
              });
            }}
          />
        ))}
    </div>
  );
}
export function ScenePreview({
  editor,
  scale,
  interactive = true,
  applyCamera = true,
  applyVideoZoomPan = true,
  mode = "select",
}: {
  editor: Editor;
  scale: number;
  interactive?: boolean;
  applyCamera?: boolean;
  applyVideoZoomPan?: boolean;
  mode?: CanvasMode;
}) {
  const { playhead } = editor;
  const project = !applyVideoZoomPan
    ? unzoomVideoPreview(editor.project, playhead)
    : editor.zoomPanDraft
      ? setVideoZoomPan(editor.project, editor.zoomPanDraft, playhead)
      : editor.project;
  const camera = applyCamera ? cameraAt(project, playhead) : null;
  const active = project.clips.filter(
    (clip) =>
      playhead >= clip.start &&
      (playhead < clip.start + clip.duration ||
        (editor.selectedKeyframe?.clipId === clip.id &&
          Math.abs(playhead - clip.start - clip.duration) < 1e-6)),
  );
  return (
    <div
      className="canvas-scene"
      style={
        camera
          ? {
              transformOrigin: "0 0",
              transform: `translate(${(0.5 - camera.x * camera.scale) * 100}%, ${(0.5 - camera.y * camera.scale) * 100}%) scale(${camera.scale})`,
            }
          : undefined
      }
    >
      {[...project.tracks]
        .reverse()
        .filter((track) => !track.hidden)
        .flatMap((track) =>
          active
            .filter((clip) => clip.trackId === track.id)
            .map((clip) => (
              <PreviewLayer
                key={clip.id}
                clip={clip}
                project={project}
                editor={editor}
                scale={scale}
                muted={!interactive || track.muted}
                interactive={interactive}
                cameraScale={camera?.scale ?? 1}
                mode={mode}
              />
            )),
        )}
    </div>
  );
}
export default function Preview({ editor }: { editor: Editor }) {
  const panel = useRef<HTMLElement>(null);
  const holder = useRef<HTMLDivElement>(null),
    [size, setSize] = useState({ width: 700, height: 400 });
  const { canvasMode: mode, setCanvasMode: setMode } = editor;
  const [zoom, setZoom] = useState<CanvasZoom>("fit");
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  useEffect(() => {
    const changed = () =>
      setFullscreen(document.fullscreenElement === panel.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === panel.current)
        await document.exitFullscreen();
      else {
        if (editor.editingTextId) editor.endTextEdit(editor.editingTextId);
        await panel.current?.requestFullscreen();
      }
      setFullscreenError("");
    } catch (error) {
      setFullscreenError(
        `全屏预览失败：${String(error).replace(/^.*?: /, "")}`,
      );
    }
  };
  const { project, playing, playhead, seek, setPlaying } = editor,
    duration = projectDuration(project);
  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setSize({
        width: entries[0].contentRect.width - 72,
        height: entries[0].contentRect.height - 72,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now(),
      at = playhead;
    let frame: number;
    const tick = () => {
      const time = at + (performance.now() - start) / 1000;
      if (time >= duration) {
        seek(duration);
        setPlaying(false);
      } else {
        seek(time);
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration, seek, setPlaying]);
  const fitScale = Math.max(
    0.01,
    Math.min(
      size.width / project.canvas.width,
      size.height / project.canvas.height,
    ),
  );
  const scale = fullscreen || zoom === "fit" ? fitScale : zoom;
  useLayoutEffect(() => {
    const element = holder.current;
    if (!element) return;
    element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
  }, [fullscreen, zoom, project.canvas.width, project.canvas.height]);
  const resetCrop = () => {
    const clip = editor.selected;
    if (clip) editor.updateCrop(clip.id, defaultCrop, true);
  };
  return (
    <section
      className="preview-panel"
      ref={panel}
      onKeyDownCapture={(event) => {
        if (fullscreen && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          void toggleFullscreen();
        }
      }}
    >
      <CanvasToolbar
        editor={editor}
        mode={mode}
        setMode={setMode}
        zoom={zoom}
        setZoom={setZoom}
        scale={fitScale}
        onResetCrop={resetCrop}
      />
      <div
        className="canvas-holder"
        ref={holder}
        onClick={() => {
          if (!fullscreen) editor.select(null);
        }}
      >
        <div
          className="canvas-stage"
          style={{
            width: project.canvas.width * scale + 72,
            height: project.canvas.height * scale + 72,
          }}
        >
          <div
            className="canvas"
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(annotationMime)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              const template = parseAnnotation(
                event.dataTransfer.getData(annotationMime),
              );
              if (!template) return;
              event.preventDefault();
              event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              const camera = cameraAt(project, editor.playhead);
              editor.addAnnotation(template, editor.playhead, undefined, {
                x:
                  camera.x +
                  ((event.clientX - bounds.left) / bounds.width - 0.5) /
                    camera.scale,
                y:
                  camera.y +
                  ((event.clientY - bounds.top) / bounds.height - 0.5) /
                    camera.scale,
              });
            }}
            style={{
              width: project.canvas.width * scale,
              height: project.canvas.height * scale,
              background: project.canvas.background,
            }}
          >
            <ScenePreview editor={editor} scale={scale} mode={mode} />
            {!project.clips.length && (
              <div className="canvas-empty">
                <span className="empty-symbol">T</span>
                <b>你的下一部作品，从这里开始</b>
                <span>录制屏幕，或导入一段素材</span>
              </div>
            )}
          </div>
        </div>
      </div>
      {fullscreenError && (
        <div className="fullscreen-error" role="alert">
          {fullscreenError}
        </div>
      )}
      <div className="playback">
        <div className="playback-buttons">
          <button
            aria-label="前一帧"
            title="前一帧（←）"
            disabled={playhead <= 0 || !duration}
            onClick={() => editor.stepFrame(-1)}
          >
            <StepBack size={17} fill="currentColor" />
          </button>
          <button
            aria-label="后一帧"
            title="后一帧（→）"
            disabled={playhead >= duration || !duration}
            onClick={() => editor.stepFrame(1)}
          >
            <StepForward size={17} fill="currentColor" />
          </button>
          <button
            className="play-button"
            title="播放 / 暂停（空格）"
            disabled={!duration}
            onClick={() => {
              if (!playing && playhead >= duration) seek(0);
              setPlaying(!playing);
            }}
          >
            {playing ? (
              <Pause size={19} fill="currentColor" />
            ) : (
              <Play size={19} fill="currentColor" />
            )}
          </button>
          <button
            aria-label="前一个媒体"
            title="前一个媒体（Ctrl/⌘ + ←）"
            disabled={playhead <= 0 || !duration}
            onClick={() => editor.jumpMedia(-1)}
          >
            <ChevronLeft size={19} />
          </button>
          <button
            aria-label="后一个媒体"
            title="后一个媒体（Ctrl/⌘ + →）"
            disabled={playhead >= duration || !duration}
            onClick={() => editor.jumpMedia(1)}
          >
            <ChevronRight size={19} />
          </button>
        </div>
        <input
          className="playback-progress"
          aria-label="播放进度"
          type="range"
          min={0}
          max={duration || 1}
          step={1 / project.canvas.fps}
          value={Math.min(playhead, duration)}
          disabled={!duration}
          onChange={(event) => {
            setPlaying(false);
            seek(Number(event.target.value));
          }}
        />
        <span className="timecode">
          {timeLabel(playhead)} <span>/ {timeLabel(duration)}</span>
        </span>
        <span className="playback-fps">{project.canvas.fps} fps</span>
        <button
          title={fullscreen ? "退出全屏预览" : "全屏预览"}
          aria-label={fullscreen ? "退出全屏预览" : "全屏预览"}
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
      </div>
    </section>
  );
}
