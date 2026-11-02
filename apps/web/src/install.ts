/**
 * Offering to install the web app. Chrome, Edge and other Chromium browsers say when they can
 * install it, and the start page asks with its own prompt in place of theirs. Safari has no
 * such event, so on an iPhone or iPad, and in Safari on a Mac, the prompt says where to find
 * the browser's own command instead.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { userSettings, type Settings } from "./settings.js";

/** Chromium's event, which the DOM's types don't have. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Holds the browser's offer to install the app, from when it's made until it's used or the app is installed. */
export class InstallOffer {
  private event: BeforeInstallPromptEvent | null = null;
  private listeners = new Set<() => void>();
  /** Installed while the page was open. */
  installed = false;

  /** Starts listening. Call it before the page renders, as the browser can make its offer straight away. */
  listen(target: EventTarget): void {
    target.addEventListener("beforeinstallprompt", (e) => {
      // Stops the browser's own prompt, such as Chrome's bar on Android, so ours shows instead.
      e.preventDefault();
      this.event = e as BeforeInstallPromptEvent;
      this.changed();
    });
    target.addEventListener("appinstalled", () => {
      this.event = null;
      this.installed = true;
      this.changed();
    });
  }

  get available(): boolean {
    return this.event !== null;
  }

  /** Shows the browser's install dialog. The offer can be used only once. Returns whether the app was installed. */
  async install(): Promise<boolean> {
    const event = this.event;
    if (!event) return false;
    this.event = null;
    this.changed();
    await event.prompt();
    return (await event.userChoice).outcome === "accepted";
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}

/** The page's offer, listened for in main.tsx. */
export const installOffer = new InstallOffer();

/**
 * How this browser installs the app: "prompt" with its own dialog, "share" from an iPhone's or
 * iPad's Share menu, "dock" from Safari's File menu on a Mac, or null when it can't, or the app
 * is installed and open already.
 */
export type InstallWay = "prompt" | "share" | "dock" | null;

export interface BrowserFacts {
  userAgent: string;
  /** Touch points: an iPad says it's a Mac, but a Mac has none. */
  maxTouchPoints: number;
  /** Open as an installed app, not in a browser tab. */
  standalone: boolean;
  /** The browser has offered to install it. */
  offered: boolean;
}

export function installWay({ userAgent, maxTouchPoints, standalone, offered }: BrowserFacts): InstallWay {
  if (standalone) return null;
  if (offered) return "prompt";
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  // From iOS 16.4, every browser on an iPhone or iPad can add the app to the Home Screen from its Share menu.
  if (ios) return "share";
  // Safari on a Mac, version 17 or later; other Mac browsers say Chrome, Edge or Firefox too.
  const safari = /Macintosh/.test(userAgent) && /Version\/(\d+)[\d.]* Safari/.exec(userAgent);
  if (safari && Number(safari[1]) >= 17 && !/Chrome|Chromium|Edg|Firefox|FxiOS|OPR/.test(userAgent)) return "dock";
  return null;
}

function standalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

export interface InstallPromptState {
  way: InstallWay;
  /** Shows the browser's install dialog. */
  install(): Promise<void>;
  /** Hides the prompt in this browser for good. */
  dismiss(): void;
}

/** Whether to offer to install the app, and how. Nothing is offered until the setting that says it was dismissed has been read. */
export function useInstallPrompt(offer: InstallOffer = installOffer, settings: Settings = userSettings): InstallPromptState {
  const offered = useSyncExternalStore(offer.subscribe, () => offer.available);
  const installed = useSyncExternalStore(offer.subscribe, () => offer.installed);
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    settings
      .installPromptDismissed()
      // If the browser won't keep settings, the prompt shows, and Not now hides it until the page is reloaded.
      .catch(() => false)
      .then((d) => !cancelled && setDismissed(d));
    return () => {
      cancelled = true;
    };
  }, [settings]);

  // A browser that refuses to show its dialog has nothing more to offer: the prompt is gone either way.
  const install = useCallback(async () => {
    await offer.install().catch(() => undefined);
  }, [offer]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    void settings.dismissInstallPrompt().catch(() => undefined);
  }, [settings]);

  const way = dismissed === false && !installed ? installWay({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, standalone: standalone(), offered }) : null;
  return { way, install, dismiss };
}
