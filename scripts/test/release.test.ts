import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { imageName, matchAssets, releaseNotes } from "../release-assets.mjs";

const script = new URL("../release-assets.mjs", import.meta.url).pathname;

/** The files CI builds for a release of this version. */
const built = (version: string) => [
  `open-arch-${version}-arm64.dmg`,
  `open-arch-${version}-arm64-mac.zip`,
  `open-arch-${version}-setup.exe`,
  `open-arch-${version}.AppImage`,
  `open-arch_${version}_amd64.deb`,
  "open-arch-share-linux-x64.tar.gz",
  "open-arch-share-linux-arm64.tar.gz",
  "open-arch-share-macos-arm64.tar.gz",
  "open-arch-share-macos-x64.tar.gz",
];

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function folderWith(names: string[]): string {
  const folder = mkdtempSync(join(tmpdir(), "open-arch-release-"));
  folders.push(folder);
  for (const name of names) writeFileSync(join(folder, name), `contents of ${name}`);
  return folder;
}

describe("release assets", () => {
  it("finds every installer and executable", () => {
    const assets = matchAssets(built("1.2.0"), "1.2.0");
    expect(assets.map((a: { name: string }) => a.name)).toEqual(built("1.2.0"));
  });

  it("says what's missing, doubled, or another version", () => {
    const names = built("1.2.0").filter((n) => !n.endsWith(".deb") && n !== "open-arch-share-macos-x64.tar.gz");
    expect(() => matchAssets(names, "1.2.0")).toThrow(/No file for the desktop app on Debian and Ubuntu\.\nNo file for the share server on macOS on Intel\./);
    expect(() => matchAssets([...built("1.2.0"), "open-arch-1.1.0-x64.dmg"], "1.2.0")).toThrow("More than one file for the desktop app on macOS on Apple Silicon: drag it to Applications: open-arch-1.2.0-arm64.dmg, open-arch-1.1.0-x64.dmg.");
    expect(() => matchAssets(built("1.1.0"), "1.2.0")).toThrow("open-arch-1.1.0-arm64.dmg isn't version 1.2.0.");
  });

  it("writes checksums and notes, and lists the files to release", () => {
    const folder = folderWith([...built("1.2.0"), "builder-debug.yml"]);
    const output = execFileSync("node", [script, folder, "1.2.0", "someone/open-arch"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(output.trim().split("\n")).toEqual([...built("1.2.0"), "SHA256SUMS"].map((n) => join(folder, n)));
    const sums = readFileSync(join(folder, "SHA256SUMS"), "utf8").trim().split("\n");
    expect(sums).toHaveLength(9);
    // In the format sha256sum --check reads.
    expect(execFileSync("sha256sum", ["--check", "SHA256SUMS"], { cwd: folder, encoding: "utf8" })).toContain("open-arch-share-linux-x64.tar.gz: OK");
    const notes = readFileSync(join(folder, "notes.md"), "utf8");
    expect(notes).toContain("| `open-arch-1.2.0-setup.exe` | Windows: the installer |");
    expect(notes).toContain("https://github.com/someone/open-arch/releases/download/v1.2.0/open-arch-share-linux-x64.tar.gz");
  });

  it("refuses to release a folder that's missing a file", () => {
    const folder = folderWith(built("1.2.0").slice(1));
    expect(() => execFileSync("node", [script, folder, "1.2.0"], { stdio: "pipe" })).toThrow(/No file for the desktop app on macOS on Apple Silicon: drag it to Applications\./);
  });

  it("names the release's files in its notes", () => {
    const notes = releaseNotes(matchAssets(built("2.0.0-rc.1"), "2.0.0-rc.1"), "2.0.0-rc.1", "Someone/open-arch");
    expect(notes.startsWith("open-arch 2.0.0-rc.1.")).toBe(true);
    expect(notes).toContain("| `open-arch-share-macos-x64.tar.gz` | macOS on Intel |");
    // The image, in the registry's lower case, at this version.
    expect(notes).toContain("docker run -d -p 8787:8787 -v open-arch-share:/data ghcr.io/someone/open-arch-share:2.0.0-rc.1");
    expect(imageName("danyo1399/open-arch")).toBe("ghcr.io/danyo1399/open-arch-share");
  });
});
