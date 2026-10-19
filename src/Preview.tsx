import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type CSSProperties,
  type ReactNode,
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
  type Clip,
  type Project,
  type Transform,
  projectDuration,
} from "../shared/model";
import { createTransformSampler } from "../shared/editor";
import {
  defaultCrop,
  defaultEffects,
  fadeOpacity,
  previewFilter,
} from "../shared/effects";
import {
  cursorAt,
  cursorSvg,
  cursorAnchor,
  cursorAspect,
  defaultCursorStyle,
} from "../shared/cursor";
import { depthScale } from "../shared/rotation";
import { mediaFrameRadii } from "../shared/media-frame";
import { recordingGroups, recordingMaster } from "../shared/recording-objects";
import {
  cameraAt,
  resizeHandles,
  resizeTransform,
  constrainMoveDelta,
  rotationDragStep,
  type DragAxis,
} from "../shared/canvas";
import { setVideoZoomPan, unzoomVideoPreview } from "../shared/video-zoom-pan";
import {
  resizeTextBox,
  textLineHeight,
  textFillCss,
  textFillGeometry,
  type TextBox,
} from "../shared/text";
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
import { useEditorPlayhead, type Editor } from "./useEditor";
import { visualClipAt } from "../shared/visual-state";
import { annotationMime, parseAnnotation } from "../shared/annotations";
import { behaviorTransform, supportsBehaviors } from "../shared/behaviors";
import {
  supportsVisualEffect,
  visualEffectFromDragTypes,
  visualEffectMime,
  type VisualEffectId,
} from "../shared/visual-effect-drag";
import { transitionTransform } from "../shared/transitions";
import { projectIndex } from "../shared/project-index";
import { sourceTimeAt } from "../shared/media-segments";
import { createPreviewMediaPlan } from "../shared/preview-media-plan";
import PreviewMedia from "./PreviewMedia";
import { visualEffectSvg } from "../shared/visual-effect-svg";
import MatteDefinition from "./MatteDefinition";
import EffectRegionOverlay from "./EffectRegionOverlay";
import type { Region } from "../shared/visual-effects";
import { effectActive } from "../shared/effect-timing";
import BehaviorText from "./BehaviorText";
import RichTextEditor from "./RichTextEditor";
import { textFormatCss } from "../shared/text-format";
import {
  annotationSvgBody,
  drawingProgress,
  shapeSize,
} from "../shared/annotation-style";
import AnnotationEffectLayer from "./AnnotationEffectLayer";
import CanvasDrawingOverlay from "./CanvasDrawingOverlay";
import ClipContextMenu, {
  type ClipCommand,
  type ClipMenuPosition,
} from "./ClipContextMenu";
import { useViewportZoom, type ZoomPoint } from "./useViewportZoom";
import { useRAFThrottle } from "./hooks/useRAFThrottle";
import {
  animationMime,
  customAnimationId,
  animationDropTarget,
} from "../shared/animation-drag";
import type { EditorPreferences } from "../shared/editor-preferences";
import { clipNeedsPreviewFrameAt } from "../shared/preview-motion";
import {
  editLine,
  linePointsFor,
  supportsLineEditing,
  type LineEdit,
  type LineHandle,
} from "../shared/line-edit";
import { LineSelection, RotationHandle } from "./CanvasSelection";

type PreviewQuality = EditorPreferences["program"]["previewQuality"];

function previewTransform(value: Transform, fallbackRotation = 0): string {
  const parts = ["translate(-50%, -50%)"];
  const rotation = value.rotation ?? fallbackRotation;
  if (rotation) parts.push(`rotateZ(${rotation}deg)`);
  if (value.rotationY) parts.push(`rotateY(${value.rotationY}deg)`);
  if (value.rotationX) parts.push(`rotateX(${value.rotationX}deg)`);
  parts.push(`scale(${value.scale * depthScale(value.z)})`);
  if (value.skew) parts.push(`skewX(${value.skew}deg)`);
  if (
    (value.scaleX !== undefined && value.scaleX !== 1) ||
    (value.scaleY !== undefined && value.scaleY !== 1)
  )
    parts.push(`scale(${value.scaleX ?? 1}, ${value.scaleY ?? 1})`);
  return parts.join(" ");
}

