// Runs Electron against the web app's Vite dev server, so UI changes reload live.
// Start the dev server first: pnpm --filter @open-arch/web dev
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";

const child = spawn(electron, [fileURLToPath(new URL("..", import.meta.url))], {
  stdio: "inherit",
  env: { ...process.env, OPEN_ARCH_DEV_URL: process.env.OPEN_ARCH_DEV_URL ?? "http://localhost:5173" },
});
child.on("exit", (code) => process.exit(code ?? 0));
