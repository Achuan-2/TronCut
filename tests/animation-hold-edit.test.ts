import { describe, expect, it } from "vitest";
import { newText } from "../shared/model";
import { heldAnimationEndpoint, animationRanges } from "../shared/animation-ranges";
import { setKeyframeTransform, splitClip, transformAt } from "../shared/editor";
import { createProject } from "../shared/model";
import { addAnimationKeyframe } from "../shared/animation-edit";

function fadingClip() {
  const clip = { ...newText("titles", 10), duration: 8 };
  clip.keyframes = [
    { time: 0, value: { ...clip.transform, opacity: 1 } },
    { time: 1, value: { ...clip.transform, opacity: 0 }, animation: true },
    { time: 3, value: { ...clip.transform, opacity: 0 } },
    { time: 4, value: { ...clip.transform, opacity: 1 }, animation: true },
  ];
  return clip;
}

describe("播放头右侧静止区间的动画属性编辑", () => {
  it("编辑最近动画末尾，不覆盖另一段动画或素材初始属性", () => {
    const clip = fadingClip();
    const target = heldAnimationEndpoint(clip, 6)!;
    expect(target).toEqual({ time: 4, side: "end" });
    const edited = setKeyframeTransform(clip, { opacity: 0.6 }, target.time);
    expect(edited.transform).toEqual(clip.transform);
    expect(edited.keyframes.map((frame) => frame.value.opacity)).toEqual([1, 0, 0, 0.6]);
    expect(transformAt(edited, 6).opacity).toBe(0.6);
    expect(animationRanges(edited)).toEqual(animationRanges(clip));
  });

  it("两段动画之间编辑前一末尾并同步静止区间，保持后一末尾", () => {
    const clip = fadingClip();
    for (const time of [1, 2, 3]) {
      const target = heldAnimationEndpoint(clip, time)!;
      expect(target).toEqual({ time: 1, side: "end" });
      const edited = setKeyframeTransform(clip, { opacity: 0.25 }, target.time);
      expect(edited.keyframes.map((frame) => frame.value.opacity)).toEqual([1, 0.25, 0.25, 1]);
      expect(animationRanges(edited)).toEqual(animationRanges(clip));
    }
  });

  it("动画内部、无动画、片段外不误选之前的末尾", () => {
    const clip = fadingClip();
    for (const time of [-1, 0, 0.5, 3.5, 8.1, NaN])
      expect(heldAnimationEndpoint(clip, time)).toBeNull();
    expect(heldAnimationEndpoint(newText("titles", 0), 2)).toBeNull();
    expect(heldAnimationEndpoint(clip, 8)).toEqual({ time: 4, side: "end" });
  });

  it("显式添加的相同起止状态仍有可编辑末尾", () => {
    const added = addAnimationKeyframe(newText("titles", 0), 2, 30)!.clip;
    expect(heldAnimationEndpoint(added, 3)).toEqual({ time: 2, side: "end" });
  });

  it("拆分后使用关键帧时钟，裁切出的伪末尾不可编辑", () => {
    const clip = fadingClip();
    const project = { ...createProject(), clips: [clip] };
    const split = splitClip(project, clip.id, clip.start + 2);
    expect(heldAnimationEndpoint(split.clips[1], 3)).toEqual({ time: 4, side: "end" });
    const during = splitClip(project, clip.id, clip.start + 3.5).clips[0];
    expect(heldAnimationEndpoint(during, 3.4)).toBeNull();
    expect(heldAnimationEndpoint(during, during.duration)).toBeNull();
  });
});
