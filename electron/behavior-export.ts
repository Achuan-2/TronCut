import type { Clip } from "../shared/model";
import {
  behaviorGlyphCount,
  behaviorWindows,
  phaseSeconds,
  type BehaviorPhase,
} from "../shared/behaviors";

type MotionExpressions = Record<
  "x" | "y" | "scale" | "rotation" | "opacity",
  string
>;
const identity = (): MotionExpressions => ({
  x: "0",
  y: "0",
  scale: "1",
  rotation: "0",
  opacity: "1",
});
function eased(p: string, easing: BehaviorPhase["easing"], tension = 7) {
  switch (easing) {
    case "linear":
      return p;
    case "quad-in":
      return `pow(${p},4)`;
    case "quad-in-out":
      return `if(lt(${p},0.5),8*pow(${p},4),1-pow(-2*(${p})+2,4)/2)`;
    case "spring":
      return `if(lte(${p},0),0,if(gte(${p},1),1,1-exp(-${tension}*(${p}))*cos((${p})*PI*${tension / 2 + 1})))`;
    case "circular-out":
      return `sqrt(max(0,1-pow((${p})-1,2)))`;
    case "exponential-out":
      return `if(gte(${p},1),1,1-pow(2,-10*(${p})))`;
    case "bounce":
      return `(1-abs(cos((${p})*PI*2.5))*pow(1-(${p}),2))`;
    default:
      return `(1-pow(1-(${p}),4))`;
  }
}
function transition(phase: BehaviorPhase, progress: string): MotionExpressions {
  const result = identity();
  if (phase.style === "none" || phase.type !== "whole") return result;
  const p = `clip(${progress},0,1)`,
    hidden = `(1-(${eased(p, phase.easing, phase.tension)}))`;
  result.opacity = phase.style === "reveal" ? `gt(${p},0)` : p;
  if (phase.style === "fade")
    result.opacity = `clip(${eased(p, phase.easing, phase.tension)},0,1)`;
  if (phase.style === "cut") result.x = `(-2*${hidden})`;
  if (["slide", "fly", "drift"].includes(phase.style)) {
    const distance =
      phase.style === "fly" ? 5 : phase.style === "drift" ? 2 : 1.5;
    const key = ["left", "right"].includes(phase.direction) ? "x" : "y";
    result[key] =
      `(${hidden}*${distance * (["left", "top"].includes(phase.direction) ? -1 : 1)})`;
  }
  if (["pop", "scale"].includes(phase.style))
    result.scale = `max(0.01,${eased(p, phase.easing, phase.tension)})`;
  if (phase.style === "bounce")
    result.y = `(-3*${hidden}-abs(sin((${p})*PI*3))*${hidden})`;
  if (phase.style === "drift") result.rotation = `(-20*${hidden})`;
  if (phase.style === "explode") {
    result.x = `(5*${hidden})`;
    result.rotation = `(180*${hidden})`;
    result.scale = `(1+${hidden})`;
  }
  return result;
}
function during(phase: BehaviorPhase, time: string): MotionExpressions {
  const result = identity();
  if (phase.type !== "whole") return result;
  const period = phase.loopTime + phase.delay;
  const within = `mod(${time},${period})`;
  const clock = eased(
      `clip((${within})/${phase.loopTime},0,1)`,
      phase.easing,
      phase.tension,
    ),
    wave = `sin((${clock})*PI*2)`,
    intensity = phase.intensity / 100;
  if (["pulse", "scale", "pop"].includes(phase.style))
    result.scale = `(1+${intensity}*${wave})`;
  else if (["sway", "drift"].includes(phase.style))
    result.rotation = `(${phase.intensity}*${wave})`;
  else if (phase.style === "shake")
    result.x = `(${intensity}*sin((${clock})*PI*14))`;
  else if (["fade", "reveal"].includes(phase.style))
    result.opacity = `(1-${intensity}*(0.5+0.5*${wave}))`;
  else if (phase.style === "cut") result.x = `(${phase.shift / 100}*${wave})`;
  else if (phase.style !== "none") result.y = `(-${intensity}*${wave})`;
  for (const key of Object.keys(result) as (keyof MotionExpressions)[]) {
    const neutral = key === "scale" || key === "opacity" ? "1" : "0";
    if (result[key] !== neutral)
      result[key] =
        `if(lt(${time},0)+gte(${within},${phase.loopTime})${phase.loopForever ? "" : `+gte(${time},${period * phase.loops})`},${neutral},${result[key]})`;
  }
  return result;
}
/** The same phase boundaries and curves as the preview, evaluated by FFmpeg. */
export function objectBehaviorExpressions(
  clip: Pick<Clip, "start" | "kind" | "text" | "behaviors">,
  clock: string,
): MotionExpressions {
  const result = identity();
  for (const behavior of clip.behaviors ?? []) {
    if (!behavior.enabled) continue;
    const windows = behaviorWindows(behavior, behaviorGlyphCount(clip));
    const time = `(${clock}-${clip.start + behavior.start})`;
    const incoming = transition(
      behavior.incoming,
      `(${time})/${Math.max(0.001, phaseSeconds(behavior.incoming) * windows.ratio)}`,
    );
    const outgoing = transition(
      behavior.outgoing,
      `1-((${time})-${behavior.duration - windows.outgoing})/${Math.max(0.001, phaseSeconds(behavior.outgoing) * windows.ratio)}`,
    );
    const middle = during(behavior.during, `(${time})-${windows.incoming}`);
    for (const key of Object.keys(result) as (keyof MotionExpressions)[]) {
      const neutral = key === "scale" || key === "opacity" ? "1" : "0";
      if (
        incoming[key] === neutral &&
        outgoing[key] === neutral &&
        middle[key] === neutral
      )
        continue;
      const value = `if(lt(${time},0)+gte(${time},${behavior.duration}),${neutral},if(lt(${time},${windows.incoming}),${incoming[key]},if(gte(${time},${behavior.duration - windows.outgoing}),${outgoing[key]},${middle[key]})))`;
      result[key] =
        `(${result[key]}${key === "scale" || key === "opacity" ? "*" : "+"}(${value}))`;
    }
  }
  return result;
}
