// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installWay, InstallOffer, type BrowserFacts } from "../src/install.js";
import { InstallPrompt } from "../src/InstallPrompt.js";
import { Settings } from "../src/settings.js";
import { button, click, mount } from "./dom.js";

const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const MAC_SAFARI_16 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15";
const MAC_FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const facts = (userAgent: string, more: Partial<BrowserFacts> = {}): BrowserFacts => ({ userAgent, maxTouchPoints: 0, standalone: false, offered: false, ...more });

describe("installWay", () => {
  it("uses the browser's own dialog when it offers one", () => {
    expect(installWay(facts(CHROME, { offered: true }))).toBe("prompt");
    expect(installWay(facts(CHROME))).toBeNull();
  });

  it("points iPhones and iPads at the Share menu, in any browser", () => {
    expect(installWay(facts(IPHONE))).toBe("share");
    expect(installWay(facts(IPHONE_CHROME))).toBe("share");
    // An iPad says it's a Mac, but has a touch screen.
    expect(installWay(facts(MAC_SAFARI, { maxTouchPoints: 5 }))).toBe("share");
  });

  it("points Safari on a Mac at File › Add to Dock, from version 17", () => {
    expect(installWay(facts(MAC_SAFARI))).toBe("dock");
    expect(installWay(facts(MAC_SAFARI_16))).toBeNull();
    expect(installWay(facts(MAC_FIREFOX))).toBeNull();
    expect(installWay(facts(MAC_CHROME))).toBeNull();
  });

  it("offers nothing once the app is open as an app", () => {
    expect(installWay(facts(CHROME, { offered: true, standalone: true }))).toBeNull();
    expect(installWay(facts(IPHONE, { standalone: true }))).toBeNull();
  });
});

let dbCount = 0;
/** Each test gets its own settings. */
const fresh = () => new Settings(`install-test-${++dbCount}`);

/** A browser's offer to install, as Chromium makes it. */
function offerEvent(outcome: "accepted" | "dismissed") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

/** Waits for the stored settings to be read. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InstallPrompt", () => {
  it("shows its own prompt in place of the browser's, which Install opens", async () => {
    const page = new EventTarget();
    const offer = new InstallOffer();
    offer.listen(page);
    const host = mount(createElement(InstallPrompt, { offer, settings: fresh() }));
    await settle();
    expect(host.textContent).toBe("");

    const event = offerEvent("accepted");
    act(() => void page.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(host.textContent).toContain("Install open-arch as an app.");

    await click(button(host, "Install"));
    expect(event.prompt).toHaveBeenCalledOnce();
    // The browser's offer can be used once.
    expect(host.textContent).toBe("");
    expect(await offer.install()).toBe(false);
  });

  it("goes for good once the app is installed", async () => {
    const page = new EventTarget();
    const offer = new InstallOffer();
    offer.listen(page);
    const host = mount(createElement(InstallPrompt, { offer, settings: fresh() }));
    await settle();
    act(() => void page.dispatchEvent(offerEvent("accepted")));
    expect(host.textContent).not.toBe("");
    act(() => void page.dispatchEvent(new Event("appinstalled")));
    expect(host.textContent).toBe("");
  });

  it("says where Safari's command is, as it has no dialog to open", async () => {
    vi.stubGlobal("navigator", { userAgent: IPHONE, maxTouchPoints: 5 });
    const host = mount(createElement(InstallPrompt, { offer: new InstallOffer(), settings: fresh() }));
    await settle();
    expect(host.textContent).toContain("Tap Share, then Add to Home Screen.");
    expect(() => button(host, "Install")).toThrow();
  });

  it("stays hidden in this browser after Not now", async () => {
    const settings = fresh();
    const page = new EventTarget();
    const offer = new InstallOffer();
    offer.listen(page);
    act(() => void page.dispatchEvent(offerEvent("dismissed")));
    const host = mount(createElement(InstallPrompt, { offer, settings }));
    await settle();
    await click(button(host, "Not now"));
    expect(host.textContent).toBe("");
    await settle();
    expect(await settings.installPromptDismissed()).toBe(true);

    const again = mount(createElement(InstallPrompt, { offer, settings }));
    await settle();
    expect(again.textContent).toBe("");
  });
});
