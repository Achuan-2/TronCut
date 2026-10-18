import { useCallback, useEffect, useRef, useState } from "react";

/** Settings, recorder and floating preview share one device acquisition. */
export function useCameraPreview(enabled: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const current = useRef<MediaStream | null>(null);
  const pending = useRef<Promise<MediaStream> | null>(null);
  const generation = useRef(0);
  const acquire = useCallback(() => {
    if (
      current.current
        ?.getVideoTracks()
        .some((track) => track.readyState === "live")
    )
      return Promise.resolve(current.current);
    if (pending.current) return pending.current;
    const token = generation.current;
    const request = navigator.mediaDevices
      .getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: 30,
        },
        audio: false,
      })
      .then((stream) => {
        if (token !== generation.current) {
          stream.getTracks().forEach((track) => track.stop());
          throw new Error("摄像头预览已关闭");
        }
        current.current = stream;
        setStream(stream);
        setError("");
        return stream;
      })
      .finally(() => {
        if (pending.current === request) pending.current = null;
      });
    pending.current = request;
    return request;
  }, []);
  const release = useCallback(() => {
    generation.current++;
    current.current?.getTracks().forEach((track) => track.stop());
    current.current = null;
    pending.current = null;
    setStream(null);
  }, []);
  useEffect(() => {
    let active = true;
    if (enabled)
      void acquire().catch((error) => {
        if (active) setError(`摄像头无法打开：${String(error)}`);
      });
    return () => {
      active = false;
      release();
    };
  }, [enabled, acquire, release]);
  const retry = useCallback(() => {
    void acquire().catch((error) =>
      setError(`摄像头无法打开：${String(error)}`),
    );
  }, [acquire]);
  return { stream, error, acquire, retry };
}

/** Bound IPC to one small in-flight frame; full-resolution recording stays raw. */
export function useCameraFrames(stream: MediaStream | null, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !stream) return;
    const video = document.createElement("video"),
      canvas = document.createElement("canvas");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => {});
    let busy = false,
      active = true;
    const timer = window.setInterval(() => {
      if (
        busy ||
        !video.videoWidth ||
        !video.videoHeight ||
        video.readyState < 2
      )
        return;
      busy = true;
      canvas.width = 320;
      canvas.height = Math.max(
        1,
        Math.round((320 * video.videoHeight) / video.videoWidth),
      );
      canvas
        .getContext("2d")!
        .drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        async (blob) => {
          try {
            if (active && blob)
              await window.framecraft?.updateCameraPreview(
                new Uint8Array(await blob.arrayBuffer()),
              );
          } catch {
            /* The controller may already be closing after Stop. */
          } finally {
            busy = false;
          }
        },
        "image/jpeg",
        0.8,
      );
    }, 100);
    return () => {
      active = false;
      clearInterval(timer);
      video.pause();
      video.srcObject = null;
    };
  }, [enabled, stream]);
}
