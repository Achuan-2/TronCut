import { useEffect, useRef, useState } from "react";
import type { Asset } from "../shared/model";
import type { Editor } from "./useEditor";

interface RecordingSession {
  id?: string;
  stream?: MediaStream;
  context?: AudioContext;
  gain?: GainNode;
  recorder?: MediaRecorder;
  queue: Promise<void>;
  pending: number;
  failure?: unknown;
  cancelled: boolean;
  started: number;
  time: number;
}

/** Own the microphone, encoder and disk queue for one narration take. */
export function useNarrationRecording({
  editor,
  active,
  onRecorded,
  toast,
}: {
  editor: Editor;
  active: boolean;
  onRecorded: (asset: Asset) => void;
  toast: (message: string) => void;
}) {
  const [phase, setPhase] = useState<
    "idle" | "starting" | "recording" | "saving"
  >("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [volume, setVolume] = useState(1);
  const [muteTimeline, setMuteTimeline] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const session = useRef<RecordingSession | null>(null);
  const mounted = useRef(true);
  const latest = useRef({ editor, active, onRecorded, toast });
  latest.current = { editor, active, onRecorded, toast };

  const refreshDevices = async () => {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === "audioinput",
    );
    if (mounted.current) setDevices(inputs);
  };
  useEffect(() => {
    if (!active || !navigator.mediaDevices) return;
    const refresh = () => void refreshDevices().catch(() => {});
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () =>
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, [active]);

  function release(take: RecordingSession) {
    take.stream?.getTracks().forEach((track) => track.stop());
    void take.context?.close().catch(() => {});
  }
  function reset(take: RecordingSession) {
    release(take);
    if (session.current !== take) return;
    session.current = null;
    latest.current.editor.setPlaying(false);
    latest.current.editor.setNarrationRecording(null);
    if (mounted.current) {
      setPhase("idle");
      setLevel(0);
    }
  }
  function stop() {
    const take = session.current;
    if (!take?.recorder || take.recorder.state === "inactive") return;
    latest.current.editor.setPlaying(false);
    if (mounted.current) setPhase("saving");
    take.recorder.stop();
    // Stop the physical microphone as soon as the encoder has been stopped.
    take.stream?.getTracks().forEach((track) => track.stop());
  }
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (active) return;
    const take = session.current;
    if (take && !take.recorder) take.cancelled = true;
    stopRef.current();
  }, [active]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const take = session.current;
      if (!take) return;
      take.cancelled = true;
      stopRef.current();
      release(take);
      latest.current.editor.setPlaying(false);
      latest.current.editor.setNarrationRecording(null);
    };
  }, []);
  useEffect(
    () =>
      window.framecraft?.onShortcut((command) => {
        if (command === "stopRecording") stopRef.current();
      }),
    [],
  );
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(() => {
      if (session.current)
        setElapsed((performance.now() - session.current.started) / 1000);
    }, 100);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    const gain = session.current?.gain;
    if (gain) gain.gain.value = volume;
  }, [volume]);

  async function start() {
    if (session.current) return;
    const bridge = window.framecraft;
    if (!bridge || !navigator.mediaDevices) {
      setError("旁白录音需要在桌面版中使用麦克风");
      return;
    }
    const take: RecordingSession = {
      queue: Promise.resolve(),
      pending: 0,
      cancelled: false,
      started: 0,
      time: 0,
    };
    session.current = take;
    setError("");
    setElapsed(0);
    setPhase("starting");
    latest.current.editor.setPlaying(false);
    latest.current.editor.setNarrationRecording({ muted: muteTimeline });
    const ensureActive = () => {
      if (take.cancelled || !mounted.current || !latest.current.active)
        throw new Error("录音准备已取消");
    };
    try {
      const capabilities = await bridge.capabilities();
      ensureActive();
      if (!capabilities.ffmpeg)
        throw new Error("录音保存需要 FFmpeg / FFprobe，请先在设置中配置引擎");
      take.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
        video: false,
      });
      ensureActive();
      await refreshDevices();
      ensureActive();
      const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType) throw new Error("当前运行时不支持麦克风录音");
      const context = new AudioContext();
      take.context = context;
      const source = context.createMediaStreamSource(take.stream);
      const gain = context.createGain();
      take.gain = gain;
      gain.gain.value = volume;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const destination = context.createMediaStreamDestination();
      source.connect(gain).connect(analyser).connect(destination);
      await context.resume();
      ensureActive();
      take.id = await bridge.recordingStart("microphone");
      ensureActive();
      const id = take.id;
      const recorder = new MediaRecorder(destination.stream, {
        mimeType,
        audioBitsPerSecond: 192000,
      });
      take.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        if (++take.pending > 8) {
          take.failure = new Error(
            "写入速度无法跟上录音，已停止录制，请检查磁盘空间",
          );
          stopRef.current();
        }
        take.queue = take.queue
          .then(async () => {
            await bridge.recordingChunk(
              id,
              new Uint8Array(await event.data.arrayBuffer()),
            );
          })
          .catch((cause) => {
            take.failure = cause;
            stopRef.current();
          })
          .finally(() => {
            take.pending--;
          });
      };
      recorder.onerror = () => {
        take.failure = new Error("麦克风编码失败，已停止录音");
        stopRef.current();
      };
      recorder.onstop = () => {
        const duration = Math.max(
          0.1,
          (performance.now() - take.started) / 1000,
        );
        if (mounted.current) setPhase("saving");
        void (async () => {
          try {
            await take.queue;
            if (take.cancelled) {
              await bridge.recordingAbort(id);
              return;
            }
            // Finalize even on a write/encoder error, keeping any recoverable take.
            const asset = await bridge.recordingStop(id, duration);
            if (!mounted.current || take.cancelled) return;
            latest.current.editor.addAssets([asset], true, { time: take.time });
            latest.current.onRecorded(asset);
            if (take.failure)
              setError(`录音异常，已保存可恢复的音频：${String(take.failure)}`);
            latest.current.toast("旁白录音已加入时间线");
          } catch (cause) {
            await bridge.recordingAbort(id).catch(() => {});
            if (mounted.current) setError(`录音保存失败：${String(cause)}`);
          } finally {
            reset(take);
          }
        })();
      };
      take.stream.getAudioTracks().forEach((track) => {
        track.addEventListener(
          "ended",
          () => {
            take.failure = new Error("麦克风已断开");
            stopRef.current();
          },
          { once: true },
        );
      });
      take.time = latest.current.editor.playhead;
      take.started = performance.now();
      recorder.start(500);
      setPhase("recording");
      latest.current.editor.setPlaying(true);
      const samples = new Uint8Array(analyser.fftSize);
      const meter = () => {
        if (
          session.current !== take ||
          recorder.state !== "recording" ||
          !mounted.current
        )
          return;
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) /
            samples.length,
        );
        setLevel(Math.min(1, rms * 4));
        requestAnimationFrame(meter);
      };
      meter();
    } catch (cause) {
      if (take.id) await bridge.recordingAbort(take.id).catch(() => {});
      if (mounted.current && !take.cancelled)
        setError(`无法开始录音：${String(cause)}`);
      reset(take);
    }
  }

  return {
    phase,
    devices,
    deviceId,
    setDeviceId,
    volume,
    setVolume,
    muteTimeline,
    setMuteTimeline,
    elapsed,
    level,
    error,
    start,
    stop,
  };
}
