import { useEffect, useRef, useState } from "react";
import type { Asset } from "../shared/model";
import type { ClonedVoice } from "../shared/cloned-voices";
import CloneReferenceRecorder from "./CloneReferenceRecorder";

export default function ClonedVoiceFields({
  voiceId,
  busy,
  onSelect,
  onActivity,
  run,
}: {
  voiceId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onActivity: (active: boolean) => void;
  run: (task: () => Promise<unknown>) => void;
}) {
  const [voices, setVoices] = useState<ClonedVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [transcript, setTranscript] = useState("");
  const [reference, setReference] = useState<Asset | null>(null);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [recording, setRecording] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const currentReference = useRef<Asset | null>(null);
  const mounted = useRef(true);
  const processing = useRef(false);
  const listRequest = useRef(0);
  const referencePlayer = useRef<HTMLAudioElement>(null);

  function stopReferencePlayback(release = false) {
    const audio = referencePlayer.current;
    if (!audio) return;
    audio.pause();
    if (release) {
      audio.removeAttribute("src");
      audio.load();
    }
  }

  async function load() {
    const request = ++listRequest.current;
    setLoading(true);
    setError("");
    try {
      const items = await window.framecraft!.clonedVoices();
      if (!mounted.current || request !== listRequest.current) return;
      setVoices(items);
      if (!items.length) setCreating(true);
      if (!voiceId && items.length) onSelect(items[0].id);
    } catch (cause) {
      if (mounted.current) setError(`读取克隆音色失败：${String(cause)}`);
    } finally {
      if (mounted.current && request === listRequest.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      stopReferencePlayback(true);
      if (processing.current)
        void window.framecraft?.cancelTask().catch(() => {});
      if (currentReference.current)
        void window.framecraft
          ?.releaseNarrationReference(currentReference.current.id)
          .catch(() => {});
    };
  }, []);
  useEffect(() => {
    setConfirmDelete(false);
  }, [voiceId]);

  async function replaceReference(asset: Asset) {
    stopReferencePlayback(true);
    const previous = currentReference.current;
    currentReference.current = asset;
    if (previous)
      await window.framecraft?.releaseNarrationReference(previous.id);
    if (!mounted.current) {
      await window.framecraft?.releaseNarrationReference(asset.id);
      return;
    }
    setReference(asset);
    setTranscript("");
    setReferenceUrl("");
    setError("");
    if (!name.trim()) setName(asset.name.replace(/\.[^.]+$/, "").slice(0, 80));
    const url = await window.framecraft!.mediaUrl(asset.id);
    if (mounted.current && currentReference.current?.id === asset.id)
      setReferenceUrl(url);
  }
  function perform(operation: () => Promise<void>) {
    setError("");
    run(async () => {
      processing.current = true;
      try {
        await operation();
      } catch (cause) {
        if (mounted.current) setError(String(cause).replace(/^Error: /, ""));
      } finally {
        processing.current = false;
      }
    });
  }

  return (
    <section className="cloned-voice-fields">
      <label className="field vertical">
        配音音色
        <select
          aria-label="配音音色"
          value={voiceId}
          disabled={loading || recording}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">
            {loading ? "正在读取克隆音色…" : "请选择已保存的克隆音色"}
          </option>
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {voice.name}
            </option>
          ))}
          {voiceId && !voices.some((voice) => voice.id === voiceId) && (
            <option value={voiceId}>原克隆音色不可用</option>
          )}
        </select>
      </label>
      <div className="clone-toolbar">
        <button
          type="button"
          disabled={busy || recording}
          onClick={() => setCreating((value) => !value)}
        >
          {creating ? "收起创建音色" : "创建克隆音色"}
        </button>
        <button
          type="button"
          disabled={
            busy || recording || !voices.some((voice) => voice.id === voiceId)
          }
          onClick={() => setConfirmDelete((value) => !value)}
        >
          删除音色
        </button>
      </div>
      {confirmDelete && (
        <div className="clone-delete-confirm">
          <p>
            删除“{voices.find((voice) => voice.id === voiceId)?.name}
            ”？已生成的配音仍可播放。
          </p>
          <button
            type="button"
            onClick={() =>
              perform(async () => {
                await window.framecraft!.deleteClonedVoice(voiceId);
                onSelect("");
                setConfirmDelete(false);
                const items = await window.framecraft!.clonedVoices();
                if (mounted.current) {
                  setVoices(items);
                  onSelect(items[0]?.id ?? "");
                  if (!items.length) setCreating(true);
                }
              })
            }
          >
            确认删除音色
          </button>
        </div>
      )}
      {creating && (
        <div className="clone-create">
          <p className="small-note">
            使用 3–30 秒清晰、无背景音乐的参考声音，可导入文件或直接录音。
          </p>
          <button
            type="button"
            disabled={busy || recording}
            onClick={() =>
              perform(async () => {
                const asset =
                  await window.framecraft!.selectNarrationReference();
                if (asset) await replaceReference(asset);
              })
            }
          >
            导入参考音频文件
          </button>
          <CloneReferenceRecorder
            busy={busy}
            onRecorded={(asset) => {
              void replaceReference(asset).catch((cause) =>
                setError(String(cause)),
              );
            }}
            onActivity={(active) => {
              setRecording(active);
              if (active) stopReferencePlayback();
              onActivity(active);
            }}
            onError={setError}
          />
          {reference && (
            <p className="small-note">
              参考声音：{reference.name} · {reference.duration.toFixed(1)} 秒
            </p>
          )}
          {referenceUrl && (
            <audio
              ref={referencePlayer}
              aria-label="试听克隆参考音频"
              controls
              preload="metadata"
              src={referenceUrl}
            />
          )}
          <label className="field vertical">
            音色名称
            <input
              aria-label="音色名称"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field vertical">
            参考音频文字
            <textarea
              aria-label="参考音频文字"
              rows={3}
              maxLength={2000}
              value={transcript}
              placeholder="填写参考声音中说出的原文，或先自动识别再校对。"
              onChange={(event) => setTranscript(event.target.value)}
            />
          </label>
          <div className="clone-toolbar">
            <button
              type="button"
              disabled={!reference || busy || recording}
              onClick={() =>
                perform(async () => {
                  const text =
                    await window.framecraft!.transcribeNarrationReference(
                      reference!.id,
                    );
                  if (
                    mounted.current &&
                    currentReference.current?.id === reference!.id
                  )
                    setTranscript(text);
                })
              }
            >
              自动识别参考文字
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                !reference ||
                !name.trim() ||
                !transcript.trim() ||
                busy ||
                recording
              }
              onClick={() =>
                perform(async () => {
                  const voice = await window.framecraft!.createClonedVoice({
                    name,
                    transcript,
                    referenceAssetId: reference!.id,
                  });
                  if (mounted.current) {
                    setVoices((items) => [voice, ...items]);
                    onSelect(voice.id);
                    setCreating(false);
                  }
                })
              }
            >
              克隆并保存音色
            </button>
          </div>
          <p className="small-note">
            首次创建会下载 LuxTTS ONNX
            模型；音色保存在本机，之后直接选择即可配音。
          </p>
        </div>
      )}
      {error && (
        <p className="small-note" role="alert">
          {error}{" "}
          <button
            type="button"
            disabled={busy || recording}
            onClick={() => void load()}
          >
            刷新音色库
          </button>
        </p>
      )}
    </section>
  );
}
