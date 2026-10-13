// The workflow copies these two diagnostics files into the source's .cache/.
import { mergeConfig } from "vitest/config";
import base from "../vitest.config.ts";

export default mergeConfig(base, {
  test: { setupFiles: [".cache/ci-process-trace.mjs"], reporters: ["verbose"] },
});
