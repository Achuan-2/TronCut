export const waveformSampleRate = 48000;
export const waveformMaxPeaks = 32_000_000;

/** Stream PCM into compact peaks instead of buffering the decoded audio. */
export class WaveformPeakBuilder {
  readonly bucketSize: number;
  private readonly chunks: Uint8Array[] = [];
  private chunk = new Uint8Array(65536);
  private length = 0;
  private samples = 0;
  private peak = 0;
  private remainder = Buffer.alloc(0);

  constructor(duration: number) {
    this.bucketSize = Math.max(
      6,
      Math.ceil(((duration + 1) * waveformSampleRate) / waveformMaxPeaks),
    );
  }

  private flush() {
    if (this.length >= waveformMaxPeaks)
      throw new Error("音频波形数据超出限制");
    const offset = this.length % this.chunk.length;
    this.chunk[offset] = Math.round(Math.sqrt(Math.min(1, this.peak)) * 255);
    this.length++;
    if (this.length % this.chunk.length === 0) {
      this.chunks.push(this.chunk);
      this.chunk = new Uint8Array(65536);
    }
    this.peak = 0;
    this.samples = 0;
  }

  append(chunk: Buffer) {
    const data = this.remainder.length
      ? Buffer.concat([this.remainder, chunk])
      : chunk;
    const end = data.length - (data.length % 4);
    for (let i = 0; i < end; i += 4) {
      const sample = data.readFloatLE(i);
      if (Number.isFinite(sample))
        this.peak = Math.max(this.peak, Math.abs(sample));
      if (++this.samples === this.bucketSize) this.flush();
    }
    this.remainder = Buffer.from(data.subarray(end));
  }

  finish() {
    if (this.samples) this.flush();
    const peaks = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      peaks.set(chunk, offset);
      offset += chunk.length;
    }
    peaks.set(this.chunk.subarray(0, this.length - offset), offset);
    return { peaksPerSecond: waveformSampleRate / this.bucketSize, peaks };
  }
}
