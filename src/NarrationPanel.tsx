import { useEffect, useRef, useState } from "react";
import { AudioLines, Play, Square, Type } from "lucide-react";
import {
  onnxTtsModels,
  ttsOptionsSchema,
  type OnnxTtsEngine,
  type TtsOptions,
} from "../shared/tts";
import type { Editor } from "./useEditor";
import { timeLabel } from "./Preview";
import NarrationRecorder from "./NarrationRecorder";

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
    engine: "kokoro-onnx",
    voice: "10",
    language: "zh",
    device: "cpu",
    speed: 1,
    instruction: "",
    offline: false,
    modelDir: "",
  });
  const [generatedId, setGeneratedId] = useState<string | null>(null);
  const generated = editor.project.assets.find(
    (asset) => asset.id === generatedId,
  );
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  const auditionToken = useRef(0);
  useEffect(() => {
    if (!active) setPlaying(false);
    return () => {
      auditionToken.current++;
      player.current?.pause();
      player.current = null;
    };
  }, [active]);
  const update = (patch: Partial<TtsOptions>) =>
    setOptions((current) => ({ ...current, ...patch }));
  const useText = () => {
    if (!editor.selected?.text) {
      toast("请先选中一个文本或字幕片段");
      return;
    }
    update({ text: editor.selected.text });
  };
  const loadNarration = () => {
    const asset = editor.project.assets.find(
      (a) => a.id === editor.selected?.assetId,
    );
    if (!asset?.narration) {
      toast("请先选中已有配音片段");
      return;
    }
    if (asset.narration.engine in onnxTtsModels) {
      setOptions(asset.narration);
    } else {
      // Read old projects without silently assigning a legacy speaker ID to an ONNX voice.
      setOptions({
        ...asset.narration,
        engine: "kokoro-onnx",
        voice: "10",
        device: "cpu",
        instruction: "",
        referenceAssetId: undefined,
        modelDir: "",
      });
      toast("已读取旧配音文稿与语速，请重新选择 ONNX 音色");
    }
  };
  const engine = options.engine as OnnxTtsEngine;
  const working = busy || !!editor.narrationRecording;
  const stopAudition = () => {
    auditionToken.current++;
    player.current?.pause();
    setPlaying(false);
  };
  return (
    <div className="narration-panel">
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
            onChange={(e) => update({ text: e.target.value })}
          />
        </label>
        <div className="two-buttons">
          <button onClick={useText}>
            <Type size={14} />
            读取选中文本
          </button>
          <button onClick={loadNarration}>读取配音参数</button>
        </div>
        <details className="narration-settings">
          <summary>AI 配音设置</summary>
          <fieldset disabled={working}>
            <label className="field vertical">
              配音模型
              <select
                aria-label="配音模型"
                value={engine}
                onChange={(e) => {
                  const next = e.target.value as OnnxTtsEngine;
                  update({
                    engine: next,
                    voice: next === "kokoro-onnx" ? "10" : "0",
                    language: "zh",
                    modelDir: "",
                  });
                }}
              >
                {Object.entries(onnxTtsModels).map(([id, model]) => (
                  <option key={id} value={id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              配音音色
              <select
                aria-label="配音音色"
                value={options.voice}
                onChange={(e) => update({ voice: e.target.value })}
              >
                {onnxTtsModels[engine].voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field vertical">
              配音模型目录
              <input
                value={options.modelDir ?? ""}
                placeholder="留空自动查找本机模型"
                onChange={(e) => update({ modelDir: e.target.value })}
              />
            </label>
            <p className="small-note">
              默认使用 TronCut 已下载的模型。指定目录时，请选择包含
              ONNX、音色和词典文件的完整模型文件夹。
            </p>
            <button
              className="wide-button"
              disabled={working}
              onClick={() =>
                run(async () => {
                  if (!window.framecraft) throw new Error("下载模型需要桌面版");
                  const prepared =
                    await window.framecraft.downloadSpeechModel(engine);
                  update({ modelDir: "" });
                  toast(`配音模型已就绪：${prepared.directory}`);
                })
              }
            >
              下载配音模型
            </button>
            <label className="field">
              配音设备
              <select
                aria-label="配音设备"
                value={options.device}
                onChange={(e) =>
                  update({ device: e.target.value as "cpu" | "auto" })
                }
              >
                <option value="cpu">CPU · sherpa-onnx</option>
                <option value="auto">自动 · CPU</option>
              </select>
            </label>
            <label className="field">
              配音语速
              <select
                aria-label="配音语速"
                value={options.speed}
                onChange={(e) => update({ speed: Number(e.target.value) })}
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×{speed === 1 ? " · 正常" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="narration-offline">
              <input
                type="checkbox"
                checked={options.offline}
                onChange={(e) => update({ offline: e.target.checked })}
              />
              仅使用已下载的依赖和模型
            </label>
            <p className="small-note">
              Kokoro 支持中英文混读，VITS
              提供中文音色。首次运行准备本地语音环境，缺少模型时自动下载；生成过程中显示进度，可取消，文稿不上传云端。
            </p>
          </fieldset>
        </details>
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
            auditionToken.current++;
            player.current?.pause();
            setPlaying(false);
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
                auditionToken.current++;
                player.current?.pause();
                setPlaying(false);
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
                if (token !== auditionToken.current) {
                  audio.pause();
                  return;
                }
                setPlaying(true);
              });
            }}
          >
            {playing ? <Square size={14} /> : <Play size={14} />}
            {playing ? "停止试听" : "试听音频"}
          </button>
        </div>
      )}
    </div>
  );
}
