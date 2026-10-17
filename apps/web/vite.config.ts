import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the build works from any folder: a static host, GitHub Pages, or Electron's file://.
  base: "./",
  plugins: [react()],
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
