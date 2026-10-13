export function animationCursor(side: "start" | "end"): string {
  const marker = side === "start" ? "#ffd45b" : "#f26068";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24" viewBox="0 0 32 24"><path d="M2 12l7-7v4h14V5l7 7-7 7v-4H9v4z" fill="#83dafa" stroke="#101820" stroke-width="2"/><path d="M14 3h4v18h-4z" fill="${marker}" stroke="#101820" stroke-width="1"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 12, ew-resize`;
}
