import type { AiSettings } from "../shared/preferences";

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
  if (signal.aborted) throw new Error("任务已取消");
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("AI 服务没有返回有效 JSON 响应");
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim())
    throw new Error("AI 没有返回有效文本");
  return text;
}
