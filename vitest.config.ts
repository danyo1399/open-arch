import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Run the CLI tests against core's sources, so `pnpm test` needs no build.
      "@open-arch/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
      // As the desktop app's build and tsconfig resolve it.
      "open-arch/workspace": fileURLToPath(new URL("./packages/cli/src/workspace.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts", "scripts/test/**/*.test.ts"],
  },
});
