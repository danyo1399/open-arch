import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { userDataFolder } from "../src/user-data.js";

const appData = join("/home", "dana", ".config");
const appDir = join("/work", "wt", "fix", "apps", "desktop");

describe("userDataFolder", () => {
  it("gives a copy run from a checkout its own folder there", () => {
    expect(userDataFolder({ packaged: false, current: join(appData, "open-arch"), appData, name: "open-arch", appDir })).toBe(join(appDir, "user-data"));
  });

  it("gives copies in different checkouts different folders", () => {
    const other = join("/work", "wt", "feature", "apps", "desktop");
    const folder = (dir: string) => userDataFolder({ packaged: false, current: join(appData, "open-arch"), appData, name: "open-arch", appDir: dir });
    expect(folder(appDir)).not.toBe(folder(other));
  });

  it("does the same when Electron runs a file with no package.json, under its own name", () => {
    expect(userDataFolder({ packaged: false, current: join(appData, "Electron"), appData, name: "Electron", appDir })).toBe(join(appDir, "user-data"));
  });

  it("keeps the installed app's folder", () => {
    const current = join(appData, "open-arch");
    expect(userDataFolder({ packaged: true, current, appData, name: "open-arch", appDir })).toBe(current);
  });

  it("keeps a folder someone already chose, as the smoke test does", () => {
    const current = join("/tmp", "open-arch-smoke-1", "user");
    expect(userDataFolder({ packaged: false, current, appData, name: "Electron", appDir })).toBe(current);
  });
});
