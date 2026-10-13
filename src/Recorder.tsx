import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Mic,
  Monitor,
  Pause,
  Play,
  Square,
  Volume2,
  X,
  Circle,
} from "lucide-react";
import type { Asset } from "../shared/model";
import type { CaptureSource } from "../shared/bridge";
import { timeLabel } from "./Preview";

interface Session {
  id: string;
  kind: "screen" | "camera" | "microphone";
  recorder: MediaRecorder;
  queue: Promise<void>;
  failure?: unknown;
  pendingChunks: number;
  finished: Promise<Asset>;
  stream: MediaStream;
}
export default function Recorder({
  onClose,
  onRecorded,
  toast,
}: {
  onClose: () => void;
  onRecorded: (assets: { asset: Asset; kind: Session["kind"] }[]) => void;
  toast: (text: string) => void;
}) {
  const [sources, setSources] = useState<CaptureSource[]>([]),
    [sourceId, setSourceId] = useState(""),
    [mic, setMic] = useState(true),
    [camera, setCamera] = useState(false),
    [system, setSystem] = useState(false);
  const [phase, setPhase] = useState<
      "configure" | "starting" | "recording" | "paused" | "saving"
    >("configure"),
    [elapsed, setElapsed] = useState(0),
    [countdown, setCountdown] = useState(0),
    [error, setError] = useState("");
  const [nativeAvailable, setNativeAvailable] = useState(false),
    [useNative, setUseNative] = useState(true),
    [fps, setFps] = useState(30);
  const nativeActive = useRef(false);
  const sessions = useRef<Session[]>([]),
    timing = useRef({ started: 0, paused: 0, pauseStart: 0 }),
    stopping = useRef(false),
    mounted = useRef(true);
  const currentDuration = () =>
    (performance.now() -
      timing.current.started -
      timing.current.paused -
      (timing.current.pauseStart
        ? performance.now() - timing.current.pauseStart
        : 0)) /
    1000;
  useEffect(() => {
    mounted.current = true;
    window.framecraft
      ?.captureSources()
      .then((s) => {
        if (!mounted.current) return;
        setSources(s);
        setSourceId(s[0]?.id ?? "");
      })
      .catch((e) => setError(String(e)));
    window.framecraft
      ?.nativeCaptureAvailable()
      .then(setNativeAvailable)
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!["recording", "paused"].includes(phase)) return;
    const timer = window.setInterval(() => setElapsed(currentDuration()), 100);
    return () => clearInterval(timer);
  }, [phase]);
  async function stop() {
    if (stopping.current || (!sessions.current.length && !nativeActive.current))
      return;
    stopping.current = true;
    const duration = Math.max(0.1, currentDuration());
    setPhase("saving");
    try {
      const active = sessions.current;
      for (const s of active)
        if (s.recorder.state !== "inactive") s.recorder.stop();
      const results = await Promise.allSettled([
        ...active.map(async (s) => ({ asset: await s.finished, kind: s.kind })),
        ...(nativeActive.current
          ? [
              window
                .framecraft!.nativeRecordingStop()
                .then((asset) => ({ asset, kind: "screen" as const })),
            ]
          : []),
      ]);
      const recorded = results.flatMap((r) =>
        r.status === "fulfilled" ? [r.value] : [],
      );
      const failures = results.filter((r) => r.status === "rejected");
      if (recorded.length) {
        onRecorded(recorded);
        toast(
          failures.length
            ? `${recorded.length} 条录制成功；另有录制失败，原始文件已保留`
            : `录制完成 · ${timeLabel(duration)} · ${recorded.length} 条独立素材`,
        );
        onClose();
      } else {
        setError(
          results
            .map((r) => (r.status === "rejected" ? String(r.reason) : ""))
            .join("\n"),
        );
        setPhase("configure");
      }
    } finally {
      sessions.current.forEach((s) =>
        s.stream.getTracks().forEach((t) => t.stop()),
      );
      sessions.current = [];
      nativeActive.current = false;
      stopping.current = false;
    }
  }
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(
    () =>
      window.framecraft?.onShortcut((command) => {
        if (command === "stopRecording") void stopRef.current();
      }),
    [],
  );
  async function start() {
    const bridge = window.framecraft;
    if (!bridge) {
      setError("请运行桌面版");
      return;
    }
    setError("");
    setPhase("starting");
    const streams: { kind: Session["kind"]; stream: MediaStream }[] = [];
    try {
      const info = await bridge.capabilities();
      if (!info.ffmpeg)
        throw new Error("录制保存需要 FFmpeg / FFprobe，请先在设置中配置引擎");
      await bridge.selectCapture(sourceId, system);
      const native = nativeAvailable && useNative;
      const screen = native
        ? null
        : await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: fps, max: fps } },
            audio: system,
          });
      if (screen) streams.push({ kind: "screen", stream: screen });
      if (system && screen && !screen.getAudioTracks().length)
        toast("所选来源未提供系统音频，本次只录制画面与启用的麦克风");
      if (mic)
        streams.push({
          kind: "microphone",
          stream: await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: false,
            },
            video: false,
          }),
        });
      if (camera)
        streams.push({
          kind: "camera",
          stream: await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1920 },
              height: { ideal: 1080 },
              frameRate: 30,
            },
            audio: false,
          }),
        });
      for (let i = 3; i > 0; i--) {
        setCountdown(i);
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      timing.current = { started: performance.now(), paused: 0, pauseStart: 0 };
      if (native) {
        await bridge.nativeRecordingStart(sourceId, fps, system);
        nativeActive.current = true;
        timing.current.started = performance.now();
      }
      for (const { kind, stream } of streams) {
        const formats =
          kind === "microphone"
            ? ["audio/webm;codecs=opus", "audio/webm"]
            : [
                "video/webm;codecs=vp9,opus",
                "video/webm;codecs=vp8,opus",
                "video/webm",
              ];
        const mimeType = formats.find((format) =>
          MediaRecorder.isTypeSupported(format),
        );
        if (!mimeType) throw new Error("当前运行时不支持 WebM 录制");
        const id = await bridge.recordingStart(kind),
          recorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 12_000_000,
            audioBitsPerSecond: 192_000,
          });
        let resolveFinished!: (asset: Asset) => void,
          rejectFinished!: (error: unknown) => void;
        const finished = new Promise<Asset>((resolve, reject) => {
          resolveFinished = resolve;
          rejectFinished = reject;
        });
        // Keep a handler attached while recording; stop() later collects per-stream errors.
        void finished.catch(() => {});
        const session: Session = {
          id,
          kind,
          recorder,
          stream,
          queue: Promise.resolve(),
          finished,
          pendingChunks: 0,
        };
        recorder.ondataavailable = (event) => {
          if (!event.data.size) return;
          session.pendingChunks++;
          if (session.pendingChunks > 8) {
            session.failure = new Error(
              "写入速度无法跟上录屏，已停止并保留录制文件。请检查磁盘空间与存储速度。",
            );
            void stopRef.current();
          }
          session.queue = session.queue
            .then(async () => {
              const chunk = new Uint8Array(await event.data.arrayBuffer());
              await bridge.recordingChunk(id, chunk);
            })
            .catch((e) => {
              session.failure = e;
              void stopRef.current();
            })
            .finally(() => {
              session.pendingChunks--;
            });
        };
        recorder.onerror = (event) => {
          session.failure = event;
          rejectFinished(new Error("编码器录制失败"));
          void stopRef.current();
        };
        recorder.onstop = async () => {
          try {
            await session.queue;
            const asset = await bridge.recordingStop(
              id,
              Math.max(0.1, currentDuration()),
            );
            if (session.failure) throw session.failure;
            resolveFinished(asset);
          } catch (e) {
            rejectFinished(e);
          } finally {
            stream.getTracks().forEach((t) => t.stop());
          }
        };
        sessions.current.push(session);
        recorder.start(1000);
      }
      screen?.getVideoTracks()[0].addEventListener("ended", () => {
        void stopRef.current();
      });
      setCountdown(0);
      setPhase("recording");
    } catch (e) {
      setError(String(e));
      setCountdown(0);
      setPhase("configure");
      for (const session of sessions.current) {
        session.recorder.onstop = null;
        if (session.recorder.state !== "inactive") session.recorder.stop();
        await session.queue;
        await bridge.recordingAbort(session.id);
      }
      sessions.current = [];
      if (nativeActive.current) {
        await bridge.nativeRecordingStop().catch(() => {});
        nativeActive.current = false;
      }
      streams.forEach((s) => s.stream.getTracks().forEach((t) => t.stop()));
    }
  }
  function pause() {
    if (phase === "recording") {
      sessions.current.forEach((s) => s.recorder.pause());
      timing.current.pauseStart = performance.now();
      setPhase("paused");
      if (nativeActive.current)
        void window.framecraft
          ?.nativeRecordingPause(true)
          .catch((e) => setError(String(e)));
    } else {
      timing.current.paused += performance.now() - timing.current.pauseStart;
      timing.current.pauseStart = 0;
      sessions.current.forEach((s) => s.recorder.resume());
      setPhase("recording");
      if (nativeActive.current)
        void window.framecraft
          ?.nativeRecordingPause(false)
          .catch((e) => setError(String(e)));
    }
  }
  if (["recording", "paused", "saving"].includes(phase))
    return (
      <div className="recording-bar">
        <span
          className={`recording-dot ${phase === "paused" ? "paused" : ""}`}
        />
        <b>
          {phase === "saving"
            ? "正在保存录制…"
            : phase === "paused"
              ? "已暂停"
              : "正在录制"}
        </b>
        <span className="timecode">{timeLabel(elapsed)}</span>
        <small>Ctrl / ⌘ + Shift + F9 停止</small>
        <button disabled={phase === "saving"} onClick={pause}>
          {phase === "paused" ? <Play size={18} /> : <Pause size={18} />}
        </button>
        <button
          className="stop-recording"
          disabled={phase === "saving"}
          onClick={() => void stop()}
        >
          <Square size={15} fill="currentColor" />
          结束录制
        </button>
      </div>
    );
  return (
    <div className="modal-backdrop">
      <div className="recorder-modal">
        <div className="modal-heading">
          <div>
            <h2>录制你的灵感</h2>
            <p>屏幕、声音与镜头，分别记录。</p>
          </div>
          <button disabled={phase === "starting"} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <h3 className="section-title">
          <Monitor size={15} />
          选择屏幕或窗口
        </h3>
        <div className="capture-sources">
          {sources.map((source) => (
            <button
              key={source.id}
              className={sourceId === source.id ? "selected" : ""}
              onClick={() => setSourceId(source.id)}
              disabled={phase === "starting"}
            >
              <img src={source.thumbnail} alt="录制来源缩略图" />
              <span>{source.name}</span>
            </button>
          ))}
        </div>
        <div className="record-options">
          {[
            { label: "麦克风", icon: Mic, value: mic, change: setMic },
            {
              label: "系统声音",
              icon: Volume2,
              value: system,
              change: setSystem,
            },
            { label: "摄像头", icon: Camera, value: camera, change: setCamera },
          ].map((option) => (
            <label key={option.label}>
              <option.icon size={22} />
              <span>{option.label}</span>
              <input
                disabled={phase === "starting"}
                type="checkbox"
                checked={option.value}
                onChange={(e) => option.change(e.target.checked)}
              />
            </label>
          ))}
        </div>
        <label className="field">
          录制帧率
          <select
            aria-label="录制帧率"
            value={fps}
            disabled={phase === "starting"}
            onChange={(e) => setFps(Number(e.target.value))}
          >
            {[15, 30, 60].map((value) => (
              <option key={value} value={value}>
                {value} fps
              </option>
            ))}
          </select>
        </label>
        {nativeAvailable && (
          <label className="check-field">
            <input
              type="checkbox"
              disabled={phase === "starting"}
              checked={useNative}
              onChange={(e) => setUseNative(e.target.checked)}
            />
            原生录制与可编辑鼠标
          </label>
        )}
        <p className="small-note">
          麦克风与摄像头保存为独立素材。Windows
          原生录制单独保存鼠标轨迹，可在属性中修改样式；兼容录制的鼠标包含在画面中。macOS
          首次使用需要授予录屏、麦克风与摄像头权限。
        </p>
        {error && <div className="error-box">{error}</div>}
        <button
          className="start-recording"
          disabled={!sourceId || phase === "starting"}
          onClick={() => void start()}
        >
          <Circle size={15} fill="currentColor" />
          {countdown
            ? `${countdown} 秒后开始`
            : phase === "starting"
              ? "正在准备录制…"
              : "开始录制"}
        </button>
      </div>
    </div>
  );
}
