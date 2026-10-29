// Bundles the main process, preload script and CLI with esbuild, and copies in
// the web UI build. The packaged app then needs nothing from node_modules.
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const alias = {
  "@open-arch/core": at("../../../packages/core/src/index.ts"),
  "open-arch/workspace": at("../../../packages/cli/src/workspace.ts"),
};

await build({
  entryPoints: [at("../src/main.ts")],
  outfile: at("../dist/main.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron"],
  alias,
  // Some dependencies call require(); give the ES module bundle one.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});

// The CLI the AI agent runs, as a folder that works on its own: the bundle
// reads its version from ../package.json and the skill from ./open-arch/.
const cli = at("../dist/cli");
rmSync(cli, { recursive: true, force: true });
await build({
  entryPoints: [at("../../../packages/cli/src/bin.ts")],
  outfile: at("../dist/cli/bin/open-arch.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  alias,
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
const { version } = JSON.parse(readFileSync(at("../../../packages/cli/package.json"), "utf8"));
writeFileSync(at("../dist/cli/package.json"), JSON.stringify({ name: "open-arch", version, type: "module" }) + "\n");
cpSync(at("../../../packages/skill/open-arch"), at("../dist/cli/bin/open-arch"), { recursive: true });

await build({
  entryPoints: [at("../src/preload.ts")],
  outfile: at("../dist/preload.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  alias,
});

if (!process.argv.includes("--no-renderer")) {
  const web = at("../../web/dist");
  if (!existsSync(web)) throw new Error("Build the web app first: pnpm --filter @open-arch/web build");
  rmSync(at("../dist/renderer"), { recursive: true, force: true });
  cpSync(web, at("../dist/renderer"), { recursive: true });
}
console.log("built apps/desktop/dist");
