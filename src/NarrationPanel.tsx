import { useEffect, useRef, useState } from "react";
import { AudioLines, Play, Square, Type } from "lucide-react";
import {
  ttsModels,
  ttsOptionsSchema,
  type TtsEngine,
  type TtsOptions,
} from "../shared/tts";
import type { Editor } from "./useEditor";
import { timeLabel } from "./Preview";

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
    engine: "kokoro",
    voice: "zf_001",
    language: "zh",
    device: "cpu",
    speed: 1,
    instruction: "",
    offline: false,
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
    setOptions(asset.narration);
  };
  return (
    <div className="narration-panel">
      <p className="panel-intro">
        输入文稿，在本机生成配音，直接加入播放头所在位置。
      </p>
      <label className="field vertical">
        配音文字
        <textarea
          aria-label="配音文字"
          rows={7}
          maxLength={10000}
          placeholder="输入解说、教程或旁白文稿…"
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
      <label className="field vertical">
        配音模型
        <select
          aria-label="配音模型"
          value={options.engine}
          onChange={(e) => {
            const engine = e.target.value as TtsEngine;
            update({
              engine,
              voice: ttsModels[engine].voices[0].id,
              language: engine === "kokoro" ? "zh" : options.language,
              instruction: engine === "qwen-quality" ? options.instruction : "",
              device: engine === "indextts" ? "auto" : options.device,
            });
          }}
        >
          {Object.entries(ttsModels).map(([id, model]) => (
            <option key={id} value={id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
      {options.engine === "indextts" ? (
        <>
          <label className="field vertical">
            参考音频
            <select
              aria-label="参考音频"
              value={options.referenceAssetId ?? ""}
              onChange={(event) =>
                update({ referenceAssetId: event.target.value || undefined })
              }
            >
              <option value="">请选择 1–30 秒的干净人声</option>
              {editor.project.assets
                .filter(
                  (asset) =>
                    asset.kind === "audio" &&
                    asset.hasAudio &&
                    !asset.missing &&
                    asset.duration >= 1 &&
                    asset.duration <= 30,
                )
                .map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="wide-button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!window.framecraft)
                  throw new Error("导入参考音频需要桌面版");
                const asset =
                  await window.framecraft.selectNarrationReference();
                if (!asset) return;
                editor.addAssets([asset]);
                update({ referenceAssetId: asset.id });
              })
            }
          >
            导入参考音频
          </button>
          <p className="small-note">
            根据参考音频复刻音色，使用前 15 秒；参考音频会随工程保存。
          </p>
        </>
      ) : (
        <label className="field">
          配音音色
          <select
            value={options.voice}
            onChange={(e) => update({ voice: e.target.value })}
          >
            {ttsModels[options.engine].voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {options.engine !== "kokoro" && (
        <label className="field">
          配音语言
          <select
            value={options.language}
            onChange={(e) =>
              update({ language: e.target.value as "zh" | "en" })
            }
          >
            <option value="zh">中文</option>
            <option value="en">英语</option>
          </select>
        </label>
      )}
      <label className="field">
        配音设备
        <select
          value={options.device}
          onChange={(e) =>
            update({ device: e.target.value as TtsOptions["device"] })
          }
        >
          <option value="cpu">CPU · 通用</option>
          <option value="cuda">CUDA · NVIDIA 显卡</option>
          <option value="auto">
            {options.engine === "indextts"
              ? "自动 · 优先 NVIDIA 显卡"
              : "自动 · 优先兼容 CPU"}
          </option>
          {window.framecraft?.platform === "darwin" &&
            options.engine !== "indextts" && (
              <option value="mps">MPS · Apple Silicon（实验）</option>
            )}
        </select>
      </label>
      <label className="field">
        配音语速
        <select
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
      {options.engine === "qwen-quality" && (
        <label className="field vertical">
          语气指令
          <textarea
            aria-label="语气指令"
            rows={2}
            maxLength={500}
            value={options.instruction}
            placeholder="例如：语气自然亲切，像在讲解教程"
            onChange={(e) => update({ instruction: e.target.value })}
          />
        </label>
      )}
      <label className="narration-offline">
        <input
          type="checkbox"
          checked={options.offline}
          onChange={(e) => update({ offline: e.target.checked })}
        />
        仅使用已下载的依赖和模型
      </label>
      <p className="small-note">
        {options.engine === "indextts"
          ? "IndexTTS 2.5 使用独立环境与参考音色；推荐 NVIDIA 显卡，首次模型下载为数 GB。"
          : options.engine === "kokoro"
            ? "轻量中文配音，可用 CPU；中英文混读中不常见的英文词可能读音不完整。"
            : "NVIDIA 显卡推荐先用 0.6B；1.7B 占用更多显存，CPU 推理较慢。"}
        {options.device === "auto" &&
          options.engine !== "indextts" &&
          " 自动模式准备 CPU 环境；使用 NVIDIA 显卡请选择 CUDA。"}
        {options.device === "cuda" &&
          " 首次 CUDA 配音需要下载 NVIDIA 版 PyTorch，下载量较大。"}
        首次联网准备，之后可离线生成，文稿不上传云端。
      </p>
      <button
        className="wide-button primary"
        disabled={
          busy ||
          !options.text.trim() ||
          (options.engine === "indextts" && !options.referenceAssetId)
        }
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
        生成配音并加入时间线
      </button>
      {generated && (
        <div className="tip-card narration-result">
          <b>{generated.name}</b>
          <p>{timeLabel(generated.duration)} · WAV · 参数随工程保存</p>
          <button
            disabled={busy}
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
            {playing ? "停止试听" : "试听配音"}
          </button>
        </div>
      )}
    </div>
  );
}
