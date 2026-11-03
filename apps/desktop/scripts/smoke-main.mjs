// Electron entry for the smoke test (see smoke.mjs). Loads the real main
// process, then drives and inspects the window it opens.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, ipcMain } from "electron";

const { OPEN_ARCH_SMOKE_FOLDER: folder, OPEN_ARCH_SMOKE_USERDATA: userData, OPEN_ARCH_SMOKE_OUT: out, OPEN_ARCH_SMOKE_CLI: cli } = process.env;
const file = join(folder, "shop.openarch");
app.setPath("userData", userData);
await import("../dist/main.js");

// A scripted agent in place of OpenCode: it asks to run a command, and once
// approved changes the file with the bundled CLI, as a real agent would.
const runCli = (...args) => execFileSync(process.execPath, [cli, ...args, "--file", file], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
const agentRequests = [];
let answer;
for (const channel of ["agentRun", "agentReply", "agentCancel"]) ipcMain.removeHandler(channel);
ipcMain.handle(
  "agentRun",
  (event, run, path, prompt, context) =>
    new Promise((resolve) => {
      const emit = (e) => event.sender.send("agent-event", run, e);
      agentRequests.push({ path, prompt, context });
      emit({ type: "progress", text: "$ open-arch show" });
      emit({ type: "permission", id: "per_1", description: "Run `ls`" });
      answer = (allow) => {
        if (allow) runCli("add-element", "cart-cache", "--kind", "container", "--parent", "shop", "--name", "Cart Cache");
        emit({ type: "permission-replied", id: "per_1" });
        emit({ type: "done", summary: "Added the Cart Cache container." });
        resolve();
      };
    }),
);
ipcMain.handle("agentReply", (_event, _id, allow) => answer?.(allow));
ipcMain.handle("agentCancel", () => answer?.(false));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const doc = () => JSON.parse(readFileSync(file, "utf8"));
const docsPage = (path) => readFileSync(join(folder, "docs", path), "utf8");

/**
 * Saves a screenshot of the window. Now and then capturing fails with UnknownVizError, which used to
 * crash the whole smoke test, and works a moment later, so it tries a few times.
 */
async function screenshot(win, name) {
  for (let attempt = 1; ; attempt++) {
    try {
      return writeFileSync(join(out, name), (await win.webContents.capturePage()).toPNG());
    } catch (error) {
      if (attempt === 5) throw error;
      await sleep(1000);
    }
  }
}

app.on("browser-window-created", (_e, win) => {
  const errors = [];
  win.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(`${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  win.webContents.once("did-finish-load", async () => {
    try {
      const page = (js) => win.webContents.executeJavaScript(js);
      const text = () => page("document.body.innerText");
      await sleep(3000);
      check(app.getPath("userData") === userData, "keeps its state in the smoke test's folder");
      check((await text()).includes("Checkout API components"), "reopens the last file and draws a view");
      check(await page("!!window.openArchDesktop && typeof window.require === 'undefined'"), "exposes only the bridge, not Node");
      await screenshot(win, "1-opened.png");

      // An edit in the designer: rename the workspace in its settings panel.
      await page(`(async () => {
        document.querySelector("button.ws-name").click();
        await new Promise((r) => setTimeout(r, 300));
        const input = [...document.querySelectorAll(".properties input")].find((i) => i.getAttribute("aria-label") === "Name");
        input.value = "Shop (renamed)";
        // The window may not have focus in a test run, so press Enter rather than relying on blur.
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      })()`);
      await sleep(1000);
      check(doc().name === "Shop (renamed)", "saves designer edits to the file");
      check(docsPage("README.md").includes("# Shop (renamed)"), "refreshes the docs folder on save");

      const outside = await page(`window.openArchDesktop.load("/etc/hosts").then(() => "loaded", (e) => e.message)`);
      check(String(outside).includes("wasn't opened"), "refuses files the user didn't open");

      // An agent's change through the CLI shows up without a reload.
      runCli("update-element", "web-app", "--name", "Storefront");
      await sleep(2000);
      const after = await text();
      check(after.includes("Storefront") && after.includes("changed outside this window"), "reloads when the CLI changes the file");
      check(docsPage("elements/web-app.md").includes("# Storefront"), "the CLI refreshes the docs too");
      await screenshot(win, "2-reloaded.png");

      // Export the view as a picture. The app asks where to save as Chrome does; the test stands
      // in for the dialog, which would wait for a person, and keeps what's written.
      check(await page(`typeof window.showSaveFilePicker === "function"`), "asks where to save a picture");
      const saveAs = (label) => page(`(async () => {
        let written;
        window.showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async (data) => { written = data; }, close: async () => {} }) });
        [...document.querySelectorAll(".toolbar button")].find((b) => b.textContent.trim() === "Export").click();
        await new Promise((r) => setTimeout(r, 100));
        [...document.querySelectorAll('.context-menu [role="menuitem"]')].find((b) => b.textContent === ${JSON.stringify(label)}).click();
        for (let i = 0; i < 100 && !written; i++) await new Promise((r) => setTimeout(r, 100));
        return written ? [...new Uint8Array(await written.arrayBuffer()).slice(0, 8)].join(",") + "/" + written.size : "nothing written";
      })()`);
      const png = await saveAs("Save as PNG…");
      check(png.startsWith("137,80,78,71,13,10,26,10/") && Number(png.split("/")[1]) > 10_000, `saves the view as a PNG (${png})`);
      const pdf = await saveAs("Save as PDF…");
      check(pdf.startsWith("37,80,68,70,45,49,46,52/"), `saves the view as a PDF (${pdf})`);

      // Ask AI: send a request, approve what the agent asks to do, then undo its change.
      const click = (selector, label) => page(`(() => {
        const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.textContent.trim() === ${JSON.stringify(label)});
        button?.click();
        return !!button;
      })()`);
      check(await click(".topbar button", "Ask AI"), "offers Ask AI in the desktop app");
      await page(`(() => {
        const box = document.querySelector(".ask-ai textarea");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, "Add a cart cache");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      })()`);
      await sleep(100);
      await click(".ask-ai button", "Send");
      await sleep(500);
      check(agentRequests[0]?.path === file && agentRequests[0]?.prompt === "Add a cart cache" && !!agentRequests[0]?.context.viewId, "sends the request with the open view");
      check((await page(`document.querySelector(".ask-ai-permission")?.innerText ?? ""`)).includes("ls"), "shows the agent's permission request");
      await click(".ask-ai button", "Approve");
      await sleep(1500);
      check("cart-cache" in doc().elements, "the agent changes the file once approved");
      const panel = await page(`document.querySelector(".ask-ai").innerText`);
      check(panel.includes("Added the Cart Cache container.") && panel.includes("Undo AI change"), "shows the outcome and offers to undo it");
      await screenshot(win, "3-ask-ai.png");
      await click(".ask-ai button", "Undo AI change");
      await sleep(1000);
      check(!("cart-cache" in doc().elements) && doc().elements["web-app"].name === "Storefront", "Undo AI change restores the file as it was");

      const unique = [...new Set(errors)];
      check(errors.length === 0, `no console errors${errors.length ? ` (${errors.length}): ${unique.join(" | ")}` : ""}`);
    } catch (error) {
      check(false, `smoke test crashed: ${error.stack ?? error}${errors.length ? `\nconsole errors: ${errors.join(" | ")}` : ""}`);
    }
    app.exit(failures.length ? 1 : 0);
  });
});
