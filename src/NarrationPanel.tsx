import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  MoreHorizontal,
  Play,
  SlidersHorizontal,
  Square,
  Type,
} from "lucide-react";
import { ttsOptionsSchema, type TtsOptions } from "../shared/tts";
import type { Editor } from "./useEditor";
import { timeLabel } from "./Preview";
import NarrationRecorder from "./NarrationRecorder";
import NarrationSettingsDialog from "./NarrationSettingsDialog";

interface Props {
  editor: Editor;
  busy: boolean;
  active: boolean;
  run: (fn: () => Promise<unknown>) => void;
  toast: (text: string) => void;
}

export default function NarrationPanel({
  editor,
  busy,
  active,
  run,
  toast,
}: Props) {
  const [options, setOptions] = useState<TtsOptions>({
    text: "",
    engine:
      window.framecraft?.platform === "win32" ? "windows-sapi" : "kokoro-onnx",
    voice: window.framecraft?.platform === "win32" ? "auto" : "10",
    language: "zh",
    device: "cpu",
    speed: 1,
    instruction: "",
    offline: false,
    modelDir: "",
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const [generatedId, setGeneratedId] = useState<string | null>(null);
  const generated = editor.project.assets.find(
    (asset) => asset.id === generatedId,
  );
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const auditionToken = useRef(0);
  const working = busy || !!editor.narrationRecording;
  const stopAudition = () => {
    auditionToken.current++;
    player.current?.pause();
    setPlaying(false);
  };
  useEffect(() => {
    if (!active) {
      setPlaying(false);
      setSettingsOpen(false);
      setMenuOpen(false);
    }
    return () => {
      auditionToken.current++;
      player.current?.pause();
      player.current = null;
    };
  }, [active]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  return (
    <div className="narration-panel">
      <header className="library-heading">
        <h2>旁白</h2>
        <div className="caption-actions" ref={menu}>
          <button
            aria-label="旁白更多选项"
            title="更多"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <MoreHorizontal size={19} />
          </button>
          {menuOpen && (
            <div className="caption-actions-menu" role="menu">
              <button
                role="menuitem"
                disabled={working}
                onClick={() => {
                  setMenuOpen(false);
                  stopAudition();
                  setSettingsOpen(true);
                }}
              >
                <SlidersHorizontal size={14} />
                AI 配音设置
              </button>
              <button
                role="menuitem"
                disabled={!editor.selected?.text}
                onClick={() => {
                  setMenuOpen(false);
                  setOptions((current) => ({
                    ...current,
                    text: editor.selected?.text ?? current.text,
                  }));
                }}
              >
                <Type size={14} />
                读取选中文本
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="narration-body">
        <NarrationRecorder
          editor={editor}
          active={active}
          busy={busy}
          toast={toast}
          onStarting={stopAudition}
          onRecorded={(asset) => setGeneratedId(asset.id)}
        />
        <label className="field vertical narration-script">
          旁白文稿
          <textarea
            aria-label="旁白文稿"
            rows={7}
            maxLength={10000}
            placeholder="在此粘贴或输入脚本文本，可照稿录音，或用 AI 生成音频…"
            value={options.text}
            onChange={(event) =>
              setOptions((current) => ({
                ...current,
                text: event.target.value,
              }))
            }
          />
        </label>
      </div>
      <button
        className="wide-button primary narration-generate"
        disabled={working || !options.text.trim()}
        onClick={() =>
          run(async () => {
            const parsed = ttsOptionsSchema.safeParse(options);
            if (!parsed.success)
              throw new Error(parsed.error.issues[0].message);
            if (!window.framecraft) throw new Error("配音功能需要桌面版");
            stopAudition();
            editor.setPlaying(false);
            const asset = await window.framecraft.synthesize(parsed.data);
            editor.addAssets([asset], true);
            setGeneratedId(asset.id);
            toast(`已生成 ${timeLabel(asset.duration)} 配音，加入时间线`);
          })
        }
      >
        <AudioLines size={16} />
        生成音频
      </button>
      <p className="small-note">
        录音和 AI 配音均加入播放头所在位置，文稿切换 Tab 后保留。
      </p>
      {generated && (
        <div className="tip-card narration-result">
          <b>{generated.name}</b>
          <p>
            {timeLabel(generated.duration)} ·{" "}
            {generated.narration ? "AI 配音" : "麦克风录音"}
          </p>
          <button
            disabled={working}
            onClick={() => {
              if (playing) {
                stopAudition();
                return;
              }
              run(async () => {
                if (!window.framecraft) throw new Error("试听需要桌面版");
                const token = ++auditionToken.current;
                player.current?.pause();
                const url = await window.framecraft.mediaUrl(generated.id);
                if (token !== auditionToken.current) return;
                const audio = new Audio(url);
                player.current = audio;
                audio.onended = () => setPlaying(false);
                audio.onerror = () => {
                  setPlaying(false);
                  toast("配音试听失败，可在时间线检查音频");
                };
                await audio.play();
                if (token !== auditionToken.current) audio.pause();
                else setPlaying(true);
              });
            }}
          >
            {playing ? <Square size={14} /> : <Play size={14} />}{" "}
            {playing ? "停止试听" : "试听音频"}
          </button>
        </div>
      )}
      {settingsOpen && (
        <NarrationSettingsDialog
          options={options}
          busy={working}
          update={(patch) =>
            setOptions((current) => ({ ...current, ...patch }))
          }
          run={run}
          onPreviewStart={() => {
            stopAudition();
            editor.setPlaying(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
