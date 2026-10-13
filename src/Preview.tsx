import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Maximize2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import {
  type Asset,
  type Clip,
  type Project,
  projectDuration,
} from "../shared/model";
import { transformAt, setTransform } from "../shared/editor";
import {
  defaultCrop,
  defaultEffects,
  fadeOpacity,
  previewFilter,
} from "../shared/effects";
import { cursorAt, cursorSvg, defaultCursorStyle } from "../shared/cursor";
import type { Editor } from "./useEditor";

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
}: {
  clip: Clip;
  project: Project;
  editor: Editor;
  scale: number;
  muted: boolean;
}) {
  const transform = transformAt(clip, editor.playhead - clip.start),
    asset = project.assets.find((a) => a.id === clip.assetId);
  const [drag, setDrag] = useState<{
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);
  const style: CSSProperties = {
    left: `${transform.x * 100}%`,
    top: `${transform.y * 100}%`,
    opacity:
      transform.opacity * fadeOpacity(clip, editor.playhead - clip.start),
    transform: `translate(-50%, -50%) rotate(${clip.rotation ?? 0}deg) scale(${transform.scale})`,
    "--canvas-scale": scale,
  } as CSSProperties;
  if (drag) style.translate = `${drag.dx}px ${drag.dy}px`;
  const track = project.tracks.find((t) => t.id === clip.trackId);
  let mediaWidth = 0,
    mediaHeight = 0;
  const crop = clip.crop ?? defaultCrop,
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
  const selectable = !track?.locked && clip.kind !== "audio";
  return (
    <div
      className={`preview-layer ${clip.kind} ${editor.selectedIds.includes(clip.id) ? "selected" : ""}`}
      style={style}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (!selectable || event.button !== 0) return;
        event.stopPropagation();
        editor.select(
          clip.id,
          event.ctrlKey || event.metaKey || event.shiftKey,
        );
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({ x: event.clientX, y: event.clientY, dx: 0, dy: 0 });
      }}
      onPointerMove={(event) => {
        if (drag)
          setDrag({
            ...drag,
            dx: event.clientX - drag.x,
            dy: event.clientY - drag.y,
          });
      }}
      onPointerUp={() => {
        if (drag && (drag.dx || drag.dy))
          editor.updateClip(clip.id, (c) =>
            setTransform(
              c,
              {
                x: Math.max(
                  -4,
                  Math.min(
                    4,
                    transform.x + drag.dx / (project.canvas.width * scale),
                  ),
                ),
                y: Math.max(
                  -4,
                  Math.min(
                    4,
                    transform.y + drag.dy / (project.canvas.height * scale),
                  ),
                ),
              },
              editor.playhead - clip.start,
              editor.autoAnimate,
            ),
          );
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
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
              width: mediaWidth,
              height: mediaHeight,
              position: "absolute",
              left: -mediaWidth * crop.left,
              top: -mediaHeight * crop.top,
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
                      left: (cursor.clickX ?? cursor.x) * mediaWidth,
                      top: (cursor.clickY ?? cursor.y) * mediaHeight,
                      width: cursorStyle.size * 2 * scale,
                      height: cursorStyle.size * 2 * scale,
                      borderColor: cursorStyle.color,
                    }}
                  />
                )}
                <img
                  className="cursor-overlay"
                  src={`data:image/svg+xml,${encodeURIComponent(cursorSvg(cursorStyle))}`}
                  alt="可编辑鼠标"
                  style={{
                    left: cursor.x * mediaWidth,
                    top: cursor.y * mediaHeight,
                    width: cursorStyle.size * scale,
                    height: cursorStyle.size * scale,
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
          style={{
            fontFamily: `${clip.style?.fontFamily}, "PingFang SC", sans-serif`,
            fontWeight: 700,
            fontSize: (clip.style?.fontSize ?? 68) * scale,
            color: clip.style?.color,
            WebkitTextStroke: `${(clip.style?.outlineWidth ?? 0) * scale}px ${clip.style?.outline}`,
            paintOrder: "stroke fill",
            lineHeight: 1.25,
            whiteSpace: "pre",
            textAlign: "center",
          }}
        >
          {clip.text || " "}
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
    </div>
  );
}
export default function Preview({ editor }: { editor: Editor }) {
  const holder = useRef<HTMLDivElement>(null),
    [size, setSize] = useState({ width: 700, height: 400 });
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
  const scale = Math.max(
    0.05,
    Math.min(
      size.width / project.canvas.width,
      size.height / project.canvas.height,
    ),
  );
  const active = project.clips.filter(
    (c) => playhead >= c.start && playhead < c.start + c.duration,
  );
  return (
    <section className="preview-panel">
      <div className="panel-heading">
        <span>画布预览</span>
        <span className="subtle">
          {project.canvas.width} × {project.canvas.height}
          <span className="separator-dot">·</span>
          {project.canvas.fps} fps
        </span>
      </div>
      <div
        className="canvas-holder"
        ref={holder}
        onClick={() => editor.select(null)}
      >
        <div
          className="canvas"
          style={{
            width: project.canvas.width * scale,
            height: project.canvas.height * scale,
            background: project.canvas.background,
          }}
        >
          {[...project.tracks]
            .reverse()
            .filter((t) => !t.hidden)
            .flatMap((t) =>
              active
                .filter((c) => c.trackId === t.id)
                .map((c) => (
                  <PreviewLayer
                    key={c.id}
                    clip={c}
                    project={project}
                    editor={editor}
                    scale={scale}
                    muted={t.muted}
                  />
                )),
            )}
          {!project.clips.length && (
            <div className="canvas-empty">
              <span className="empty-symbol">T</span>
              <b>你的下一部作品，从这里开始</b>
              <span>录制屏幕，或导入一段素材</span>
            </div>
          )}
        </div>
        <span className="canvas-zoom">
          适应窗口 · {Math.round(scale * 100)}%
        </span>
      </div>
      <div className="playback">
        <span className="timecode">
          {timeLabel(playhead)} <span>/ {timeLabel(duration)}</span>
        </span>
        <div className="playback-buttons">
          <button title="回到开始" onClick={() => seek(0)}>
            <SkipBack size={17} />
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
            title="跳到结尾"
            onClick={() => {
              seek(duration);
              setPlaying(false);
            }}
          >
            <SkipForward size={17} />
          </button>
        </div>
        <button
          title="全屏预览"
          onClick={() => holder.current?.requestFullscreen()}
        >
          <Maximize2 size={17} />
        </button>
      </div>
    </section>
  );
}
