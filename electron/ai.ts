import type { AiSettings } from "../shared/preferences";

async function responseJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("AI 服务没有返回内容");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("AI 返回内容过大");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("AI 服务没有返回有效 JSON 响应");
  }
}

export async function listAiModels(
  settings: Omit<AiSettings, "model">,
  signal: AbortSignal,
): Promise<string[]> {
  const base = settings.baseUrl
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "");
  const timeout = AbortSignal.timeout(30000);
  let response: Response;
  try {
    response = await fetch(base.endsWith("/models") ? base : `${base}/models`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.any([signal, timeout]),
      headers: settings.apiKey
        ? { Authorization: `Bearer ${settings.apiKey}` }
        : {},
    });
  } catch {
    throw new Error(
      signal.aborted
        ? "任务已取消"
        : timeout.aborted
          ? "获取模型列表超时"
          : "无法获取模型列表，请检查 API 地址和网络",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `获取模型列表失败（HTTP ${response.status}），可检查接口或手动添加模型 ID`,
    );
  }
  const data = await responseJson(response);
  if (!Array.isArray(data.data))
    throw new Error("服务未返回有效模型列表，可手动添加模型 ID");
  const ids = data.data.flatMap((item: unknown) => {
    const id =
      typeof item === "object" && item !== null && "id" in item
        ? item.id
        : undefined;
    return typeof id === "string" && id.trim() && id.length <= 200
      ? [id.trim()]
      : [];
  });
  if (signal.aborted) throw new Error("任务已取消");
  return [...new Set<string>(ids)].sort((a, b) => a.localeCompare(b));
}

export async function requestAi(
  settings: AiSettings,
  system: string,
  user: string,
  signal: AbortSignal,
) {
  const base = settings.baseUrl.replace(/\/+$/, "");
  const endpoint = base.endsWith("/chat/completions")
    ? base
    : `${base}/chat/completions`;
  const timeout = AbortSignal.timeout(90000);
  const combined = AbortSignal.any([signal, timeout]);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      signal: combined,
      headers: {
        "Content-Type": "application/json",
        ...(settings.apiKey
          ? { Authorization: `Bearer ${settings.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        stream: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch {
    if (signal.aborted) throw new Error("任务已取消");
    throw new Error(
      timeout.aborted ? "AI 请求超时" : "无法连接 AI 服务，请检查地址和网络",
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `AI 服务返回 HTTP ${response.status}，请检查密钥、模型及服务额度`,
    );
  }
  // Keep model output bounded, including malformed or endless service responses.
  const data = await responseJson(response);
  if (signal.aborted) throw new Error("任务已取消");
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim())
    throw new Error("AI 没有返回有效文本");
  return text;
}
