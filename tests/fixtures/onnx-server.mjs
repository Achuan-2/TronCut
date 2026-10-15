import fs from "node:fs/promises";
import readline from "node:readline";

let requests = 0;
for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  const request = JSON.parse(await fs.readFile(message.request, "utf8"));
  if (request.crash) process.exit(7);
  if (request.delay)
    await new Promise((resolve) => setTimeout(resolve, request.delay));
  process.stdout.write('TRONCUT_PROGRESS {"percent":50,"label":"缓存进度"}\n');
  requests++;
  if (!request.fail) {
    await fs.writeFile(
      message.output,
      JSON.stringify({
        pid: process.pid,
        requests,
        downloadTemp: process.env.TRONCUT_ONNX_DOWNLOAD_TEMP,
        messageTemp: message.downloadTemp,
      }),
    );
  }
  const result = Buffer.from(
    "TRONCUT_RESULT " +
      JSON.stringify({
        id: message.id,
        ok: !request.fail,
        error: request.fail ? "无效模型" : undefined,
      }) +
      "\n",
  );
  // UTF-8 and protocol lines may be split at any byte by OS pipes.
  for (let offset = 0; offset < result.length; offset += 3)
    process.stdout.write(result.subarray(offset, offset + 3));
}
