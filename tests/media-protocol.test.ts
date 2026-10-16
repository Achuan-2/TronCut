import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serveMediaFile } from "../electron/media-protocol";

let root: string, file: string;
const contents = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-media-"));
  file = path.join(root, "视频.mp4");
  await fs.writeFile(file, contents);
});
afterAll(() => fs.rm(root, { recursive: true, force: true }));
const request = (range?: string, method = "GET") =>
  new Request("https://media/asset", {
    method,
    headers: range ? { Range: range } : {},
  });

describe("本地媒体字节分段响应", () => {
  it("完整响应声明大小与可跳转能力，HEAD 不发送正文", async () => {
    const response = await serveMediaFile(request(), file);
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-length")).toBe("256");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(contents);
    const head = await serveMediaFile(request("bytes=10-20", "HEAD"), file);
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("256");
    expect((await head.arrayBuffer()).byteLength).toBe(0);
  });
  it.each([
    ["bytes=100-149", 100, 149],
    ["bytes=200-", 200, 255],
    ["bytes=-20", 236, 255],
    ["bytes=250-999", 250, 255],
    ["bytes=0-", 0, 255],
    ["bytes=-999", 0, 255],
  ])("%s 的状态、位置、长度与实际正文一致", async (range, start, end) => {
    const response = await serveMediaFile(request(range), file);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes ${start}-${end}/256`,
    );
    expect(response.headers.get("content-length")).toBe(
      String(end - start + 1),
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      contents.subarray(start, end + 1),
    );
  });
  it.each(["bytes=256-", "bytes=20-10", "bytes=-0"])(
    "%s 越界时返回 416",
    async (range) => {
      const response = await serveMediaFile(request(range), file);
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */256");
      expect((await response.arrayBuffer()).byteLength).toBe(0);
    },
  );
  it("无效分段返回完整文件，空文件和丢失素材安全返回", async () => {
    for (const range of ["bytes=bad", "bytes=0-1,10-20"]) {
      const response = await serveMediaFile(request(range), file);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(contents);
    }
    const empty = path.join(root, "empty.mp4");
    await fs.writeFile(empty, "");
    expect(
      (await serveMediaFile(request(), empty)).headers.get("content-length"),
    ).toBe("0");
    expect((await serveMediaFile(request("bytes=0-"), empty)).status).toBe(416);
    expect(
      (await serveMediaFile(request(), path.join(root, "missing.mp4"))).status,
    ).toBe(404);
  });
});
