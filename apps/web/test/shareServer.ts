/**
 * The share server (apps/server, in Go), built and started for a test file, keeping everything in
 * memory. Tests that use it run the designer's client against the real server, over HTTP.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface RunningServer {
  url: string;
  stop(): Promise<void>;
}

// From the file's path, not a URL: the page's URL class isn't Node's in a test with a page (happy-dom).
const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "server");

/** How long building it can take the first time, before Go has cached its SQLite. */
export const BUILD_TIMEOUT = 300_000;

export async function startShareServer(): Promise<RunningServer> {
  const dir = mkdtempSync(join(tmpdir(), "open-arch-share-test-"));
  const binary = join(dir, "open-arch-share");
  try {
    execFileSync("go", ["build", "-o", binary, "."], { cwd: SERVER, stdio: "pipe" });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("These tests run the designer's sharing against the share server, which is written in Go. Install Go 1.26 or later.");
    throw new Error(`Couldn't build the share server: ${(error as { stderr?: Buffer }).stderr?.toString() ?? error}`);
  }
  // Tests upload far more than an address may in an hour.
  const child = spawn(binary, ["serve", "--memory", "--host", "127.0.0.1", "--port", "0", "--quiet", "--uploads-per-hour", "1000000"], { stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string>((resolve, reject) => {
    let output = "";
    const read = (chunk: Buffer) => {
      output += chunk;
      const found = output.match(/Share server on (http:\/\/\S+?),/)?.[1];
      if (found) resolve(found);
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => reject(new Error(`The share server stopped (${code}): ${output}`)));
  });
  return {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        child.removeAllListeners("exit");
        child.on("exit", () => {
          rmSync(dir, { recursive: true, force: true });
          resolve();
        });
        child.kill("SIGTERM");
      }),
  };
}
