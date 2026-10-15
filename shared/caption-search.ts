import type { Project } from "./model";
import { captionClips } from "./captions";

export interface CaptionSearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  preserveCase: boolean;
  clipIds?: readonly string[];
}
export interface CaptionMatch {
  clipId: string;
  start: number;
  end: number;
  text: string;
  captures: (string | undefined)[];
  groups?: Record<string, string>;
}
export const defaultCaptionSearchOptions: CaptionSearchOptions = {
  matchCase: false,
  wholeWord: false,
  regex: false,
  preserveCase: false,
};

export function findCaptionMatches(
  project: Project,
  query: string,
  options: CaptionSearchOptions,
): { matches: CaptionMatch[]; error?: string } {
  if (!query) return { matches: [] };
  let expression: RegExp;
  try {
    expression = new RegExp(
      options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      options.matchCase ? "gu" : "giu",
    );
  } catch {
    return { matches: [], error: "正则表达式无效" };
  }
  const locked = new Set(
    project.tracks.filter((track) => track.locked).map((track) => track.id),
  );
  const scope = options.clipIds && new Set(options.clipIds);
  const matches: CaptionMatch[] = [];
  for (const clip of captionClips(project)) {
    if (locked.has(clip.trackId) || (scope && !scope.has(clip.id))) continue;
    const text = clip.text ?? "";
    for (const match of text.matchAll(expression)) {
      const start = match.index!,
        end = start + match[0].length;
      if (
        options.wholeWord &&
        (/[\p{L}\p{N}_]$/u.test(text.slice(0, start)) ||
          /^[\p{L}\p{N}_]/u.test(text.slice(end)))
      )
        continue;
      matches.push({
        clipId: clip.id,
        start,
        end,
        text: match[0],
        captures: match.slice(1),
        groups: match.groups,
      });
    }
  }
  return { matches };
}

function replacementText(
  source: string,
  match: CaptionMatch,
  replacement: string,
  options: CaptionSearchOptions,
) {
  // Literal searches keep dollar signs literal; regex replacements support JS captures.
  let text = options.regex
    ? replacement.replace(
        /\$(\$|&|`|'|[1-9]\d?|<[^>]+>)/g,
        (token, key: string) => {
          if (key === "$") return "$";
          if (key === "&") return match.text;
          if (key === "`") return source.slice(0, match.start);
          if (key === "'") return source.slice(match.end);
          if (key.startsWith("<"))
            return match.groups
              ? (match.groups[key.slice(1, -1)] ?? "")
              : token;
          const index = Number(key);
          if (index <= match.captures.length)
            return match.captures[index - 1] ?? "";
          if (key.length === 2 && Number(key[0]) <= match.captures.length)
            return (match.captures[Number(key[0]) - 1] ?? "") + key[1];
          return token;
        },
      )
    : replacement;
  if (options.preserveCase && /\p{L}/u.test(match.text)) {
    if (match.text === match.text.toLocaleUpperCase())
      text = text.toLocaleUpperCase();
    else if (match.text === match.text.toLocaleLowerCase())
      text = text.toLocaleLowerCase();
    else if (
      match.text ===
      match.text[0].toLocaleUpperCase() +
        match.text.slice(1).toLocaleLowerCase()
    )
      text = text
        ? text[0].toLocaleUpperCase() + text.slice(1).toLocaleLowerCase()
        : "";
  }
  return text;
}

/** Search again against the current project so stale offsets never change another word. */
export function replaceCaptionMatches(
  project: Project,
  query: string,
  replacement: string,
  options: CaptionSearchOptions,
  target?: Pick<CaptionMatch, "clipId" | "start" | "end">,
): { project: Project; changed: number; occurrences: number } {
  const { matches } = findCaptionMatches(project, query, options);
  const byClip = new Map<string, CaptionMatch[]>();
  for (const match of matches) {
    if (
      target &&
      (match.clipId !== target.clipId ||
        match.start !== target.start ||
        match.end !== target.end)
    )
      continue;
    const group = byClip.get(match.clipId) ?? [];
    group.push(match);
    byClip.set(match.clipId, group);
  }
  let changed = 0,
    occurrences = 0;
  const clips = project.clips.map((clip) => {
    const group = byClip.get(clip.id);
    if (!group) return clip;
    const source = clip.text ?? "";
    let text = "",
      offset = 0;
    for (const match of group) {
      text +=
        source.slice(offset, match.start) +
        replacementText(source, match, replacement, options);
      offset = match.end;
    }
    text += source.slice(offset);
    if (text === source) return clip;
    changed++;
    occurrences += group.length;
    return { ...clip, text, name: text.slice(0, 24) || "空白字幕" };
  });
  return {
    project: changed ? { ...project, clips } : project,
    changed,
    occurrences,
  };
}
