import { describe, expect, it } from "vitest";
import { appendCaptionCues, captionClips } from "../shared/captions";
import { createProject, newText } from "../shared/model";
import {
  defaultCaptionSearchOptions as defaults,
  findCaptionMatches,
  replaceCaptionMatches,
} from "../shared/caption-search";

const projectWith = (...texts: string[]) =>
  appendCaptionCues(
    createProject(),
    texts.map((text, index) => ({
      start: index * 3,
      end: index * 3 + 2,
      text,
    })),
  ).project;
const texts = (project: ReturnType<typeof projectWith>) =>
  captionClips(project).map((clip) => clip.text);

describe("字幕查找替换", () => {
  it("按时间和字符位置枚举全部匹配，默认忽略大小写且按字面搜索", () => {
    const project = projectWith("Cat cat concatenate", "CAT a.b aXb");
    const result = findCaptionMatches(project, "cat", defaults);
    expect(result.matches.map(({ start, end }) => [start, end])).toEqual([
      [0, 3],
      [4, 7],
      [11, 14],
      [0, 3],
    ]);
    expect(findCaptionMatches(project, "a.b", defaults).matches).toHaveLength(
      1,
    );
    expect(findCaptionMatches(project, "", defaults).matches).toEqual([]);
  });
  it("支持大小写、全词、正则和中文边界，错误正则可恢复", () => {
    const project = projectWith("Cat cat concatenate cat_1", "字幕，字幕表");
    expect(
      findCaptionMatches(project, "cat", {
        ...defaults,
        matchCase: true,
        wholeWord: true,
      }).matches,
    ).toHaveLength(1);
    expect(
      findCaptionMatches(project, "cat", { ...defaults, wholeWord: true })
        .matches,
    ).toHaveLength(2);
    expect(
      findCaptionMatches(project, "字幕", { ...defaults, wholeWord: true })
        .matches,
    ).toHaveLength(1);
    expect(
      findCaptionMatches(project, "c.t", { ...defaults, regex: true }).matches,
    ).toHaveLength(4);
    expect(
      findCaptionMatches(project, "[", { ...defaults, regex: true }).error,
    ).toBeTruthy();
    expect(findCaptionMatches(project, "[", defaults).error).toBeUndefined();
  });
  it("逐个替换仅改变当前匹配，全部替换保持时间、样式和原文偏移", () => {
    const project = projectWith("cat cat", "cat");
    const match = findCaptionMatches(project, "cat", defaults).matches[1];
    const single = replaceCaptionMatches(
      project,
      "cat",
      "tiger",
      defaults,
      match,
    );
    expect(texts(single.project)).toEqual(["cat tiger", "cat"]);
    expect(single).toMatchObject({ changed: 1, occurrences: 1 });
    const all = replaceCaptionMatches(project, "cat", "cat cat", defaults);
    expect(texts(all.project)).toEqual(["cat cat cat cat", "cat cat"]);
    expect(all).toMatchObject({ changed: 2, occurrences: 3 });
    expect(captionClips(all.project)[0]).toMatchObject({
      start: 0,
      duration: 2,
      style: captionClips(project)[0].style,
    });
    expect(texts(project)).toEqual(["cat cat", "cat"]);
    expect(replaceCaptionMatches(project, "cat", "cat", defaults).project).toBe(
      project,
    );
  });
  it("支持正则捕获组、命名组及美元转义，字面搜索不解释替换文本", () => {
    const project = projectWith("item-12 item-34");
    const regex = { ...defaults, regex: true };
    expect(
      texts(
        replaceCaptionMatches(project, "item-(\\d+)", "编号$1", regex).project,
      ),
    ).toEqual(["编号12 编号34"]);
    expect(
      texts(
        replaceCaptionMatches(project, "item-(?<id>\\d+)", "$<id> $$ $&", regex)
          .project,
      ),
    ).toEqual(["12 $ item-12 34 $ item-34"]);
    expect(
      texts(replaceCaptionMatches(project, "item", "$1 $$", defaults).project),
    ).toEqual(["$1 $$-12 $1 $$-34"]);
  });
  it("保留大小写支持大小写单词、首字母及删除为空", () => {
    const project = projectWith("CAT cat Cat cAt");
    expect(
      texts(
        replaceCaptionMatches(project, "cat", "dog", {
          ...defaults,
          preserveCase: true,
        }).project,
      ),
    ).toEqual(["DOG dog Dog dog"]);
    expect(
      texts(
        replaceCaptionMatches(project, "cat", "", {
          ...defaults,
          preserveCase: true,
        }).project,
      ),
    ).toEqual(["   "]);
  });
  it("跳过锁定轨道与普通文本，范围限制不随当前导航改变", () => {
    const project = projectWith("cat", "cat");
    project.clips.push(newText(project.tracks[0].id, 0, 0, "cat"));
    const selected = captionClips(project)[1];
    const options = { ...defaults, clipIds: [selected.id] };
    expect(findCaptionMatches(project, "cat", options).matches).toHaveLength(1);
    expect(
      texts(replaceCaptionMatches(project, "cat", "dog", options).project),
    ).toEqual(["cat", "dog"]);
    project.tracks.find((track) => track.id === selected.trackId)!.locked =
      true;
    expect(findCaptionMatches(project, "cat", defaults).matches).toHaveLength(
      0,
    );
    expect(replaceCaptionMatches(project, "cat", "dog", defaults).project).toBe(
      project,
    );
  });
  it("零长度正则能插入文本且不会循环，过期匹配不改动无关字符", () => {
    const project = projectWith("abc");
    expect(
      texts(
        replaceCaptionMatches(project, "^|$", "!", { ...defaults, regex: true })
          .project,
      ),
    ).toEqual(["!abc!"]);
    const match = findCaptionMatches(project, "a", defaults).matches[0];
    const modified = {
      ...project,
      clips: project.clips.map((clip) => ({ ...clip, text: "xabc" })),
    };
    expect(
      replaceCaptionMatches(modified, "a", "b", defaults, match).project,
    ).toBe(modified);
  });
});
