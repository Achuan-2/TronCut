import { Circle, Mic, Square, Volume2 } from "lucide-react";
import type { Asset } from "../shared/model";
import type { Editor } from "./useEditor";
import { timeLabel } from "./Preview";
import { useNarrationRecording } from "./useNarrationRecording";

export default function NarrationRecorder({
  editor,
  active,
  busy,
  onStarting,
  onRecorded,
  toast,
}: {
  editor: Editor;
  active: boolean;
  busy: boolean;
  onStarting: () => void;
  onRecorded: (asset: Asset) => void;
  toast: (message: string) => void;
}) {
  const recording = useNarrationRecording({
    editor,
    active,
    onRecorded,
    toast,
  });
  const idle = recording.phase === "idle";
  return (
    <section className="narration-recorder" aria-label="麦克风录音">
      <label className="field vertical">
        <span>
          <Mic size={14} /> 麦克风
        </span>
        <select
          aria-label="旁白麦克风"
          value={recording.deviceId}
          disabled={!idle || busy}
          onChange={(event) => recording.setDeviceId(event.target.value)}
        >
          <option value="">系统默认麦克风</option>
          {recording.devices
            .filter(
              (device) => device.deviceId && device.deviceId !== "default",
            )
            .map((device, i) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `麦克风 ${i + 1}`}
              </option>
            ))}
        </select>
      </label>
      <div
        className="narration-meter"
        role="meter"
        aria-label="麦克风电平"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(recording.level * 100)}
      >
        <span style={{ width: `${recording.level * 100}%` }} />
      </div>
      <label className="narration-volume">
        <Volume2 size={14} />
        <input
          type="range"
          aria-label="录音音量"
          aria-valuetext={`${Math.round(recording.volume * 100)}%`}
          min={0}
          max={2}
          step={0.01}
          value={recording.volume}
          disabled={
            busy ||
            recording.phase === "starting" ||
            recording.phase === "saving"
          }
          onChange={(event) => recording.setVolume(Number(event.target.value))}
        />
        <span className="narration-volume-value" aria-hidden="true">
          {Math.round(recording.volume * 100)}%
        </span>
      </label>
      <label className="narration-offline">
        <input
          type="checkbox"
          checked={recording.muteTimeline}
          disabled={!idle}
          onChange={(event) => recording.setMuteTimeline(event.target.checked)}
        />
        录制过程中静音时间轴
      </label>
      <button
        className={`wide-button narration-record-button ${recording.phase === "recording" ? "recording" : ""}`}
        disabled={
          busy || recording.phase === "starting" || recording.phase === "saving"
        }
        onClick={() => {
          if (recording.phase === "recording") recording.stop();
          else {
            onStarting();
            void recording.start();
          }
        }}
      >
        {recording.phase === "recording" ? (
          <Square size={14} fill="currentColor" />
        ) : (
          <Circle size={14} fill="currentColor" />
        )}
        {recording.phase === "starting"
          ? "正在准备麦克风…"
          : recording.phase === "saving"
            ? "正在保存录音…"
            : recording.phase === "recording"
              ? `停止录音 · ${timeLabel(recording.elapsed)}`
              : "开始录音"}
      </button>
      {recording.error && (
        <div className="error-box" role="alert">
          {recording.error}
        </div>
      )}
    </section>
  );
}
