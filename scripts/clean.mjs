// Removes what `pnpm build` writes: each package's dist/ and *.tsbuildinfo, and the share server's.
// A script rather than `rm -rf` so `pnpm clean` also works on Windows.
import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const built = [
  ...readdirSync("packages", { withFileTypes: true })
    .filter((pkg) => pkg.isDirectory())
    .map((pkg) => join("packages", pkg.name)),
  join("apps", "server"),
];

for (const dir of built) {
  rmSync(join(dir, "dist"), { recursive: true, force: true });
  for (const file of readdirSync(dir)) if (file.endsWith(".tsbuildinfo")) rmSync(join(dir, file));
}
