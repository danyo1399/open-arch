/**
 * Where the app keeps what it remembers between runs, such as the file it
 * last opened, along with Electron's own storage: Electron's userData folder.
 */
import { join } from "node:path";

export interface UserDataOptions {
  /** Whether this is an installed app, rather than a copy run from a checkout. */
  packaged: boolean;
  /** The userData folder Electron has now. */
  current: string;
  /** Electron's appData folder. Its own userData folder is this, then the app's name. */
  appData: string;
  /** The app's name: package.json's productName, or "Electron" when it runs a file with no package.json. */
  name: string;
  /** The app's folder in the checkout, apps/desktop. */
  appDir: string;
}

/**
 * The userData folder this copy of the app should use. An installed app keeps
 * Electron's, which is named after the app. Every copy run from a checkout
 * (`pnpm dev`, `pnpm start`, or Electron on apps/desktop) would get that same
 * folder, so one would reopen, and save over, the file a copy in another
 * checkout or the installed app last opened. Instead, each keeps its own, in
 * apps/desktop/user-data/, unless whoever started it already chose a folder,
 * as the smoke test and `--user-data-dir` do.
 */
export function userDataFolder({ packaged, current, appData, name, appDir }: UserDataOptions): string {
  if (packaged || current !== join(appData, name)) return current;
  return join(appDir, "user-data");
}