export function timeLabel(t: number): string {
  const seconds = Math.max(0, t);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}.${String(Math.floor((seconds % 1) * 100)).padStart(2, "0")}`;
}
function PreviewLayerImpl({
  clip,
  project,
  editor,
  scale,
  muted,
  interactive = true,
  cameraScale = 1,
  mode = "select",
  matteSource = false,
  recording,
  track,
  previewQuality,
  playhead,
  animated,
  preloading = false,
}: {
  clip: Clip;
  project: Project;
  editor: Editor;
  scale: number;
  muted: boolean;
  interactive?: boolean;
  cameraScale?: number;
  mode?: CanvasMode;
  matteSource?: boolean;
  recording?: Clip;
  track: Project["tracks"][number];
  previewQuality: PreviewQuality;
  playhead: number;
  animated: boolean;
  preloading?: boolean;
}) {
  const localTime = Math.max(0, Math.min(clip.duration, playhead - clip.start));
  const filterId = `visual-effect-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [regionDraft, setRegionDraft] = useState<{
    id: "mask" | "blur-region";
    geometry: Partial<Region>;
  } | null>(null);
  const held = playhead < clip.start || playhead >= clip.start + clip.duration;
  const selectedObjectPart =
    interactive &&
    editor.selectedIds.includes(clip.id) &&
    (!recording || recording.id === clip.id);
  const sampleTransform = useMemo(() => createTransformSampler(clip), [clip]);
  const transform = sampleTransform(localTime),
    asset = useMemo(
      () => project.assets.find((a) => a.id === clip.assetId),
      [project.assets, clip.assetId],
    );
  clip = visualClipAt(clip, transform);
  const editing = interactive && editor.editingTextId === clip.id;
  const penEditing =
    interactive &&
    editor.canvasMode === "draw" &&
    editor.penTargetId === clip.id;
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
    mode: "move" | "resize" | "crop" | "content" | "rotate" | "line";
    rotation?: { cx: number; cy: number; angle: number; raw: number };
    lineHandle?: LineHandle;
    lineSource?: Clip;
    line?: LineEdit;
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
    axis?: DragAxis | null;
    moved?: boolean;
    toggleSelectionOnClick?: boolean;
    selectMaskOnClick?: boolean;
  } | null>(null);
  const dragRef = useRef<typeof drag>(null);
  if (drag?.line) {
    clip = {
      ...clip,
      shapeSize: drag.line.shapeSize,
      linePoints: drag.line.linePoints,
    };
  }
  const lineEditable = supportsLineEditing(clip) && mode === "select";

  // RAF-throttled gesture updates for smooth 60fps dragging
  const scheduleDragUpdate = useRAFThrottle<typeof drag>(setDrag);

  const setGesture = useCallback(
    (value: typeof drag) => {
      // Pointer-up can arrive before React renders the latest pointer-move. Keep
      // the live gesture in a ref so a fast drag still commits its final position.
      dragRef.current = value;
      scheduleDragUpdate(value);
    },
    [scheduleDragUpdate],
  );
  const displayed = editing
    ? (drag?.value ?? transform)
    : transitionTransform(
        project,
        clip,
        behaviorTransform(clip, drag?.value ?? transform, localTime),
        playhead,
      );
  const textBox = clip.kind === "text" ? (drag?.box ?? textBoxFor(clip)) : null;
  const fill = textBox ? textFillGeometry(clip.style, textBox) : null;
  const style: CSSProperties = {
    left: `${displayed.x * 100}%`,
    top: `${displayed.y * 100}%`,
    opacity: editing ? 1 : displayed.opacity * fadeOpacity(clip, localTime),
    transform: previewTransform(displayed, clip.rotation ?? 0),
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
    mediaWidth = shapeSize(clip).width * scale;
    mediaHeight = shapeSize(clip).height * scale;
    style.width = mediaWidth;
    style.height = mediaHeight;
  }
  const crop = drag?.crop ?? clip.crop ?? defaultCrop,
    effects = clip.effects ?? defaultEffects;
  const cursor = asset
    ? cursorAt(asset, clip, sourceTimeAt(clip, localTime))
    : null;
  const cursorStyle = clip.cursorStyle ?? defaultCursorStyle;
  if (!asset) {
    style.filter = previewFilter(clip).replace(
      `blur(${effects.blur}px)`,
      `blur(${effects.blur * scale}px)`,
    );
    style.transform += ` scale(${effects.flipX ? -1 : 1}, ${effects.flipY ? -1 : 1})`;
    if (clip.annotationEffect) {
      style.filter = undefined;
      style.opacity = 1;
    }
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
  let radii = mediaFrameRadii(
    clip,
    {
      width: (mediaWidth * (1 - crop.left - crop.right)) / scale,
      height: (mediaHeight * (1 - crop.top - crop.bottom)) / scale,
    },
    localTime,
  );
  if (effects.flipX) radii = [radii[1], radii[0], radii[3], radii[2]];
  if (effects.flipY) radii = [radii[3], radii[2], radii[1], radii[0]];
  const selectable =
    interactive && !track?.locked && clip.kind !== "audio" && mode !== "draw";
  const [effectDrop, setEffectDrop] = useState(false);
  useEffect(() => {
    if (!effectDrop) return;
    const clear = () => setEffectDrop(false);
    window.addEventListener("dragend", clear, true);
    window.addEventListener("drop", clear, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("dragend", clear, true);
      window.removeEventListener("drop", clear, true);
      window.removeEventListener("blur", clear);
    };
  }, [effectDrop]);
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
  const effectTime = Object.values(clip.visualEffects ?? {}).some(
    (effect) => effect?.easeIn || effect?.easeOut || effect?.window,
  )
    ? localTime
    : 0;
  const effectMarkup = useMemo(
    () =>
      visualEffectSvg(
        regionDraft
          ? {
              ...clip,
              visualEffects: {
                ...clip.visualEffects,
                [regionDraft.id]: {
                  ...clip.visualEffects?.[regionDraft.id],
                  ...regionDraft.geometry,
                },
              },
            }
          : clip,
        Number(style.width) || 1,
        Number(style.height) || 1,
        scale,
        effectTime,
        filterId,
      ),
    [
      clip.visualEffects,
      clip.style,
      clip.duration,
      style.width,
      style.height,
      scale,
      effectTime,
      filterId,
      regionDraft,
    ],
  );
  const selectedRegion =
    editor.selectedVisualEffect?.clipId === clip.id
      ? editor.selectedVisualEffect.id
      : undefined;
  const regionId =
    (selectedRegion === "mask" || selectedRegion === "blur-region") &&
    clip.visualEffects?.[selectedRegion]?.enabled
      ? selectedRegion
      : (Object.keys(clip.visualEffects ?? {})
          .reverse()
          .find(
            (id) =>
              (id === "mask" || id === "blur-region") &&
              clip.visualEffects?.[id]?.enabled,
          ) as "mask" | "blur-region" | undefined);
  return (
    <div
      className={`preview-layer ${clip.kind} ${selectedObjectPart ? "selected" : ""} ${editing ? "editing" : ""} ${cropping ? "cropping" : ""} ${lineEditable && interactive ? "line-editable" : ""} ${effectDrop && selectable ? "effect-drop-target" : ""}`}
      data-clip-id={clip.id}
      data-preview-animated={animated ? "1" : "0"}
      data-preview-preloading={preloading ? "1" : undefined}
      style={
        preloading || penEditing
          ? { ...style, visibility: "hidden", pointerEvents: "none" }
          : style
      }
      onDragOver={(event) => {
        if (!interactive) return;
        const behavior = event.dataTransfer.types.includes("troncut-behavior");
        const effect = event.dataTransfer.types.includes(visualEffectMime);
        const animation = event.dataTransfer.types.includes(animationMime);
        if (!behavior && !effect && !animation) return;
        event.preventDefault();
        event.stopPropagation();
        const allowed =
          selectable &&
          (animation
            ? !!animationDropTarget(
                project,
                clip.id,
                editor.playhead,
                editor.preferences.timing.animation,
              )
            : behavior
              ? supportsBehaviors(clip) && (clip.behaviors?.length ?? 0) < 32
              : supportsVisualEffect(
                  clip,
                  visualEffectFromDragTypes(event.dataTransfer.types),
                ));
        event.dataTransfer.dropEffect = allowed ? "copy" : "none";
        setEffectDrop(allowed);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setEffectDrop(false);
      }}
      onDrop={(event) => {
        if (!interactive) return;
        const behavior = event.dataTransfer.getData("troncut-behavior");
        const effect = event.dataTransfer.getData(visualEffectMime);
        const animation = event.dataTransfer.types.includes(animationMime);
        if (!behavior && !effect && !animation) return;
        event.preventDefault();
        event.stopPropagation();
        setEffectDrop(false);
        if (!selectable) return;
        if (animation) {
          if (event.dataTransfer.getData(animationMime) === customAnimationId)
            editor.addCustomAnimation(clip.id);
        } else if (behavior) {
          if (supportsBehaviors(clip)) editor.addBehavior(behavior, clip.id);
        } else if (supportsVisualEffect(clip, effect)) {
          editor.addVisualEffect(effect as VisualEffectId, clip.id);
        }
      }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        if (clip.kind !== "text" || editing || !selectable || mode !== "select")
          return;
        event.stopPropagation();
        setGesture(null);
        editor.beginTextEdit(clip.id);
      }}
      onPointerDown={(event) => {
        if (recording && recording.id !== clip.id && event.button === 0) {
          event.stopPropagation();
          editor.select(recording.id);
          return;
        }
        if (editing) {
          event.stopPropagation();
          return;
        }
        if (!selectable || event.button !== 0) return;
        event.stopPropagation();
        editor.setPlaying(false);
        // Shift-click still toggles selection. Defer removing a selected object
        // until release so Shift-drag can constrain it without deselecting it.
        const toggleSelectionOnClick =
          event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          selectedObjectPart;
        if (!toggleSelectionOnClick)
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
          toggleSelectionOnClick,
          selectMaskOnClick:
            mode === "select" &&
            regionId === "mask" &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !!(event.target as Element).closest("[data-region-move-only]"),
        });
      }}
      onPointerMove={(event) => {
        const previous = dragRef.current;
        if (!previous) return;
        const screenDelta = {
          x: event.clientX - previous.x,
          y: event.clientY - previous.y,
        };
        const gesture = {
          ...previous,
          moved:
            previous.moved || Math.hypot(screenDelta.x, screenDelta.y) >= 3,
        };
        const constrained =
          gesture.mode === "move"
            ? constrainMoveDelta(screenDelta, event.shiftKey, gesture.axis)
            : { ...screenDelta, axis: null };
        const delta = {
          x: constrained.x / (scale * cameraScale),
          y: constrained.y / (scale * cameraScale),
        };
        if (gesture.mode === "rotate" && gesture.rotation) {
          const { cx, cy } = gesture.rotation;
          if (Math.hypot(event.clientX - cx, event.clientY - cy) < 4) return;
          const angle = Math.atan2(event.clientY - cy, event.clientX - cx);
          const raw = rotationDragStep(
            gesture.rotation.raw,
            gesture.rotation.angle,
            angle,
          );
          setGesture({
            ...gesture,
            rotation: { cx, cy, angle, raw },
            value: {
              ...gesture.original,
              rotation: event.shiftKey
                ? Math.round(raw / 15) * 15
                : Math.round(raw * 10) / 10,
            },
          });
          return;
        }
        if (gesture.mode === "line") {
          const line = editLine(
            gesture.lineSource!,
            gesture.original,
            gesture.lineHandle!,
            delta,
            project.canvas,
            event.shiftKey,
          );
          setGesture({ ...gesture, line, value: line.value });
          return;
        }
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
                clip.lockAspectRatio !== false,
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
        setGesture({ ...gesture, value, axis: constrained.axis });
      }}
      onPointerUp={() => {
        const drag = dragRef.current;
        if (drag?.mode === "rotate") {
          if (
            (drag.value.rotation ?? clip.rotation ?? 0) !==
            (drag.original.rotation ?? clip.rotation ?? 0)
          )
            editor.updateTransform(clip.id, { rotation: drag.value.rotation });
          setGesture(null);
          return;
        }
        if (drag?.mode === "line") {
          if (drag.moved && drag.line)
            editor.updateTransform(
              clip.id,
              { x: drag.value.x, y: drag.value.y },
              {
                shapeSize: drag.line.shapeSize,
                linePoints: drag.line.linePoints,
              },
            );
          setGesture(null);
          return;
        }
        if (drag?.toggleSelectionOnClick && !drag.moved) {
          editor.select(clip.id, true);
          setGesture(null);
          return;
        }
        if (drag?.selectMaskOnClick && !drag.moved) {
          editor.setSelectedVisualEffect({ clipId: clip.id, id: "mask" });
          setGesture(null);
          return;
        }
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
            (drag.original.scaleX ?? 1) !== (drag.value.scaleX ?? 1) ||
            (drag.original.scaleY ?? 1) !== (drag.value.scaleY ?? 1) ||
            (drag.box &&
              (drag.box.width !== drag.originalBox?.width ||
                drag.box.height !== drag.originalBox?.height)))
        )
          editor.updateTransform(
            clip.id,
            {
              ...(drag.mode !== "move" || drag.original.x !== drag.value.x
                ? { x: drag.value.x }
                : {}),
              ...(drag.mode !== "move" || drag.original.y !== drag.value.y
                ? { y: drag.value.y }
                : {}),
              ...(drag.mode === "resize" && !drag.box
                ? {
                    scale: drag.value.scale,
                    ...(drag.value.scaleX === undefined
                      ? {}
                      : { scaleX: drag.value.scaleX }),
                    ...(drag.value.scaleY === undefined
                      ? {}
                      : { scaleY: drag.value.scaleY }),
                  }
                : {}),
            },
            drag.box ? { textBox: drag.box } : {},
          );
        setGesture(null);
      }}
      onPointerCancel={() => setGesture(null)}
      onLostPointerCapture={() => setGesture(null)}
    >
      {effectMarkup && (
        <svg className="effect-svg-definitions" aria-hidden="true">
          <defs dangerouslySetInnerHTML={{ __html: effectMarkup }} />
        </svg>
      )}
      <div
        className="preview-effect-content"
        style={
          effectMarkup || matteSource
            ? {
                width: "100%",
                height: "100%",
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                filter: effectMarkup ? `url(#${filterId})` : undefined,
                visibility: matteSource ? "hidden" : undefined,
              }
            : { display: "contents" }
        }
      >
        {fill && (
          <div
            className="preview-text-fill"
            aria-hidden="true"
            style={{
              position: "absolute",
              left: -fill.paddingX * scale,
              top: -fill.paddingY * scale,
              width: fill.width * scale,
              height: fill.height * scale,
              borderRadius: fill.radius * scale,
              backgroundColor: textFillCss(clip.style),
              zIndex: -1,
            }}
          />
        )}
        {asset ? (
          <div
            style={{
              width: "100%",
              height: "100%",
              overflow: "hidden",
              borderRadius: radii
                .map((radius) => `${radius * scale}px`)
                .join(" "),
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
              <PreviewMedia
                clip={clip}
                asset={asset}
                localTime={
                  held
                    ? Math.max(
                        0,
                        Math.min(
                          clip.duration - 1 / project.canvas.fps,
                          localTime,
                        ),
                      )
                    : localTime
                }
                playing={editor.playing && !held}
                muted={muted || held}
                previewQuality={previewQuality}
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
                        height:
                          cursorStyle.size * 2 * scale * contentView.scale,
                        borderColor: cursorStyle.color,
                      }}
                    />
                  )}
                  <img
                    className="cursor-overlay"
                    src={`data:image/svg+xml,${encodeURIComponent(cursorSvg(cursorStyle, cursor.cursorType))}`}
                    alt="可编辑鼠标"
                    style={{
                      left: cursor.x * layout.width,
                      top: cursor.y * layout.height,
                      width:
                        cursorStyle.size *
                        cursorAspect(cursorStyle.style, cursor.cursorType) *
                        scale *
                        contentView.scale,
                      height: cursorStyle.size * scale * contentView.scale,
                      transform: `translate(-${cursorAnchor(cursorStyle.style, cursor.cursorType).x * 100}%, -${cursorAnchor(cursorStyle.style, cursor.cursorType).y * 100}%)`,
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
              ...textFormatCss(clip.style),
              // Decorations propagate through descendants and cannot be cancelled
              // by a run, so styled/editor spans own their underlines.
              textDecoration:
                editing || clip.behaviors?.length || clip.textRuns?.length
                  ? "none"
                  : textFormatCss(clip.style).textDecoration,
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
              <RichTextEditor
                clip={clip}
                scale={scale}
                onChange={(text) =>
                  editor.updateClip(clip.id, {
                    text,
                    name: text.slice(0, 24) || "文本",
                  })
                }
                onSelection={(range) =>
                  editor.setTextSelection(
                    range ? { ...range, clipId: clip.id } : null,
                  )
                }
                onEnd={() => editor.endTextEdit(clip.id)}
                onUndo={editor.undo}
                onRedo={editor.redo}
              />
            ) : clip.behaviors?.length || clip.textRuns?.length ? (
              <BehaviorText clip={clip} time={localTime} scale={scale} />
            ) : (
              clip.text || " "
            )}
          </div>
        ) : clip.annotationEffect ? (
          <AnnotationEffectLayer
            clip={clip}
            width={mediaWidth}
            height={mediaHeight}
            scale={scale / Math.max(0.05, displayed.scale)}
            opacity={displayed.opacity * fadeOpacity(clip, localTime)}
            canvas={project.canvas}
            pose={displayed}
            canvasScale={scale}
          />
        ) : (
          <svg
            className={lineEditable ? "preview-line-art" : undefined}
            width={shapeSize(clip).width * scale}
            height={shapeSize(clip).height * scale}
            viewBox={`0 0 ${shapeSize(clip).width} ${shapeSize(clip).height}`}
            fill={clip.fill}
            dangerouslySetInnerHTML={{
              __html: annotationSvgBody(
                clip,
                selectedObjectPart &&
                  !editor.playing &&
                  !matteSource &&
                  editor.canvasMode === "draw"
                  ? 1
                  : drawingProgress(clip, localTime),
              ),
            }}
          />
        )}
      </div>
      {lineEditable && selectable && !editing && (
        <LineSelection
          points={linePointsFor(clip)}
          size={shapeSize(clip)}
          pose={displayed}
          scale={scale}
          cameraScale={cameraScale}
          selected={selectedObjectPart}
          onHandleDown={(handle, event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            editor.setPlaying(false);
            event.currentTarget.setPointerCapture(event.pointerId);
            setGesture({
              x: event.clientX,
              y: event.clientY,
              mode: "line",
              lineHandle: handle,
              lineSource: clip,
              original: transform,
              value: transform,
            });
          }}
        />
      )}
      {selectable && !editing && mode === "select" && selectedObjectPart && (
        <RotationHandle
          pose={displayed}
          cameraScale={cameraScale}
          angle={drag?.mode === "rotate" ? drag.value.rotation : undefined}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            editor.setPlaying(false);
            const rect =
              event.currentTarget.parentElement!.getBoundingClientRect();
            const cx = rect.x + rect.width / 2,
              cy = rect.y + rect.height / 2;
            event.currentTarget.setPointerCapture(event.pointerId);
            setGesture({
              x: event.clientX,
              y: event.clientY,
              mode: "rotate",
              original: transform,
              value: transform,
              rotation: {
                cx,
                cy,
                angle: Math.atan2(event.clientY - cy, event.clientX - cx),
                raw: transform.rotation ?? clip.rotation ?? 0,
              },
            });
          }}
        />
      )}
      {regionId &&
        selectable &&
        !editing &&
        !editor.playing &&
        mode === "select" &&
        selectedObjectPart && (
          <EffectRegionOverlay
            key={`${clip.id}-${regionId}`}
            name={regionId === "mask" ? "遮罩" : "模糊区域"}
            moveHandleOnly={regionId === "mask"}
            showMoveHandle={
              editor.selectedVisualEffect?.clipId === clip.id &&
              editor.selectedVisualEffect.id === regionId
            }
            onSelect={() =>
              editor.setSelectedVisualEffect({ clipId: clip.id, id: regionId })
            }
            region={clip.visualEffects![regionId]!}
            width={Number(style.width) || 1}
            height={Number(style.height) || 1}
            pose={displayed}
            cameraScale={cameraScale}
            canvasScale={scale}
            onDraft={(geometry) =>
              setRegionDraft(geometry ? { id: regionId, geometry } : null)
            }
            onCommit={(geometry) =>
              regionId === "mask"
                ? editor.updateMask(clip.id, geometry)
                : editor.updateClip(clip.id, (source) => ({
                    ...source,
                    visualEffects: {
                      ...source.visualEffects,
                      [regionId]: {
                        ...source.visualEffects![regionId]!,
                        ...geometry,
                      },
                    },
                  }))
            }
          />
        )}
      {selectable &&
        !editing &&
        ((mode === "select" && ["text", "shape"].includes(clip.kind)) ||
          (asset && ["image", "video"].includes(clip.kind))) &&
        selectedObjectPart &&
        !lineEditable &&
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
                  : clip.lockAspectRatio === false
                    ? "拖动独立调整宽高"
                    : "拖动调整尺寸（保持比例）"
            }
            style={{
              left: `${(handle.x + 1) * 50}%`,
              top: `${(handle.y + 1) * 50}%`,
              transform: `translate(-50%, -50%) scale(${1 / (displayed.scale * (displayed.scaleX ?? 1) * depthScale(displayed.z) * cameraScale)}, ${1 / (displayed.scale * (displayed.scaleY ?? 1) * depthScale(displayed.z) * cameraScale)})`,
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

const PreviewLayer = memo(
  PreviewLayerImpl,
  (previous, next) =>
    previous.clip === next.clip &&
    previous.project === next.project &&
    previous.editor === next.editor &&
    previous.scale === next.scale &&
    previous.muted === next.muted &&
    previous.interactive === next.interactive &&
    (!next.animated || previous.cameraScale === next.cameraScale) &&
    previous.mode === next.mode &&
    previous.matteSource === next.matteSource &&
    previous.recording === next.recording &&
    previous.track === next.track &&
    previous.previewQuality === next.previewQuality &&
    previous.animated === next.animated &&
    previous.preloading === next.preloading &&
    (!next.animated || previous.playhead === next.playhead),
);

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
  const previewQuality = editor.preferences.program.previewQuality;
  const project = !applyVideoZoomPan
    ? unzoomVideoPreview(editor.project, playhead)
    : editor.zoomPanDraft
      ? setVideoZoomPan(editor.project, editor.zoomPanDraft, playhead)
      : editor.project;
  const camera = applyCamera ? cameraAt(project, playhead) : null;
  const active = projectIndex(editor.project).active(
    editor.project,
    playhead,
    editor.selectedKeyframe?.clipId ?? editor.selectedDrawing?.clipId,
    project.clips,
  );
  const sceneId = `scene-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const tracksById = useMemo(
    () => new Map(project.tracks.map((track) => [track.id, track])),
    [project.tracks],
  );
  const assetsById = useMemo(
    () => new Map(project.assets.map((asset) => [asset.id, asset])),
    [project.assets],
  );
  const selectedIds = useMemo(
    () => new Set(editor.selectedIds),
    [editor.selectedIds],
  );
  const recordingsByClip = useMemo(() => {
    const groups = recordingGroups(project);
    return new Map(
      project.clips.map((clip) => [
        clip.id,
        clip.groupId ? groups.get(clip.groupId) : undefined,
      ]),
    );
  }, [project.clips]);
  const mediaPlan = useMemo(
    () => createPreviewMediaPlan(project),
    [project.clips, project.tracks],
  );
  const activeByTrack = new Map<string, Clip[]>();
  for (const clip of active) {
    const clips = activeByTrack.get(clip.trackId);
    if (clips) clips.push(clip);
    else activeByTrack.set(clip.trackId, [clip]);
  }
  const hasSolo = project.tracks.some((track) => track.solo);
  const definitions: ReactNode[] = [];
  let layers: ReactNode[] = [];
  const activeTracks = new Set(
    project.tracks
      .filter((track) => !track.hidden && (!hasSolo || track.solo))
      .map((track) => track.id),
  );
  const upcoming = mediaPlan
    .upcoming(playhead, new Set(active.map(mediaPlan.key)), activeTracks)
    .filter((clip) => !assetsById.get(clip.assetId!)?.missing);
  const preloadingIds = new Set(upcoming.map((clip) => clip.id));
  for (const clip of upcoming) {
    const clips = activeByTrack.get(clip.trackId);
    if (clips) clips.push(clip);
    else activeByTrack.set(clip.trackId, [clip]);
  }
  for (const track of [...project.tracks].reverse()) {
    if (track.hidden || (hasSolo && !track.solo)) continue;
    for (const clip of activeByTrack.get(track.id) ?? []) {
      const asset = clip.assetId ? assetsById.get(clip.assetId) : undefined;
      const matteEffect = clip.visualEffects?.["media-matte"];
      const preloading = preloadingIds.has(clip.id);
      const matte =
        !preloading &&
        !!matteEffect &&
        effectActive(matteEffect, playhead - clip.start, clip.duration);
      if (matte) {
        const id = `${sceneId}-matte-${clip.id}`;
        definitions.push(
          <MatteDefinition
            key={id}
            id={id}
            clip={clip}
            project={project}
            time={playhead}
            scale={scale}
          />,
        );
        layers = [
          <div
            className="matte-layer-group"
            key={id}
            style={{ mask: `url(#${id})` }}
          >
            {layers}
          </div>,
        ];
      }
      layers.push(
        <PreviewLayer
          key={mediaPlan.key(clip)}
          clip={clip}
          project={project}
          editor={editor}
          scale={scale}
          muted={
            !interactive || track.muted || !!editor.narrationRecording?.muted
          }
          interactive={interactive && !preloading}
          cameraScale={camera?.scale ?? 1}
          mode={mode}
          matteSource={matte}
          recording={recordingsByClip.get(clip.id)}
          track={tracksById.get(clip.trackId) ?? track}
          previewQuality={previewQuality}
          preloading={preloading}
          playhead={playhead}
          animated={
            !preloading &&
            (selectedIds.has(clip.id) ||
              clipNeedsPreviewFrameAt(clip, asset, playhead - clip.start))
          }
        />,
      );
    }
  }
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
      {definitions}
      {layers}
    </div>
  );
}
export default function Preview({
  editor,
  onCommand,
  onPreviewQualityChange,
}: {
  editor: Editor;
  onCommand: (command: ClipCommand) => void;
  onPreviewQualityChange: (quality: PreviewQuality) => void;
}) {
  const playhead = useEditorPlayhead(editor);
  const panel = useRef<HTMLElement>(null);
  const holder = useRef<HTMLDivElement>(null),
    [size, setSize] = useState({ width: 700, height: 400 });
  const { canvasMode: mode, setCanvasMode: setMode } = editor;
  const [zoom, setZoom] = useState<CanvasZoom>("fit");
  const [contextMenu, setContextMenu] = useState<ClipMenuPosition | null>(null);
  const [animationHover, setAnimationHover] = useState(false);
  useEffect(() => {
    if (!animationHover) return;
    const clear = () => setAnimationHover(false);
    window.addEventListener("dragend", clear, true);
    window.addEventListener("drop", clear, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("dragend", clear, true);
      window.removeEventListener("drop", clear, true);
      window.removeEventListener("blur", clear);
    };
  }, [animationHover]);
  useEffect(() => {
    const initial = editor.preferences.program.previewZoom;
    setZoom(initial === "fit" ? "fit" : Number(initial));
  }, [editor.preferences.program.previewZoom, editor.project.id]);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const zoomAnchor = useRef<{ x: number; y: number; point: ZoomPoint } | null>(
    null,
  );
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
  const { project, playing, seek, advancePlayback, setPlaying } = editor,
    duration = useMemo(() => projectDuration(project), [project.clips]);
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
    const fps = Math.max(1, project.canvas.fps);
    let renderedFrame = -1;
    const tick = (now: number) => {
      const frameIndex = Math.floor(((now - start) * fps) / 1000 + 1e-6);
      if (frameIndex > renderedFrame) {
        renderedFrame = frameIndex;
        const time = Math.min(duration, at + frameIndex / fps);
        advancePlayback(time);
        if (time >= duration) {
          setPlaying(false);
          return;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration, project.canvas.fps, advancePlayback, setPlaying]);
  const fitScale = Math.max(
    0.01,
    Math.min(
      size.width / project.canvas.width,
      size.height / project.canvas.height,
    ),
  );
  const scale = fullscreen || zoom === "fit" ? fitScale : zoom;
  useViewportZoom(
    panel,
    (factor, point) => {
      const element = holder.current;
      const canvas = element?.querySelector<HTMLElement>(".canvas");
      if (!element || !canvas) return;
      const next = Math.max(0.05, Math.min(20, scale * factor));
      if (next === scale) return;
      const bounds = canvas.getBoundingClientRect();
      const viewport = element.getBoundingClientRect();
      const anchor = point ?? {
        x: viewport.left + element.clientWidth / 2,
        y: viewport.top + element.clientHeight / 2,
      };
      zoomAnchor.current = {
        x: (anchor.x - bounds.left) / scale,
        y: (anchor.y - bounds.top) / scale,
        point: anchor,
      };
      setZoom(next);
    },
    !fullscreen,
  );
  useLayoutEffect(() => {
    const element = holder.current;
    if (!element) return;
    const anchor = zoomAnchor.current;
    const bounds = element.querySelector(".canvas")?.getBoundingClientRect();
    if (anchor && bounds) {
      element.scrollLeft += bounds.left + anchor.x * scale - anchor.point.x;
      element.scrollTop += bounds.top + anchor.y * scale - anchor.point.y;
      zoomAnchor.current = null;
    } else {
      element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
      element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
    }
  }, [fullscreen, zoom, project.canvas.width, project.canvas.height]);
  const resetCrop = () => {
    const clip = editor.selected;
    if (clip) editor.updateCrop(clip.id, defaultCrop, true);
  };
  const canvasAnimationTarget = (target: EventTarget) => {
    const hit = (target as HTMLElement).closest<HTMLElement>(
      ".preview-layer[data-clip-id]",
    );
    const id = hit?.dataset.clipId ?? editor.selectedId;
    return !fullscreen && id
      ? animationDropTarget(
          project,
          id,
          editor.playhead,
          editor.preferences.timing.animation,
        )
      : null;
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
        onContextMenu={(event) => {
          if (
            fullscreen ||
            (event.target as HTMLElement).closest(
              'textarea, input, [contenteditable="true"]',
            )
          )
            return;
          event.preventDefault();
          const hit = (event.target as HTMLElement).closest<HTMLElement>(
            ".preview-layer[data-clip-id]",
          );
          const clipId = hit?.dataset.clipId;
          const id = clipId
            ? (recordingMaster(project, clipId)?.id ?? clipId)
            : null;
          editor.setPlaying(false);
          if (editor.editingTextId) editor.endTextEdit(editor.editingTextId);
          const previous = editor.selectedIds;
          if (id || previous.length < 2) {
            editor.select(id);
            if (id && previous.includes(id)) editor.selectMany(previous);
          }
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            clipId: id ?? (previous.length > 1 ? previous.at(-1)! : null),
          });
        }}
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
            className={`canvas ${animationHover ? "animation-drop-target" : ""}`}
            onDragOverCapture={(event) => {
              if (event.dataTransfer.types.includes(animationMime))
                setAnimationHover(!!canvasAnimationTarget(event.target));
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(animationMime)) {
                event.preventDefault();
                const target = canvasAnimationTarget(event.target);
                event.dataTransfer.dropEffect = target ? "copy" : "none";
                setAnimationHover(!!target);
                return;
              }
              if (!event.dataTransfer.types.includes(annotationMime)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              if (event.dataTransfer.types.includes(animationMime)) {
                event.preventDefault();
                event.stopPropagation();
                setAnimationHover(false);
                if (
                  !fullscreen &&
                  editor.selectedId &&
                  event.dataTransfer.getData(animationMime) ===
                    customAnimationId
                )
                  editor.addCustomAnimation(editor.selectedId);
                return;
              }
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
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setAnimationHover(false);
            }}
            style={{
              width: project.canvas.width * scale,
              height: project.canvas.height * scale,
              background: project.canvas.background,
            }}
          >
            <ScenePreview editor={editor} scale={scale} mode={mode} />
            {mode === "draw" && !fullscreen && (
              <CanvasDrawingOverlay editor={editor} />
            )}
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
      <ClipContextMenu
        editor={editor}
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onCommand={onCommand}
        portalTarget={panel.current}
      />
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
        <label className="preview-quality" title="预览画质设置">
          <select
            aria-label="预览画质"
            value={editor.preferences.program.previewQuality}
            onChange={(event) =>
              onPreviewQualityChange(event.target.value as PreviewQuality)
            }
          >
            <option value="smooth">流畅画质</option>
            <option value="original">原画画质</option>
          </select>
        </label>
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
