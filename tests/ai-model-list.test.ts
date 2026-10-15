import { afterEach, expect, it, vi } from "vitest";
import { listAiModels } from "../electron/ai";

afterEach(() => vi.unstubAllGlobals());
it("模型列表按服务地址获取、使用共享密钥，去重排序并忽略无效模型 ID", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { id: "model-b" },
            { id: "model-a" },
            { id: "model-b" },
            {},
            { id: 12 },
          ],
        }),
      ),
    );
  vi.stubGlobal("fetch", fetch);
  expect(
    await listAiModels(
      { baseUrl: "https://service.example/v1/", apiKey: "secret" },
      new AbortController().signal,
    ),
  ).toEqual(["model-a", "model-b"]);
  expect(fetch.mock.calls[0][0]).toBe("https://service.example/v1/models");
  expect(fetch.mock.calls[0][1]).toMatchObject({
    method: "GET",
    redirect: "error",
    headers: { Authorization: "Bearer secret" },
  });
});
it("模型列表错误不回显服务响应及密钥，失败后允许手动添加", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("secret service diagnostic", { status: 401 }),
      ),
  );
  await expect(
    listAiModels(
      { baseUrl: "https://service.example/v1", apiKey: "secret" },
      new AbortController().signal,
    ),
  ).rejects.toThrow("HTTP 401");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [] }))),
  );
  await expect(
    listAiModels(
      { baseUrl: "https://service.example/v1", apiKey: "" },
      new AbortController().signal,
    ),
  ).rejects.toThrow("手动添加");
});
