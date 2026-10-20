import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorPreferences } from "../shared/editor-preferences";
import type { Asset } from "../shared/model";
import { mediaAssetUrl } from "../shared/media-url";
import {
  createPreviewMediaController,
  type PreviewMediaState,
} from "./preview-media";

export default function PreviewMedia(
  props: PreviewMediaState & {
    previewQuality: EditorPreferences["program"]["previewQuality"];
    normalizedAudio?: Asset;
  },
) {
  const { clip, asset, playing, previewQuality, normalizedAudio } = props;
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const controller =
    useRef<ReturnType<typeof createPreviewMediaController>>(undefined);
  const [available, setAvailable] = useState(false);
  const [revision, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  const preview =
    clip.kind === "video" && (previewQuality === "smooth" || !!asset.animated);
  useEffect(() => {
    setAvailable(false);
    setRevision(0);
    if (!preview || !window.framecraft) return;
    let active = true;
    const unsubscribe = window.framecraft.onPreviewProxyReady((id) => {
      if (active && id === asset.id) setAvailable(true);
    });
    void window.framecraft
      .previewProxyAvailable(asset.id)
      .then((ready) => {
        if (active && ready) setAvailable(true);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, [asset.id, asset.path, preview]);
  useEffect(() => {
    // Upgrade before the first decoded frame or while paused. Never reload a
    // working decoder in the middle of playback just because a proxy finished.
    if (available && (!playing || (ref.current?.readyState ?? 0) < 2))
      setRevision(1);
  }, [available, playing]);
  const audioOnly = clip.kind === "audio";
  const url = mediaAssetUrl(
    audioOnly && normalizedAudio ? normalizedAudio.id : asset.id,
    preview,
    revision,
  );
  useLayoutEffect(() => {
    const media = ref.current;
    if (!media) return;
    setFailed(false);
    const next = createPreviewMediaController(media);
    controller.current = next;
    return () => {
      next.dispose();
      controller.current = undefined;
    };
  }, [url, asset.missing]);
  useLayoutEffect(() => {
    controller.current?.update({
      ...props,
      muted: props.muted || (!audioOnly && !!normalizedAudio),
    });
  });
  if (asset.missing)
    return (
      <div className="offline">
        素材离线
        <br />
        {asset.name}
      </div>
    );
  if (clip.kind === "image")
    return <img draggable={false} src={url} alt={asset.name} />;
  return (
    <>
      {clip.kind === "audio" ? (
        <audio
          ref={ref}
          crossOrigin="anonymous"
          data-normalized-audio={
            normalizedAudio || asset.id.startsWith("loudness-")
              ? "1"
              : undefined
          }
          src={url}
          preload="auto"
          onError={() => setFailed(true)}
        />
      ) : (
        <video
          ref={ref}
          crossOrigin="anonymous"
          src={url}
          preload="auto"
          playsInline
          loop={clip.loop}
          onError={() => setFailed(true)}
        />
      )}
      {!audioOnly && normalizedAudio && (
        <PreviewMedia
          {...props}
          normalizedAudio={undefined}
          clip={{ ...clip, kind: "audio", podcast: false }}
          asset={normalizedAudio}
        />
      )}
      {failed && (
        <div className="offline">
          素材无法播放
          <br />
          {asset.name}
        </div>
      )}
    </>
  );
}
