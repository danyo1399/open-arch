/**
 * The share server's command line (main.ts): a command, and settings from flags or environment
 * variables, the flag winning. Environment variables suit a container; flags suit a terminal.
 */
import { parseArgs } from "node:util";
import { DEFAULT_MAX_BYTES, DEFAULT_UPLOADS_PER_HOUR } from "./handler.js";
import { TRUST_PROXY, type TrustProxy } from "./node.js";

export const COMMANDS = ["serve", "uploads", "block", "unblock", "block-ip", "unblock-ip", "help"] as const;
export type Command = (typeof COMMANDS)[number];

export interface Config {
  port: number;
  /** All interfaces when unset. */
  host: string | undefined;
  /** Where the records and files are kept. Null keeps them in memory, and forgets them when it stops. */
  data: string | null;
  maxBytes: number;
  uploadsPerHour: number;
  trustProxy: TrustProxy;
  /** Whether to print a line for each request. */
  log: boolean;
}

export interface Invocation {
  command: Command;
  /** What the command is about: a workspace ID or an IP address. */
  target?: string;
  config: Config;
  /** For uploads: which ones, and how many. For block and block-ip: why. */
  workspace?: string;
  ip?: string;
  limit: number;
  reason?: string;
}

export class UsageError extends Error {}

/** What the commands and options are, for the program as it was run: `node dist/main.js`, or the executable. */
export const help = (program: string) => `open-arch share server: keeps workspaces shared from the designer, encrypted.

Usage: ${program} [command] [options]

Commands:
  serve                     Answer requests (the default)
  uploads --workspace <id>  List a workspace's uploads, and who sent them
  uploads --ip <address>    List the uploads from an IP address
  block <id> --reason <why>          Take a workspace down: it's no longer served
  unblock <id>                       Serve it again
  block-ip <address> --reason <why>  Refuse uploads from an IP address
  unblock-ip <address>               Accept them again

Options, each also an environment variable:
  --port <n>             PORT              Port to listen on (8787)
  --host <address>       HOST              Address to listen on (all of them)
  --data <folder>        DATA_DIR          Where to keep records and files (./data)
  --memory               DATA_DIR=:memory: Keep them in memory, and forget them when it stops
  --trust-proxy <which>  TRUST_PROXY       Who to believe about a request's address:
                                           none (the connection, the default), forwarded
                                           (X-Forwarded-For, from a reverse proxy) or
                                           cloudflare (CF-Connecting-IP)
  --max-bytes <n>        MAX_BYTES         Largest encrypted workspace (${DEFAULT_MAX_BYTES})
  --uploads-per-hour <n> UPLOADS_PER_HOUR  Uploads one address can make an hour (${DEFAULT_UPLOADS_PER_HOUR})
  --quiet                LOG=off           Don't print a line for each request
  --limit <n>                              How many uploads to list (50)
`;

function whole(value: string, name: string): number {
  if (!/^\d+$/.test(value.trim())) throw new UsageError(`${name} must be a whole number, not "${value}".`);
  return Number(value);
}

/** Reads the command line and the environment. Throws a UsageError saying what's wrong with them. */
export function readInvocation(argv: string[], env: Record<string, string | undefined>): Invocation {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        port: { type: "string" },
        host: { type: "string" },
        data: { type: "string" },
        memory: { type: "boolean" },
        "trust-proxy": { type: "string" },
        "max-bytes": { type: "string" },
        "uploads-per-hour": { type: "string" },
        quiet: { type: "boolean" },
        workspace: { type: "string" },
        ip: { type: "string" },
        limit: { type: "string" },
        reason: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values, positionals } = parsed;
  const [first = "serve", target, ...extra] = positionals;
  if (!(COMMANDS as readonly string[]).includes(first)) throw new UsageError(`There's no command "${first}". Commands: ${COMMANDS.join(", ")}.`);
  if (extra.length) throw new UsageError(`Unexpected: ${extra.join(" ")}`);
  const command = values.help ? "help" : (first as Command);

  const setting = (flag: string | undefined, variable: string) => flag ?? (env[variable] || undefined);
  const trustProxy = (setting(values["trust-proxy"], "TRUST_PROXY") ?? "none") as TrustProxy;
  if (!TRUST_PROXY.includes(trustProxy)) throw new UsageError(`The trusted proxy must be ${TRUST_PROXY.join(", ")}, not "${trustProxy}".`);
  const data = values.memory ? null : (setting(values.data, "DATA_DIR") ?? "./data");

  const invocation: Invocation = {
    command,
    target,
    config: {
      port: whole(setting(values.port, "PORT") ?? "8787", "The port"),
      host: setting(values.host, "HOST"),
      data: data === ":memory:" ? null : data,
      maxBytes: whole(setting(values["max-bytes"], "MAX_BYTES") ?? String(DEFAULT_MAX_BYTES), "The largest workspace"),
      uploadsPerHour: whole(setting(values["uploads-per-hour"], "UPLOADS_PER_HOUR") ?? String(DEFAULT_UPLOADS_PER_HOUR), "The uploads an hour"),
      trustProxy,
      log: !values.quiet && env.LOG !== "off",
    },
    workspace: values.workspace,
    ip: values.ip,
    limit: whole(values.limit ?? "50", "The limit"),
    reason: values.reason,
  };

  if (command === "help") return invocation;
  if (command !== "serve" && invocation.config.data === null) throw new UsageError(`${command} needs the data folder the server keeps its records in: --data or DATA_DIR.`);
  if (command === "uploads" && !invocation.workspace === !invocation.ip) throw new UsageError("Say whose uploads to list: --workspace <id> or --ip <address>.");
  if (["block", "unblock", "block-ip", "unblock-ip"].includes(command) && !target) throw new UsageError(`Say what to ${command.replace("-ip", "")}: ${command} <${command.endsWith("-ip") ? "address" : "workspace id"}>.`);
  if ((command === "block" || command === "block-ip") && !invocation.reason) throw new UsageError(`Say why, with --reason, so whoever reads the records later knows.`);
  return invocation;
}
