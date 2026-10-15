import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import type { Asset } from "../shared/model";

type Take = {
  id?: string;
  stream?: MediaStream;
  recorder?: MediaRecorder;
  queue: Promise<void>;
  started: number;
  cancelled: boolean;
  failure?: unknown;
};

/** A short reference take never becomes a timeline clip. */
export default function CloneReferenceRecorder({
  busy,
  onRecorded,
  onActivity,
  onError,
}: {
  busy: boolean;
  onRecorded: (asset: Asset) => void;
  onActivity: (active: boolean) => void;
  onError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<
    "idle" | "starting" | "recording" | "saving"
  >("idle");
  const [seconds, setSeconds] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState("");
  const take = useRef<Take | null>(null);
  const mounted = useRef(true);
  const latest = useRef({ onRecorded, onActivity, onError });
  latest.current = { onRecorded, onActivity, onError };

  const stop = () => {
    const current = take.current;
    if (!current?.recorder || current.recorder.state === "inactive") return;
    if (mounted.current) setPhase("saving");
    current.recorder.stop();
    current.stream?.getTracks().forEach((track) => track.stop());
  };
  useEffect(() => {
    mounted.current = true;
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((items) => {
        if (mounted.current)
          setDevices(items.filter((item) => item.kind === "audioinput"));
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      const current = take.current;
      if (!current) return;
      current.cancelled = true;
      if (current.recorder?.state === "recording") current.recorder.stop();
      current.stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => {
      const current = take.current;
      if (!current) return;
      const elapsed = (performance.now() - current.started) / 1000;
      setSeconds(elapsed);
      if (elapsed >= 30) stop();
    }, 100);
    return () => clearInterval(timer);
  }, [phase]);

  async function start() {
    const bridge = window.framecraft;
    if (!bridge || take.current) return;
    const current: Take = {
      queue: Promise.resolve(),
      started: 0,
      cancelled: false,
    };
    take.current = current;
    setPhase("starting");
    setSeconds(0);
    latest.current.onActivity(true);
    latest.current.onError("");
    const ensureActive = () => {
      if (!mounted.current || current.cancelled) throw new Error("录音已取消");
    };
    const reset = () => {
      current.stream?.getTracks().forEach((track) => track.stop());
      if (take.current === current) take.current = null;
      if (mounted.current) {
        setPhase("idle");
        latest.current.onActivity(false);
      }
    };
    try {
      current.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(device ? { deviceId: { exact: device } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
        video: false,
      });
      ensureActive();
      const inputs = await navigator.mediaDevices.enumerateDevices();
      ensureActive();
      setDevices(inputs.filter((item) => item.kind === "audioinput"));
      const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((item) =>
        MediaRecorder.isTypeSupported(item),
      );
      if (!mimeType) throw new Error("当前运行时不支持麦克风录音");
      current.id = await bridge.recordingStart("voice-reference");
      ensureActive();
      const id = current.id;
      const recorder = new MediaRecorder(current.stream, {
        mimeType,
        audioBitsPerSecond: 192000,
      });
      current.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        current.queue = current.queue
          .then(async () => {
            await bridge.recordingChunk(
              id,
              new Uint8Array(await event.data.arrayBuffer()),
            );
          })
          .catch((error) => {
            current.failure = error;
            stop();
          });
      };
      recorder.onerror = () => {
        current.failure = new Error("麦克风录音失败");
        stop();
      };
      recorder.onstop = () => {
        const duration = Math.max(
          0.1,
          (performance.now() - current.started) / 1000,
        );
        void (async () => {
          try {
            await current.queue;
            if (current.cancelled || current.failure) {
              await bridge.recordingAbort(id);
              if (current.failure) throw current.failure;
              return;
            }
            const asset = await bridge.recordingStop(
              id,
              Math.min(duration, 30),
            );
            if (!mounted.current || current.cancelled || asset.duration < 3) {
              await bridge.releaseNarrationReference(asset.id);
              if (mounted.current && !current.cancelled)
                throw new Error("请至少录制 3 秒");
              return;
            }
            latest.current.onRecorded(asset);
          } catch (error) {
            await bridge.recordingAbort(id).catch(() => {});
            if (mounted.current)
              latest.current.onError(String(error).replace(/^Error: /, ""));
          } finally {
            reset();
          }
        })();
      };
      current.stream
        .getAudioTracks()
        .forEach((track) =>
          track.addEventListener("ended", stop, { once: true }),
        );
      current.started = performance.now();
      recorder.start(500);
      setPhase("recording");
    } catch (error) {
      if (current.id) await bridge.recordingAbort(current.id).catch(() => {});
      if (mounted.current && !current.cancelled)
        latest.current.onError(
          `无法录音：${String(error).replace(/^Error: /, "")}`,
        );
      reset();
    }
  }

  return (
    <div className="clone-recorder">
      <label className="field vertical">
        克隆参考麦克风
        <select
          aria-label="克隆参考麦克风"
          value={device}
          disabled={busy || phase !== "idle"}
          onChange={(event) => setDevice(event.target.value)}
        >
          <option value="">系统默认麦克风</option>
          {devices
            .filter((item) => item.deviceId && item.deviceId !== "default")
            .map((item, index) => (
              <option key={item.deviceId} value={item.deviceId}>
                {item.label || `麦克风 ${index + 1}`}
              </option>
            ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy || phase === "starting" || phase === "saving"}
        onClick={() => (phase === "recording" ? stop() : void start())}
      >
        {phase === "recording" ? <Square size={14} /> : <Mic size={14} />}
        {phase === "starting"
          ? "正在打开麦克风…"
          : phase === "saving"
            ? "正在保存参考录音…"
            : phase === "recording"
              ? `停止参考录音 · ${seconds.toFixed(1)} 秒`
              : "直接录制参考声音"}
      </button>
    </div>
  );
}
