import type { Clip } from "../shared/model";
import {
  behaviorGlyphCount,
  behaviorWindows,
  phaseSeconds,
  type BehaviorPhase,
} from "../shared/behaviors";

type MotionExpressions = Record<
  "x" | "y" | "scale" | "rotation" | "rotationX" | "rotationY" | "opacity",
  string
>;
const identity = (): MotionExpressions => ({
  x: "0",
  y: "0",
  scale: "1",
  rotation: "0",
  rotationX: "0",
  rotationY: "0",
  opacity: "1",
});
function eased(
  p: string,
  easing: BehaviorPhase["easing"],
  tension = 7,
  seconds = 1,
) {
  switch (easing) {
    case "linear":
      return p;
    case "quad-in":
      return `pow(${p},4)`;
    case "quad-in-out":
      return `if(lt(${p},0.5),8*pow(${p},4),1-pow(-2*(${p})+2,4)/2)`;
    case "spring": {
      const damping = tension / 2,
        delta = 50 - damping * damping;
      const time = `((${p})*${seconds})`;
      let spring: string;
      if (Math.abs(delta) < 1e-6)
        spring = `1-exp(-${damping}*${time})*(1+${damping}*${time})`;
      else {
        const frequency = Math.sqrt(Math.abs(delta));
        if (delta > 0)
          spring = `1-exp(-${damping}*${time})*(cos(${frequency}*${time})+${damping / frequency}*sin(${frequency}*${time}))`;
        else {
          const slow = -damping + frequency,
            fast = -damping - frequency;
          spring = `1-(${fast}*exp(${slow}*${time})-(${slow})*exp(${fast}*${time}))/(${fast - slow})`;
        }
      }
      return `if(lte(${p},0),0,if(gte(${p},1),1,${spring}))`;
    }
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
function transition(
  phase: BehaviorPhase,
  progress: string,
  entering: boolean,
): MotionExpressions {
  const result = identity();
  if (phase.style === "none" || phase.type !== "whole") return result;
  const p = `clip(${progress},0,1)`;
  const curve = eased(p, phase.easing, phase.tension, phaseSeconds(phase));
  const q = entering ? curve : `(1-(${curve}))`;
  const hidden = `(1-(${q}))`;
  result.opacity = entering ? `gt(${p},0)` : `lt(${p},1)`;
  if (phase.style === "fade" || phase.style === "reveal")
    result.opacity = `clip(${q},0,1)`;
  if (phase.style === "cut") result.y = `(-12.5*${hidden})`;
  if (["slide", "drift"].includes(phase.style)) {
    const distance = phase.style === "drift" ? 8 : 12;
    const key = ["left", "right"].includes(phase.direction) ? "x" : "y";
    result[key] =
      `(${hidden}*${distance * (["left", "top"].includes(phase.direction) ? -1 : 1)})`;
  }
  if (phase.style === "scale") result.scale = `max(0.01,${q})`;
  if (phase.style === "pop") {
    const horizontal =
      phase.direction === "left" || phase.direction === "right";
    result[horizontal ? "rotationY" : "rotationX"] = `(90*${hidden})`;
    result[horizontal ? "x" : "y"] =
      `((1-cos(${hidden}*PI/2))*${["left", "top"].includes(phase.direction) ? -0.5 : 0.5})`;
  }
  if (phase.style === "fly") result.scale = `(1/max(0.02,${q}))`;
  if (phase.style === "bounce")
    result.y = `(-3*${hidden}-abs(sin((${p})*PI*3))*${hidden})`;
  if (phase.style === "drift") result.rotation = `(25*${hidden})`;
  if (phase.style === "explode") {
    const angle = (-Math.PI * 3) / 4;
    result.x = `(${Math.cos(angle) * 12}*${hidden})`;
    result.y = `(${Math.sin(angle) * 12}*${hidden})`;
    result.rotation = `(90*${hidden})`;
    result.rotationY = `(180*${hidden})`;
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
      phase.loopTime,
    ),
    wave = `sin((${clock})*PI*2)`,
    envelope = `((1-cos((${clock})*PI*2))/2)`,
    intensity = phase.intensity / 100;
  if (["pulse", "scale"].includes(phase.style))
    result.scale = `(1+${intensity}*${envelope})`;
  else if (phase.style === "pop") {
    const horizontal =
      phase.direction === "left" || phase.direction === "right";
    const angle = `(${phase.rotation}*${envelope})`;
    result[horizontal ? "rotationY" : "rotationX"] = angle;
    result[horizontal ? "x" : "y"] =
      `((1-cos(${angle}*PI/180))*${["left", "top"].includes(phase.direction) ? -0.5 : 0.5})`;
  } else if (phase.style === "sway" || phase.style === "shake") {
    const t = `((${time})*${phase.frequency * (phase.style === "shake" ? 12 : 1)})`;
    result.x = `(${phase.horizontal / 100}*(sin(${t}*2.3)+sin(${t}*3.7)*0.5)/1.5)`;
    result.y = `(${phase.vertical / 100}*(sin(${t}*2.9)+sin(${t}*4.3)*0.5)/1.5)`;
    result.rotation = `(${phase.rotation * (phase.style === "shake" ? 1 : 0)}*sin(${t}*2.1))`;
  } else if (phase.style === "drift") {
    result.y = `(-${intensity}*${wave})`;
    result.rotation = `(${phase.rotation}*${wave})`;
  } else if (["fade", "reveal"].includes(phase.style))
    result.opacity = `(1-${intensity}*${envelope})`;
  else if (phase.style === "cut") result.y = `(${phase.shift / 100}*${wave})`;
  else if (phase.style !== "none") result.y = `(-${intensity}*${wave})`;
  for (const key of Object.keys(result) as (keyof MotionExpressions)[]) {
    const neutral = key === "scale" || key === "opacity" ? "1" : "0";
    if (result[key] !== neutral)
      result[key] =
        `if(lt(${time},0)+gte(${within},${phase.loopTime - 1e-9})*lt(${within},${period - 1e-9})${phase.loopForever ? "" : `+gte(${time},${period * phase.loops - 1e-9})`},${neutral},${result[key]})`;
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
      true,
    );
    const outgoing = transition(
      behavior.outgoing,
      `((${time})-${behavior.duration - windows.outgoing})/${Math.max(0.001, phaseSeconds(behavior.outgoing) * windows.ratio)}`,
      false,
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
