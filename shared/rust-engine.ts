import { engineBase64 } from "./generated/rust-engine";

interface EngineExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  engine_version(): number;
  index_new(): number;
  index_free(handle: number): void;
  index_add(
    handle: number,
    id: number,
    track: number,
    start: number,
    end: number,
  ): number;
  index_build(handle: number): void;
  index_query(
    handle: number,
    start: number,
    end: number,
    track: number,
    closed: number,
  ): number;
  index_results_ptr(handle: number): number;
}

let engine: EngineExports | undefined;
function getEngine(): EngineExports {
  if (!engine) {
    const bytes = Uint8Array.from(atob(engineBase64), (char) =>
      char.charCodeAt(0),
    );
    const loaded = new WebAssembly.Instance(new WebAssembly.Module(bytes))
      .exports as EngineExports;
    if (loaded.engine_version() !== 1)
      throw new Error("Rust 引擎版本不匹配，请重新构建");
    engine = loaded;
  }
  return engine;
}

/** Owns one Rust index; dispose it when evicting it from its cache. */
export class RustTimelineIndex {
  private readonly engine = getEngine();
  private handle = this.engine.index_new();

  constructor() {
    if (!this.handle) throw new Error("Rust 时间线索引已耗尽");
  }
  add(id: number, track: number, start: number, end: number) {
    if (
      !this.handle ||
      !this.engine.index_add(this.handle, id, track, start, end)
    )
      throw new Error("无效的时间线区间");
  }
  build() {
    this.engine.index_build(this.handle);
  }
  query(start: number, end = start, track = -1, closed = false): number[] {
    if (!this.handle) throw new Error("时间线索引已释放");
    const count = this.engine.index_query(
      this.handle,
      start,
      end,
      track,
      Number(closed),
    );
    const pointer = this.engine.index_results_ptr(this.handle);
    // Copy immediately: Rust owns the buffer and the next query may reuse it.
    return Array.from(
      new Uint32Array(this.engine.memory.buffer, pointer, count),
    );
  }
  dispose() {
    if (this.handle) this.engine.index_free(this.handle);
    this.handle = 0;
  }
}
