import { useEffect, useRef, useState } from "react";
import type { CameraStyle } from "../shared/recording-settings";
import { cameraClipPath } from "../shared/camera-style";

export default function CameraPreview({
  stream,
  style,
  onPosition,
}: {
  stream: MediaStream | null;
  style: CameraStyle;
  onPosition: (x: number, y: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState({ width: 1920, height: 1080 });
  useEffect(() => {
    const element = video.current!;
    element.srcObject = stream;
    if (stream) void element.play().catch(() => {});
    return () => {
      element.srcObject = null;
    };
  }, [stream]);
  return (
    <div
      className="camera-preview"
      aria-label="摄像头实时预览"
      style={{ aspectRatio: `${size.width}/${size.height}` }}
      onPointerDown={(event) => {
        if (style.preset === "rectangle") return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const box = event.currentTarget.getBoundingClientRect();
        onPosition(
          Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
          Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
        );
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const box = event.currentTarget.getBoundingClientRect();
        onPosition(
          Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
          Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
        );
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    >
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        style={{
          clipPath: cameraClipPath(style, size.width, size.height),
          transform: style.mirror ? "scaleX(-1)" : undefined,
        }}
        onLoadedMetadata={(event) =>
          setSize({
            width: event.currentTarget.videoWidth || 1920,
            height: event.currentTarget.videoHeight || 1080,
          })
        }
      />
      {!stream && <span>正在打开摄像头…</span>}
    </div>
  );
}
