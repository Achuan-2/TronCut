export const animationEasings = [
  "auto",
  "exponential",
  "linear",
  "spring",
  "bounce",
] as const;
export type AnimationEasing = (typeof animationEasings)[number];
export const easingLabels: Record<AnimationEasing, string> = {
  auto: "自动",
  exponential: "指数缓入/缓出",
  linear: "线性",
  spring: "跳跃",
  bounce: "回弹",
};

export function easeProgress(
  progress: number,
  easing: AnimationEasing = "auto",
) {
  const p = Math.max(0, Math.min(1, progress));
  if (p === 0 || p === 1) return p;
  switch (easing) {
    case "linear":
      return p;
    case "exponential":
      return p < 0.5
        ? Math.pow(2, 20 * p - 10) / 2
        : (2 - Math.pow(2, -20 * p + 10)) / 2;
    case "spring":
      return 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
    case "bounce": {
      const shift =
        p < 1 / 2.75
          ? 0
          : p < 2 / 2.75
            ? 1.5 / 2.75
            : p < 2.5 / 2.75
              ? 2.25 / 2.75
              : 2.625 / 2.75;
      const base =
        p < 1 / 2.75
          ? 0
          : p < 2 / 2.75
            ? 0.75
            : p < 2.5 / 2.75
              ? 0.9375
              : 0.984375;
      return 7.5625 * Math.pow(p - shift, 2) + base;
    }
    default:
      return p * p * (3 - 2 * p);
  }
}

// FFmpeg evaluates these expressions with the same normalized progress as the
// preview. Keep the exact endpoints, including for the exponential curve.
export function easingExpression(
  progress: string,
  easing: AnimationEasing = "auto",
) {
  const p = `(${progress})`;
  switch (easing) {
    case "linear":
      return p;
    case "exponential":
      return `if(lte(${p},0),0,if(gte(${p},1),1,if(lt(${p},0.5),pow(2,20*${p}-10)/2,(2-pow(2,-20*${p}+10))/2)))`;
    case "spring":
      return `(1+2.70158*pow(${p}-1,3)+1.70158*pow(${p}-1,2))`;
    case "bounce": {
      const piece = (shift: number, base: number) =>
        `(7.5625*pow(${p}-${shift},2)+${base})`;
      return `if(lt(${p},${1 / 2.75}),${piece(0, 0)},if(lt(${p},${2 / 2.75}),${piece(1.5 / 2.75, 0.75)},if(lt(${p},${2.5 / 2.75}),${piece(2.25 / 2.75, 0.9375)},${piece(2.625 / 2.75, 0.984375)})))`;
    }
    default:
      return `(${p}*${p}*(3-2*${p}))`;
  }
}
