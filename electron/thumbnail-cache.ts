/** Bounded LRU for data URLs. Budget counts two bytes per UTF-16 code unit. */
export class ThumbnailMemoryCache {
  private readonly entries = new Map<string, string>();
  private bytes = 0;

  constructor(
    private readonly budget = 32 * 1024 * 1024,
    private readonly maxEntries = 512,
  ) {}

  get(key: string): string | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: string) {
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.bytes -= previous.length * 2;
      this.entries.delete(key);
    }
    const size = value.length * 2;
    if (size > this.budget) return;
    this.entries.set(key, value);
    this.bytes += size;
    while (this.bytes > this.budget || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.length * 2;
      this.entries.delete(oldest);
    }
  }
}
