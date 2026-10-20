import type { BehaviorPhase } from "./behaviors";

// Motion styles follow the Camtasia reference; these combinations and timings
// are authored for everyday use. Entry clocks are calibrated against the
// 30 fps reference; see docs/media-behavior-timing.md for measured settling.
const hold: Partial<BehaviorPhase> = { style: "none" };
const softPulse: Partial<BehaviorPhase> = {
  style: "pulse",
  easing: "smoothstep",
  intensity: 3,
  loopTime: 3,
};
export const mediaBehaviorDefinitions: {
  id: string;
  name: string;
  incoming: Partial<BehaviorPhase>;
  during: Partial<BehaviorPhase>;
  outgoing: Partial<BehaviorPhase>;
}[] = [
  {
    id: "bounce-in",
    name: "弹入",
    incoming: {
      style: "bounce-in",
      easing: "back-out",
      direction: "top",
      duration: 25 / 30,
      speed: 77,
    },
    during: softPulse,
    outgoing: { style: "shrink", easing: "quad-in", duration: 0.35 },
  },
  {
    id: "drift",
    name: "漂移",
    incoming: {
      style: "drift",
      easing: "quad-out",
      direction: "bottom",
      duration: 60 / 30,
      speed: 77,
    },
    during: {
      style: "drift",
      easing: "smoothstep",
      intensity: 6,
      rotation: 2,
      loopTime: 4,
    },
    outgoing: {
      style: "drift",
      easing: "quad-in",
      direction: "top",
      duration: 0.8,
    },
  },
  {
    id: "fade",
    name: "淡入",
    incoming: {
      style: "fade",
      easing: "linear",
      duration: 1317928960 / 705600000,
      speed: 77,
    },
    during: hold,
    outgoing: {
      style: "fade",
      easing: "smoothstep",
      duration: 0.65,
    },
  },
  {
    id: "fly",
    name: "飞入",
    incoming: {
      style: "fly",
      easing: "linear",
      duration: 31 / 30,
      speed: 77,
    },
    during: hold,
    outgoing: { style: "fly", easing: "quad-in", duration: 0.55 },
  },
  {
    id: "grow",
    name: "增长",
    incoming: {
      style: "grow",
      easing: "spring",
      tension: 5,
      duration: 44 / 30,
      springDuration: 2,
      speed: 77,
    },
    during: softPulse,
    outgoing: { style: "shrink", easing: "quad-in", duration: 0.45 },
  },
  {
    id: "hinge",
    name: "铰链",
    incoming: {
      style: "hinge",
      easing: "spring",
      tension: 5,
      direction: "bottom",
      duration: 52 / 30,
      springDuration: 1,
      speed: 77,
    },
    during: hold,
    outgoing: {
      style: "hinge",
      direction: "bottom",
      easing: "quad-in",
      duration: 0.6,
    },
  },
  {
    id: "implode",
    name: "内爆",
    incoming: {
      style: "implode",
      easing: "linear",
      duration: 40 / 30,
      speed: 77,
    },
    during: hold,
    outgoing: { style: "explode", easing: "quad-in", duration: 0.65 },
  },
  {
    id: "reveal",
    name: "显示",
    incoming: {
      style: "reveal",
      easing: "quad-out",
      direction: "left",
      shift: 8,
      duration: 2899443712 / 3 / 705600000,
      speed: 77,
    },
    during: hold,
    outgoing: {
      style: "reveal",
      direction: "right",
      shift: 8,
      easing: "quad-in",
      duration: 0.6,
    },
  },
  {
    id: "cut",
    name: "切换",
    incoming: {
      style: "cut",
      easing: "spring",
      tension: 7,
      duration: 52 / 30,
      springDuration: 1.8,
      speed: 77,
    },
    during: { style: "cut", easing: "smoothstep", shift: 2, loopTime: 3 },
    outgoing: { style: "cut", easing: "quad-in", duration: 0.35, speed: 93 },
  },
  {
    id: "slide",
    name: "滑入",
    incoming: {
      style: "slide",
      easing: "quad-out",
      direction: "left",
      duration: 55 / 30,
      speed: 77,
    },
    during: hold,
    outgoing: {
      style: "slide",
      direction: "right",
      easing: "quad-in",
      duration: 0.55,
    },
  },
];
