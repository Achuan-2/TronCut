import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captionProcessingSchema,
  segmentCaptionCues,
  splitCaptionText,
  distributeCaptionParts,
} from "../shared/caption-processing";
import { processCaptionCues } from "../electron/caption-processing";
import { requestAi } from "../electron/ai";

afterEach(() => vi.restoreAllMocks());
const settings = {
  baseUrl: "https://ai.example.test/v1",
  model: "test-model",
  apiKey: "test-secret",
};
const signal = () => new AbortController().signal;
const options = (input = {}) => captionProcessingSchema.parse(input);
const response = (items: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ items }) } }],
    }),
  );

describe("字幕断句与 AI 精修", () => {
  it("标准断句保留中文词语、英文产品名称和完整分句", () => {
    expect(
      splitCaptionText(
        "大家好，今天给大家分享下让AI操控GraphPad Prism来画图的经验。",
        22,
        true,
      ),
    ).toEqual([
      "大家好，今天给大家分享下",
      "让AI操控GraphPad Prism来画图的经验。",
    ]);
    const text =
      "我这里用的是豆包电脑版，你就直接和豆包提供数据，指定分析方法，让它画图就可以了。";
    const parts = splitCaptionText(text, 22, true);
    expect(parts).toEqual([
      "我这里用的是豆包电脑版，",
      "你就直接和豆包提供数据，指定分析方法，",
      "让它画图就可以了。",
    ]);
    expect(parts.join("")).toBe(text);
    expect(
      parts.some((part) => part.endsWith("数") || part.startsWith("据")),
    ).toBe(false);
  });

  it("真实逐字时间优先于按字数估算，保留分句间停顿", () => {
    const cue = {
      start: 0,
      end: 8,
      text: "数据分析。下一句。",
      words: [
        { start: 0.2, end: 0.5, text: "数据" },
        { start: 0.5, end: 1, text: "分析。" },
        { start: 3, end: 4, text: "下一句。" },
      ],
    };
    expect(segmentCaptionCues([cue], options())).toEqual([
      { start: 0.2, end: 1, text: "数据分析。" },
      { start: 3, end: 4, text: "下一句。" },
    ]);
    // Missing/mismatched alignment falls back within the source interval.
    const estimated = distributeCaptionParts(
      { ...cue, words: [{ start: 0, end: 1, text: "错误" }] },
      ["数据分析。", "下一句。"],
    );
    expect(estimated[0].start).toBe(0);
    expect(estimated[0].end).toBe(estimated[1].start);
    expect(estimated[1].end).toBe(8);
  });

  it("模型 token 跨断点时不会制造重叠字幕，也不产生孤立标点", () => {
    const result = distributeCaptionParts(
      {
        start: 1,
        end: 5,
        text: "第一句第二句",
        words: [{ start: 1, end: 5, text: "第一句第二句" }],
      },
      ["第一句", "第二句"],
    );
    expect(result).toEqual([
      { start: 1, end: 3, text: "第一句" },
      { start: 3, end: 5, text: "第二句" },
    ]);
    expect(splitCaptionText("你好！！“这是另一句话。”", 8, true).join("")).toBe(
      "你好！！“这是另一句话。”",
    );
    expect(splitCaptionText("Use version 3.14. Next step.", 22, true)).toEqual([
      "Use version 3.14.",
      "Next step.",
    ]);
  });

  it("标准与自定义断句保留文字和原语音区间，不跨过静音", () => {
    const cues = [
      { start: 1, end: 5, text: "今天介绍字幕的使用方法。接下来开始演示！" },
      {
        start: 10,
        end: 14,
        text: "这是一段较长的字幕文本用于测试自定义的字数上限",
      },
    ];
    const result = segmentCaptionCues(
      cues,
      options({ segmentation: "custom", maxChars: 8 }),
    );
    expect(result.length).toBeGreaterThan(2);
    expect(result.map((c) => c.text).join("")).toBe(
      cues.map((c) => c.text).join(""),
    );
    expect(
      result.every((c) => c.end > c.start && (c.end <= 5 || c.start >= 10)),
    ).toBe(true);
    expect(result[0].start).toBe(1);
    expect(result.at(-1)!.end).toBe(14);
    expect(
      splitCaptionText("Hello wonderful world! Next one.", 15).join(" "),
    ).toContain("wonderful");
    expect(
      segmentCaptionCues(cues, options({ segmentation: "unlimited" })),
    ).toBe(cues);
  });
  it("标准模式完全离线，不读取 AI 配置", async () => {
    const resolve = vi.fn();
    const result = await processCaptionCues(
      [{ start: 0, end: 3, text: "第一句。第二句。" }],
      {},
      resolve,
      signal(),
      () => {},
    );
    expect(result.cues).toHaveLength(2);
    expect(resolve).not.toHaveBeenCalled();
  });
  it("AI 语义断句校验内容完全保留，再映射回原区间", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response([{ id: 0, segments: ["今天演示", "字幕功能。"] }]),
    );
    const result = await processCaptionCues(
      [{ start: 2, end: 6, text: "今天演示字幕功能。" }],
      options({ segmentation: "ai" }),
      async () => settings,
      signal(),
      () => {},
    );
    expect(result.warnings).toEqual([]);
    expect(result.cues.map((c) => c.text)).toEqual(["今天演示", "字幕功能。"]);
    expect(result.cues[0].start).toBe(2);
    expect(result.cues.at(-1)!.end).toBe(6);
  });
  it("AI 润色仅改变文字，保留字幕条数和时间", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      response([{ id: 0, text: "欢迎使用字幕功能。" }]),
    );
    const result = await processCaptionCues(
      [{ start: 4, end: 7, text: "欢迎大家使用字幕功能。" }],
      options({ segmentation: "unlimited", refinement: "polish" }),
      async () => settings,
      signal(),
      () => {},
    );
    expect(result).toEqual({
      cues: [{ start: 4, end: 7, text: "欢迎使用字幕功能。" }],
      warnings: [],
    });
  });
  it.each([
    [{ id: 0, segments: ["这是编造的内容"] }],
    [{ id: 1, segments: ["这是原文。"] }],
    [],
  ])("AI 改写原文、丢失或错置 ID 时回退", async (...items) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response(items));
    const cues = [{ start: 1, end: 3, text: "这是原文。" }];
    const result = await processCaptionCues(
      cues,
      options({ segmentation: "ai" }),
      async () => settings,
      signal(),
      () => {},
    );
    expect(result.cues).toEqual(cues);
    expect(result.warnings).toHaveLength(1);
  });
  it("未配置 AI 自动回退，服务失败不吞掉原字幕", async () => {
    const cues = [{ start: 0, end: 2, text: "原始字幕" }];
    const result = await processCaptionCues(
      cues,
      options({ refinement: "correct" }),
      async () => {
        throw new Error("未配置模型");
      },
      signal(),
      () => {},
    );
    expect(result.cues).toEqual(cues);
    expect(result.warnings[0]).toContain("未配置模型");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const fallback = await processCaptionCues(
      cues,
      options({ refinement: "polish" }),
      async () => settings,
      signal(),
      () => {},
    );
    expect(fallback.cues).toEqual(cues);
    expect(fallback.warnings.length).toBe(1);
  });
  it("取消任务必须中止，不按 AI 失败继续写入字幕", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      controller.abort();
      throw new Error("cancelled");
    });
    await expect(
      processCaptionCues(
        [{ start: 0, end: 2, text: "原字幕" }],
        options({ refinement: "polish" }),
        async () => settings,
        controller.signal,
        () => {},
      ),
    ).rejects.toThrow("任务已取消");
  });
  it("API 请求使用所选模型和密钥，HTTP 错误不会回显密钥或服务响应体", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("test-secret", { status: 401 }));
    await expect(
      requestAi(settings, "system", "user", signal()),
    ).rejects.toThrow("HTTP 401");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://ai.example.test/v1/chat/completions");
    expect(JSON.parse(String(init!.body)).model).toBe("test-model");
    expect(init!.headers).toMatchObject({
      Authorization: "Bearer test-secret",
    });
    expect(init!.redirect).toBe("error");
  });
});
