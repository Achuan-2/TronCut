import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runProcess } from "./process";
import type { TtsOptions, WindowsSpeechVoice } from "../shared/tts";

const voiceSchema = z.object({
  id: z.string().min(1).max(1024),
  name: z.string().min(1).max(500),
  language: z.string().max(50),
  gender: z.string().max(30),
});

function command(workers: string) {
  if (process.platform !== "win32")
    throw new Error("Windows 系统语音仅支持 Windows");
  const shell = path.join(
    process.env.WINDIR ?? "C:\\Windows",
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  return {
    shell,
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.resolve(workers, "../windows-speech/synthesize.ps1"),
    ],
  };
}

export async function windowsSpeechVoices(
  workers: string,
  signal?: AbortSignal,
): Promise<WindowsSpeechVoice[]> {
  const { shell, args } = command(workers);
  const result = await runProcess(shell, [...args, "-Action", "voices"], {
    signal,
    timeout: 15000,
  });
  return z
    .array(voiceSchema)
    .parse(JSON.parse(result.trim().replace(/^\uFEFF/, "")));
}

/** Pass plain text through a JSON file, never a PowerShell command expression. */
export async function synthesizeWindowsSpeech(
  options: TtsOptions,
  workers: string,
  request: string,
  output: string,
  signal: AbortSignal,
  progress: (percent: number, label: string) => void,
) {
  const { shell, args } = command(workers);
  await fs.writeFile(request, JSON.stringify(options), "utf8");
  await runProcess(
    shell,
    [...args, "-Action", "synthesize", "-Request", request, "-Output", output],
    {
      signal,
      onLine(line) {
        if (!line.startsWith("TRONCUT_PROGRESS ")) return;
        try {
          const event = z
            .object({ percent: z.number().min(0).max(100), label: z.string() })
            .parse(JSON.parse(line.slice(17)));
          progress(event.percent, event.label);
        } catch {
          /* Ignore unrelated native-provider output. */
        }
      },
    },
  );
}
