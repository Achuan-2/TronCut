import type { BehaviorPhase } from "./behaviors";

// Authored values from 媒体行为动画照搬.tscproj, editRate = 705600000.
// The reference is a style demonstration: most clips share Shifting during/out.
const during: Partial<BehaviorPhase> = {
  style: "cut",
  easing: "circular-out",
  loopTime: 3.17,
  delay: 0,
  loopForever: true,
  loops: 1,
  shift: 5,
};
const outgoing: Partial<BehaviorPhase> = {
  style: "cut",
  easing: "exponential-out",
  duration: 13 / 30,
  speed: 93,
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
      duration: 988446720 / 705600000,
    },
    during,
    outgoing,
  },
  {
    id: "drift",
    name: "漂移",
    incoming: {
      style: "drift",
      easing: "quad-out",
      direction: "bottom",
      duration: 1647411200 / 705600000,
    },
    during,
    outgoing: {
      style: "drift",
      easing: "quad-in",
      direction: "top",
      duration: 1317928960 / 705600000,
    },
  },
  {
    id: "fade",
    name: "淡入",
    incoming: {
      style: "fade",
      easing: "linear",
      duration: 1317928960 / 705600000,
    },
    during,
    outgoing: {
      style: "drop",
      easing: "quad-in",
      direction: "bottom",
      duration: 658964480 / 705600000,
    },
  },
  {
    id: "fly",
    name: "飞入",
    incoming: {
      style: "fly",
      easing: "linear",
      duration: 790757376 / 705600000,
    },
    during,
    outgoing,
  },
  {
    id: "grow",
    name: "增长",
    incoming: {
      style: "grow",
      easing: "spring",
      tension: 5,
      duration: 790757376 / 705600000,
    },
    during,
    outgoing,
  },
  {
    id: "hinge",
    name: "铰链",
    incoming: {
      style: "hinge",
      easing: "spring",
      tension: 5,
      direction: "bottom",
      duration: 3228925952 / 705600000,
    },
    during,
    outgoing,
  },
  {
    id: "implode",
    name: "内爆",
    incoming: {
      style: "implode",
      easing: "linear",
      duration: 2899443712 / 3 / 705600000,
    },
    during,
    outgoing,
  },
  {
    id: "reveal",
    name: "显示",
    incoming: {
      style: "reveal",
      easing: "quad-out",
      direction: "left",
      duration: 2899443712 / 3 / 705600000,
    },
    during,
    outgoing,
  },
  {
    id: "cut",
    name: "切换",
    incoming: {
      style: "cut",
      easing: "spring",
      tension: 7,
      duration: 91 / 60,
    },
    during,
    outgoing,
  },
  {
    id: "slide",
    name: "滑入",
    incoming: {
      style: "slide",
      easing: "quad-out",
      direction: "left",
      duration: 1317928960 / 705600000,
    },
    during,
    outgoing,
  },
];
