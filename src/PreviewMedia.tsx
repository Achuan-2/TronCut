import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorPreferences } from "../shared/editor-preferences";
import { mediaAssetUrl } from "../shared/media-url";
import {
  createPreviewMediaController,
  type PreviewMediaState,
} from "./preview-media";

export default function PreviewMedia(
  props: PreviewMediaState & {
    previewQuality: EditorPreferences["program"]["previewQuality"];
  },
) {
  const { clip, asset, playing, previewQuality } = props;
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const controller =
    useRef<ReturnType<typeof createPreviewMediaController>>(undefined);
  const [available, setAvailable] = useState(false);
  const [revision, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  const preview =
    asset.kind === "video" && (previewQuality === "smooth" || !!asset.animated);
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
  const url = mediaAssetUrl(asset.id, preview, revision);
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
    controller.current?.update(props);
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
