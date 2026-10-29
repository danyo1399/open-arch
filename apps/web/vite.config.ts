import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

export default defineConfig({
  // Relative asset paths, so the build works from any folder: a static host, GitHub Pages, or Electron's file://.
  base: "./",
  plugins: [react(), serviceWorker()],
  resolve: {
    alias: {
      "@open-arch/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: ["../.."] },
  },
});

/** Writes dist/sw.js: sw.js, told which files the build has and a version that changes when any of them does. */
function serviceWorker(): Plugin {
  return {
    name: "open-arch:service-worker",
    apply: "build",
    writeBundle({ dir }) {
      const outDir = dir!;
      const paths = readdirSync(outDir, { recursive: true, encoding: "utf8" })
        .filter((path) => path !== "sw.js" && statSync(join(outDir, path)).isFile())
        .map((path) => path.replaceAll("\\", "/"))
        .sort();
      const hash = createHash("sha256");
      for (const path of paths) hash.update(path).update(readFileSync(join(outDir, path)));
      // The app is cached under its folder's URL, which is what opening it requests.
      const files = paths.map((path) => (path === "index.html" ? "./" : path));
      const source = readFileSync(fileURLToPath(new URL("sw.js", import.meta.url)), "utf8");
      const constants = `const VERSION = "${hash.digest("hex").slice(0, 12)}";\nconst FILES = ${JSON.stringify(files)};\n`;
      writeFileSync(join(outDir, "sw.js"), constants + source);
    },
  };
}
