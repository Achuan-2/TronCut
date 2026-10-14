// FFmpeg 9 frame-threaded PNG inputs can stall multi-overlay graphs. Static
// images need a finite input and single-thread decoding, including cursor/rings.
export function loopImageInput(
  file: string,
  fps: number,
  duration: number,
): string[] {
  return [
    "-loop",
    "1",
    "-framerate",
    String(fps),
    "-t",
    String(duration),
    "-threads",
    "1",
    "-i",
    file,
  ];
}
