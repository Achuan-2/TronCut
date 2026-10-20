import { useId } from "react";
import type { VisualEffectId } from "../shared/visual-effect-drag";
import "./VisualEffectPreview.css";

/** Local vector demos keep the preset library usable without media or network access. */
export default function VisualEffectPreview({
  effect,
  playing,
}: {
  effect: VisualEffectId;
  playing: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const scene = `${id}-scene`,
    checker = `${id}-checker`,
    sky = `${id}-sky`;
  const frame = `${id}-frame`,
    region = `${id}-region`,
    blur = `${id}-blur`;
  const landscape = <use href={`#${scene}`} />;
  const demo = () => {
    switch (effect) {
      case "rounded-corners":
      case "mask":
      case "media-matte":
        return <g clipPath={`url(#${frame})`}>{landscape}</g>;
      case "clip-speed":
        return (
          <>
            <g clipPath={`url(#${frame})`}>
              <g className="effect-preview-speed-scene">
                {landscape}
                <use href={`#${scene}`} x={128} />
              </g>
            </g>
            <g transform="translate(91 49)">
              <rect width={30} height={17} rx={4} fill="#14252dd9" />
              <text
                x={15}
                y={12}
                textAnchor="middle"
                fill="#fff"
                fontSize={11}
                fontWeight={700}
              >
                2×
              </text>
            </g>
          </>
        );
      case "shadow":
        return <g className="effect-preview-shadow">{landscape}</g>;
      case "remove-color":
        return (
          <>
            <rect
              className="effect-preview-key-background"
              width={128}
              height={72}
              fill="#35d560"
            />
            <path d="M36 72V61Q36 43 64 43Q92 43 92 61V72" fill="#e96d4d" />
            <path d="M56 43V51Q64 57 72 51V43" fill="#d79d77" />
            <ellipse cx={64} cy={28} rx={15} ry={19} fill="#f0c09b" />
            <path
              d="M48 28V22Q48 5 64 6Q83 6 80 30L74 19Q60 26 53 18Z"
              fill="#293241"
            />
            <path
              d="M57 33Q64 39 71 33"
              fill="none"
              stroke="#b16b57"
              strokeWidth={2}
            />
          </>
        );
      case "tint":
        return <g className="effect-preview-tint">{landscape}</g>;
      case "blur-region":
        return (
          <>
            {landscape}
            <g clipPath={`url(#${region})`}>
              <g filter={`url(#${blur})`}>{landscape}</g>
            </g>
            <rect
              className="effect-preview-blur-window"
              x={0}
              y={5}
              width={48}
              height={62}
              rx={4}
              fill="none"
              stroke="#e6f5ef"
              strokeWidth={1}
              strokeDasharray="3 2"
            />
          </>
        );
      case "border":
        return (
          <>
            {landscape}
            <rect
              className="effect-preview-border"
              width={128}
              height={72}
              fill="none"
              stroke="#f5eee2"
            />
          </>
        );
    }
  };
  return (
    <div
      className={`effect-card-preview ${effect} ${playing ? "is-playing" : ""}`}
      data-previewing={playing}
      aria-hidden="true"
    >
      <svg viewBox="0 0 160 90" focusable="false">
        <defs>
          <pattern
            id={checker}
            width={12}
            height={12}
            patternUnits="userSpaceOnUse"
          >
            <rect width={12} height={12} fill="#29363a" />
            <path d="M0 0H6V6H0ZM6 6H12V12H6Z" fill="#3d4a4f" />
          </pattern>
          <linearGradient id={sky} x2="0" y2="1">
            <stop stopColor="#e7b79c" />
            <stop offset="1" stopColor="#f7d7a7" />
          </linearGradient>
          <g id={scene}>
            <rect width={128} height={72} fill={`url(#${sky})`} />
            <circle cx={98} cy={18} r={10} fill="#fff0c1" />
            <path
              d="M0 47L24 16L43 36L65 8L95 40L112 23L128 46V72H0Z"
              fill="#637f96"
            />
            <path
              d="M12 31L24 16L34 30L24 26ZM51 24L65 8L80 27L65 21Z"
              fill="#e3e4d9"
            />
            <path
              d="M0 54L19 34L43 54L76 31L103 54L128 36V72H0Z"
              fill="#38686e"
            />
            <path d="M0 58Q30 49 63 57T128 53V72H0Z" fill="#71a5a4" />
            <path
              d="M45 60H73M83 64H113M25 67H58"
              fill="none"
              stroke="#b5d0ba"
              strokeWidth={2}
            />
            <path
              d="M0 65L16 56L35 72H0ZM106 72L117 59L128 64V72Z"
              fill="#254f50"
            />
            <path
              d="M11 39L3 56H8L1 65H21L14 56H19ZM120 40L113 55H117L110 65H128L123 55H127Z"
              fill="#284d50"
            />
          </g>
          <clipPath id={frame}>
            {effect === "media-matte" ? (
              <text
                className="effect-preview-matte"
                x={64}
                y={57}
                textAnchor="middle"
                fontSize={62}
                fontWeight={900}
                textLength={116}
                lengthAdjust="spacingAndGlyphs"
              >
                文字
              </text>
            ) : (
              <rect
                className={
                  effect === "rounded-corners"
                    ? "effect-preview-rounded"
                    : effect === "mask"
                      ? "effect-preview-mask"
                      : undefined
                }
                width={128}
                height={72}
              />
            )}
          </clipPath>
          {effect === "blur-region" && (
            <clipPath id={region}>
              <rect
                className="effect-preview-blur-window"
                x={0}
                y={5}
                width={48}
                height={62}
                rx={4}
              />
            </clipPath>
          )}
          <filter
            id={blur}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation={3} />
          </filter>
        </defs>
        <rect width={160} height={90} fill={`url(#${checker})`} />
        <g transform="translate(16 9)">{demo()}</g>
      </svg>
    </div>
  );
}
