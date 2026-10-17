import { createRequire } from "node:module";

export interface Io {
  cwd: string;
  out(text: string): void;
  err(text: string): void;
}

export { CliError } from "./errors.js";

export const VERSION: string = (createRequire(import.meta.url)("../package.json") as { version: string }).version;
