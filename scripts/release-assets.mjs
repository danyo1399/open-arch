// Gets a release's files ready (.github/workflows/release.yml): checks the folder has every
// desktop installer and share server executable CI built, then writes SHA256SUMS, to check a
// download against, and the release's notes, which name the share server's Docker image too.
//
//   node scripts/release-assets.mjs <folder> <version> [repository]
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMain } from "./lib.mjs";

/** What each file is for, by its name, in the order the notes list them. */
export const ASSETS = [
  { kind: "desktop", for: "macOS on Apple Silicon: drag it to Applications", match: (name) => name.endsWith(".dmg") },
  { kind: "desktop", for: "macOS on Apple Silicon, as a zip", match: (name) => name.endsWith("-mac.zip") },
  { kind: "desktop", for: "Windows: the installer", match: (name) => name.endsWith(".exe") },
  { kind: "desktop", for: "Linux: runs as it is", match: (name) => name.endsWith(".AppImage") },
  { kind: "desktop", for: "Debian and Ubuntu", match: (name) => name.endsWith(".deb") },
  ...[
    ["linux-x64", "Linux on x64"],
    ["linux-arm64", "Linux on arm64"],
    ["macos-arm64", "macOS on Apple Silicon"],
    ["macos-x64", "macOS on Intel"],
  ].map(([platform, label]) => ({ kind: "server", for: label, match: (name) => name === `open-arch-share-${platform}.tar.gz` })),
];

/**
 * The files for each asset, or an error naming what's missing or doubled. A desktop installer's
 * name has its version, so one built as another version is refused too.
 */
export function matchAssets(names, version) {
  const problems = [];
  const found = ASSETS.map((asset) => {
    const matches = names.filter((name) => asset.match(name));
    if (matches.length !== 1) problems.push(`${matches.length ? `More than one` : "No"} file for ${asset.kind === "server" ? "the share server on" : "the desktop app on"} ${asset.for}${matches.length ? `: ${matches.join(", ")}` : ""}.`);
    else if (asset.kind === "desktop" && !matches[0].includes(version)) problems.push(`${matches[0]} isn't version ${version}.`);
    return { ...asset, name: matches[0] };
  });
  if (problems.length) throw new Error(problems.join("\n"));
  return found;
}

export function sha256sums(folder, names) {
  return names.map((name) => `${createHash("sha256").update(readFileSync(join(folder, name))).digest("hex")}  ${name}\n`).join("");
}

/** The share server's image on GitHub's container registry, as the release workflow publishes it. */
export const imageName = (repository) => `ghcr.io/${repository.split("/")[0].toLowerCase()}/open-arch-share`;

/** The release's notes: what each file is for, and how to check and run them. */
export function releaseNotes(assets, version, repository) {
  const table = (kind) => ["| File | For |", "|---|---|", ...assets.filter((a) => a.kind === kind).map((a) => `| \`${a.name}\` | ${a.for} |`)].join("\n");
  const readme = `https://github.com/${repository}#`;
  return `open-arch ${version}.

### The desktop app

${table("desktop")}

The installers aren't signed, so the first time the app opens, macOS and Windows ask whether to trust it. On a Mac, if it says the app is damaged or can't be checked, open it with Control-click, **Open**.

### The share server

${table("server")}

Each is one executable, with nothing else to install. [Running the share server](${readme}the-share-server) says how to run it, as a service too. Download it with \`curl\`, so macOS doesn't mark it as from the internet:

\`\`\`bash
curl -fsSLO https://github.com/${repository}/releases/download/v${version}/open-arch-share-linux-x64.tar.gz
tar -xzf open-arch-share-linux-x64.tar.gz
\`\`\`

Or run it in Docker, for x64 or arm64, with a volume that keeps what's shared:

\`\`\`bash
docker run -d -p 8787:8787 -v open-arch-share:/data ${imageName(repository)}:${version}
\`\`\`

### Checking a download

\`SHA256SUMS\` has each file's SHA-256. In the folder you downloaded to:

\`\`\`bash
sha256sum --check --ignore-missing SHA256SUMS          # Linux
shasum -a 256 --check --ignore-missing SHA256SUMS      # macOS
\`\`\`
`;
}

if (isMain(import.meta.url)) {
  const [folder, version, repository = process.env.GITHUB_REPOSITORY ?? "danyo1399/open-arch"] = process.argv.slice(2);
  if (!folder || !version) {
    console.error("Usage: node scripts/release-assets.mjs <folder> <version> [repository]");
    process.exit(1);
  }
  const names = readdirSync(folder).filter((name) => name !== "SHA256SUMS" && name !== "notes.md");
  let assets;
  try {
    assets = matchAssets(names, version);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const unexpected = names.filter((name) => !assets.some((a) => a.name === name));
  if (unexpected.length) console.error(`Not released, as nothing says what they're for: ${unexpected.join(", ")}`);
  writeFileSync(join(folder, "SHA256SUMS"), sha256sums(folder, assets.map((a) => a.name)));
  writeFileSync(join(folder, "notes.md"), releaseNotes(assets, version, repository));
  // The files to release, one a line, for the workflow.
  for (const asset of assets) console.log(join(folder, asset.name));
  console.log(join(folder, "SHA256SUMS"));
}
