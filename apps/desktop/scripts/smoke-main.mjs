// Electron entry for the smoke test (see smoke.mjs). Loads the real main
// process, then drives and inspects the window it opens.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

const { OPEN_ARCH_SMOKE_WORKSPACE: workspace, OPEN_ARCH_SMOKE_USERDATA: userData, OPEN_ARCH_SMOKE_OUT: out } = process.env;
app.setPath("userData", userData);
await import("../dist/main.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

app.on("browser-window-created", (_e, win) => {
  const errors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  win.webContents.once("did-finish-load", async () => {
    try {
      const page = (js) => win.webContents.executeJavaScript(js);
      const text = () => page("document.body.innerText");
      await sleep(3000);
      check((await text()).includes("Checkout API components"), "reopens the last workspace and draws a view");
      check(await page("!!window.openArchDesktop && typeof window.require === 'undefined'"), "exposes only the bridge, not Node");
      writeFileSync(join(out, "1-opened.png"), (await win.webContents.capturePage()).toPNG());

      // Save through the bridge, as the designer does.
      const path = "views/landscape.md";
      const before = readFileSync(join(workspace, path), "utf8");
      await page(`window.openArchDesktop.write(${JSON.stringify(workspace)}, [{ path: ${JSON.stringify(path)}, content: ${JSON.stringify(before.replace("title: System landscape", "title: Everything"))} }])`);
      check(readFileSync(join(workspace, path), "utf8").includes("title: Everything"), "writes files through the bridge");
      const outside = await page(`window.openArchDesktop.load("/etc").then(() => "loaded", (e) => e.message)`);
      check(String(outside).includes("wasn't opened"), "refuses folders the user didn't open");

      // An outside edit, like an agent's, shows up without a reload.
      const file = join(workspace, "model/shop/web-app.md");
      writeFileSync(file, readFileSync(file, "utf8").replace("name: Web App", "name: Storefront"));
      await sleep(2500);
      const after = await text();
      check(after.includes("Storefront") && after.includes("changed outside the designer"), "reloads when files change on disk");
      writeFileSync(join(out, "2-reloaded.png"), (await win.webContents.capturePage()).toPNG());

      // The outside edits left previews stale; the designer's fmt button fixes them on disk.
      await page(`[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Update previews"))?.click()`);
      await sleep(1500);
      check((await page(`document.querySelector(".problems .count").textContent`)) === "0", "fixes stale previews with the fmt button");
      check(readFileSync(join(workspace, "views/shop-containers.md"), "utf8").includes("Storefront<br/>"), "writes the regenerated preview to disk");
      const unique = [...new Set(errors)];
      check(errors.length === 0, `no console errors${errors.length ? ` (${errors.length}): ${unique.join(" | ")}` : ""}`);
    } catch (error) {
      check(false, `smoke test crashed: ${error.stack ?? error}`);
    }
    app.exit(failures.length ? 1 : 0);
  });
});
