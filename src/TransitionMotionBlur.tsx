/** Keep vertical detail sharp while smearing only along the horizontal pan. */
export function TransitionBlurFilter({
  id,
  amount,
}: {
  id: string;
  amount: number;
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
      <feGaussianBlur stdDeviation={`${amount} 0`} edgeMode="duplicate" />
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
