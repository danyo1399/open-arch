// Removes what `pnpm build` writes: each package's dist/ and *.tsbuildinfo.
// A script rather than `rm -rf` so `pnpm clean` also works on Windows.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

for (const pkg of readdirSync("packages", { withFileTypes: true })) {
  if (!pkg.isDirectory()) continue;
  const dir = join("packages", pkg.name);
  rmSync(join(dir, "dist"), { recursive: true, force: true });
  for (const file of readdirSync(dir)) if (file.endsWith(".tsbuildinfo")) rmSync(join(dir, file));
}
