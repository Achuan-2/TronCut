import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, X } from "lucide-react";
import {
  availableTtsModels,
  type AvailableTtsEngine,
  type TtsOptions,
  type WindowsSpeechVoice,
} from "../shared/tts";
import type { Asset } from "../shared/model";
import ClonedVoiceFields from "./ClonedVoiceFields";

interface Props {
  options: TtsOptions;
  busy: boolean;
  update: (options: Partial<TtsOptions>) => void;
  run: (fn: () => Promise<unknown>) => void;
  onPreviewStart: () => void;
  onClose: () => void;
}

export default function NarrationSettingsDialog({
  options,
  busy,
  update,
  run,
  onPreviewStart,
  onClose,
}: Props) {
  const engine = options.engine as AvailableTtsEngine;
  const windows = engine === "windows-sapi";
  const cloning = engine === "lux-onnx";
  const [referenceRecording, setReferenceRecording] = useState(false);
  const [voices, setVoices] = useState<WindowsSpeechVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const preview = useRef<Asset | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const token = useRef(0);
  const generating = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);

  const clearPreview = useCallback(() => {
    token.current++;
    if (player.current) {
      player.current.pause();
      player.current.removeAttribute("src");
      player.current.load();
      player.current = null;
    }
    setPlaying(false);
    if (generating.current)
      void window.framecraft?.cancelTask().catch(() => {});
    const asset = preview.current;
    preview.current = null;
    if (asset)
      void window.framecraft
        ?.releaseSpeechVoicePreview(asset.id)
        .catch(() => {});
  }, []);
  useEffect(() => {
    clearPreview();
    setPreviewError("");
    return clearPreview;
  }, [engine, options.voice, options.speed, clearPreview]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLSelectElement>("select")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);
  useEffect(() => {
    if (!windows) return;
    let cancelled = false;
    setLoading(true);
    setVoiceError("");
    window.framecraft
      ?.windowsSpeechVoices()
      .then((items) => {
        if (cancelled) return;
        setVoices(items);
        if (!items.length)
          setVoiceError("未找到系统音色，请安装 Windows 语音或选择其他模型");
      })
      .catch((error) => {
        if (!cancelled)
          setVoiceError(
            `读取系统音色失败：${String(error).replace(/^Error: /, "")}`,
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [windows, refresh]);

  const audition = () => {
    if (playing) {
      token.current++;
      player.current?.pause();
      setPlaying(false);
      return;
    }
    const current = ++token.current;
    setPreviewError("");
    onPreviewStart();
    run(async () => {
      try {
        if (!window.framecraft) throw new Error("试听音色需要桌面版");
        let asset = preview.current;
        if (!asset) {
          generating.current = true;
          asset = await window.framecraft.previewSpeechVoice({
            ...options,
            text: "音色试听",
          });
          generating.current = false;
          if (current !== token.current) {
            await window.framecraft.releaseSpeechVoicePreview(asset.id);
            return;
          }
          preview.current = asset;
        }
        const url = await window.framecraft.mediaUrl(asset.id);
        if (current !== token.current) return;
        const audio = new Audio(url);
        player.current?.pause();
        player.current = audio;
        audio.onended = () => {
          if (current === token.current) setPlaying(false);
        };
        audio.onerror = () => {
          if (current !== token.current) return;
          setPlaying(false);
          setPreviewError("音色试听失败，请重试");
        };
        await audio.play();
        if (current !== token.current) audio.pause();
        else setPlaying(true);
      } catch (error) {
        if (current === token.current)
          setPreviewError(
            `音色试听失败：${String(error).replace(/^Error: /, "")}`,
          );
      } finally {
        generating.current = false;
      }
    });
  };
  return (
    <div
      className="modal-backdrop"
      onPointerDown={onClose}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (event.key === "Tab") {
          const fields = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled)",
            ) ?? [],
          );
          const first = fields[0],
            last = fields.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div
        ref={dialog}
        className="caption-dialog narration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="narration-settings-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <h2 id="narration-settings-title">AI 配音设置</h2>
            <p>选择模型和音色，试听后用于旁白配音。</p>
          </div>
          <button aria-label="关闭配音设置" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <fieldset disabled={busy}>
          <label className="field vertical">
            配音模型
            <select
              aria-label="配音模型"
              value={engine}
              disabled={referenceRecording}
              onChange={(event) => {
                const next = event.target.value as AvailableTtsEngine;
                update({
                  engine: next,
                  voice:
                    next === "lux-onnx"
                      ? ""
                      : next === "windows-sapi"
                        ? "auto"
                        : next === "kokoro-onnx"
                          ? "10"
                          : "0",
                  language: "zh",
                  device: "cpu",
                  modelDir: "",
                  offline: false,
                  instruction: "",
                });
              }}
            >
              {Object.entries(availableTtsModels)
                .filter(
                  ([id]) =>
                    id !== "windows-sapi" ||
                    window.framecraft?.platform === "win32",
                )
                .map(([id, model]) => (
                  <option key={id} value={id}>
                    {model.name}
                  </option>
                ))}
            </select>
          </label>
          {cloning ? (
            <ClonedVoiceFields
              voiceId={options.voice}
              busy={busy}
              onSelect={(voice) => update({ voice })}
              onActivity={(active) => {
                setReferenceRecording(active);
                if (active) {
                  clearPreview();
                  onPreviewStart();
                }
              }}
              run={run}
            />
          ) : (
            <label className="field vertical">
              配音音色
              <select
                aria-label="配音音色"
                value={options.voice}
                disabled={windows && loading}
                onChange={(event) => update({ voice: event.target.value })}
              >
                {availableTtsModels[engine].voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                  </option>
                ))}
                {windows &&
                  voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.name} · {voice.language} ·{" "}
                      {voice.gender === "Male"
                        ? "男声"
                        : voice.gender === "Female"
                          ? "女声"
                          : voice.gender}
                    </option>
                  ))}
                {windows &&
                  options.voice !== "auto" &&
                  !voices.some((voice) => voice.id === options.voice) && (
                    <option value={options.voice}>原音色不可用</option>
                  )}
              </select>
            </label>
          )}
          <label className="field vertical">
            配音语速
            <select
              aria-label="配音语速"
              value={options.speed}
              disabled={referenceRecording}
              onChange={(event) =>
                update({ speed: Number(event.target.value) })
              }
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×{speed === 1 ? " · 正常" : ""}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <p className="small-note">
          {windows
            ? loading
              ? "正在读取系统音色…"
              : "使用本机已安装的 Windows 音色，自动优先微软云希。"
            : "首次使用时自动准备配音环境和模型。"}
        </p>
        {voiceError && windows && (
          <p className="small-note" role="alert">
            {voiceError}{" "}
            <button
              disabled={busy || loading}
              onClick={() => setRefresh((value) => value + 1)}
            >
              重试
            </button>
          </p>
        )}
        <p className="narration-voice-sample">
          试听示例：你好，这是当前音色的试听。记录灵感，让创作更轻松。
        </p>
        {previewError && (
          <p className="small-note" role="alert">
            {previewError}
          </p>
        )}
        <div className="narration-dialog-actions">
          <button
            disabled={
              busy ||
              (windows && (loading || !!voiceError || !voices.length)) ||
              referenceRecording ||
              (cloning && !options.voice)
            }
            onClick={audition}
          >
            {playing ? <Square size={15} /> : <Play size={15} />}{" "}
            {playing ? "停止试听音色" : "试听音色"}
          </button>
          <button className="primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
