// Runs the executable that scripts/executable.mjs built for this machine, as someone would on a
// server: it serves from a data folder, takes an upload, keeps it through a restart, takes it
// down with a command, and stops cleanly on SIGTERM.
//
//   node scripts/smoke-executable.mjs [executable]
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("..", import.meta.url));
const platform = { linux: "linux", darwin: "macos" }[process.platform];
if (!process.argv[2] && (!platform || !["x64", "arm64"].includes(process.arch))) {
  console.log("The executables are for Linux and macOS on x64 and arm64, so none is run on this machine.");
  process.exit(0);
}
const executable = process.argv[2] ?? join(server, "release", `open-arch-share-${platform}-${process.arch}`);
const data = mkdtempSync(join(tmpdir(), "open-arch-share-smoke-"));
let failed = false;

function check(ok, what) {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failed = true;
}

/** Starts it on a free port. Resolves once it says where it's listening. */
function start(args) {
  const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LOG: "off" } });
  let output = "";
  return new Promise((resolve, reject) => {
    child.stderr.on("data", (chunk) => (output += chunk));
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const url = output.match(/Share server on (http:\/\/\S+?),/)?.[1];
      if (url) resolve({ child, url, output: () => output });
    });
    child.on("exit", (code) => reject(new Error(`It stopped (${code}) before it served: ${output}`)));
  });
}

const stop = (child) =>
  new Promise((resolve) => {
    child.removeAllListeners("exit");
    child.on("exit", (code, signal) => resolve({ code, signal }));
    child.kill("SIGTERM");
  });

const file = new Uint8Array(48).fill(7);
file[0] = 1;

try {
  const helpText = execFileSync(executable, ["help"], { encoding: "utf8" });
  check(helpText.includes("Usage: open-arch-share-"), "help names the executable");

  let running = await start(["--data", data, "--port", "0"]);
  check(execFileSync(executable, ["version"], { encoding: "utf8" }).startsWith("open-arch-share "), "says its version");
  const created = await fetch(`${running.url}/v1/workspaces`, { method: "POST", body: file });
  check(created.status === 201, "takes an upload");
  const { id, hash } = await created.json();
  const exit = await stop(running.child);
  check(exit.code === 0, "stops cleanly on SIGTERM");

  running = await start(["--data", data, "--port", "0"]);
  const got = await fetch(`${running.url}/v1/workspaces/${id}/${hash}`);
  check(got.status === 200 && Buffer.from(await got.arrayBuffer()).equals(Buffer.from(file)), "keeps it through a restart");

  const blocked = execFileSync(executable, ["block", id, "--reason", "smoke test", "--data", data], { encoding: "utf8" });
  check(blocked.includes("Took") && (await fetch(`${running.url}/v1/workspaces/${id}/${hash}`)).status === 410, "takes it down with a command while it runs");
  const uploads = execFileSync(executable, ["uploads", "--workspace", id, "--data", data], { encoding: "utf8" });
  check(uploads.includes("create"), "lists who uploaded it");
  await stop(running.child);

  running = await start(["--memory", "--port", "0"]);
  check((await fetch(`${running.url}/`)).ok, "serves from memory too");
  await stop(running.child);
} catch (error) {
  console.error(error);
  failed = true;
} finally {
  rmSync(data, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
