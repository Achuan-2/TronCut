/** Keep vertical detail sharp while smearing only along the horizontal pan. */
export function TransitionBlurFilter({
  id,
  amount,
  animated = false,
}: {
  id: string;
  amount: number;
  animated?: boolean;
}) {
  return (
    <filter
      id={id}
      x="0%"
      y="0%"
      width="100%"
      height="100%"
      primitiveUnits="objectBoundingBox"
      colorInterpolationFilters="sRGB"
    >
      <feGaussianBlur stdDeviation={`${amount} 0`} edgeMode="duplicate">
        {animated && (
          <animate
            attributeName="stdDeviation"
            values={`0 0;0 0;${amount / 4} 0;${amount} 0;${amount / 4} 0;0 0;0 0`}
            keyTimes="0;0.2;0.2875;0.375;0.4625;0.55;1"
            dur="2.4s"
            repeatCount="indefinite"
          />
        )}
      </feGaussianBlur>
    </filter>
  );
}

export default function TransitionMotionBlur(
  props: Parameters<typeof TransitionBlurFilter>[0],
) {
  return (
    <svg className="effect-svg-definitions" aria-hidden="true">
      <defs>
        <TransitionBlurFilter {...props} />
      </defs>
    </svg>
  );
}
