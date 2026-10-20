// FFmpeg 9 frame-threaded PNG inputs can stall multi-overlay graphs. Static
// images need a finite input and single-thread decoding, including cursor/rings.
export function loopImageInput(
  file: string,
  fps: number,
  duration: number,
  still = false,
): string[] {
  return [
    // A capture consumes just the first image. Looping makes FFmpeg probe and
    // decode repeated PNG packets before it can start the composition.
    ...(still ? [] : ["-loop", "1"]),
    "-framerate",
    String(fps),
    ...(still ? [] : ["-t", String(duration)]),
    "-threads",
    "1",
    "-i",
    file,
  ];
}
