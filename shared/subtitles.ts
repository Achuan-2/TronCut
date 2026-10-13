export interface Cue {
  start: number;
  end: number;
  text: string;
}
function seconds(s: string): number {
  const p = s.replace(",", ".").split(":").map(Number);
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}
export function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .trim()
    .split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const index = lines.findIndex((l) => l.includes("-->"));
    if (index < 0) continue;
    const match = lines[index].match(
      /(\d{1,2}:\d{2}(?::\d{2})?[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[,.]\d{3})/,
    );
    if (!match) continue;
    const start = seconds(match[1]),
      end = seconds(match[2]),
      content = lines.slice(index + 1).join("\n");
    if (Number.isFinite(start) && end > start && content.trim())
      cues.push({ start, end, text: content });
  }
  return cues;
}
function stamp(t: number): string {
  const ms = Math.round(Math.max(0, t) * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
}
export function toSrt(cues: Cue[]): string {
  return [...cues]
    .sort((a, b) => a.start - b.start)
    .map(
      (c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`,
    )
    .join("\n");
}
