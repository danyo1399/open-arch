/**
 * The designer's settings for the person using it: how the Views list is sorted,
 * which views they pinned to the top of it in each workspace, the link of each
 * workspace they shared, and whether they turned down the web app's offer to
 * install it. They're kept in
 * IndexedDB, in the desktop app too, not in the .openarch file, so everyone who
 * opens a workspace has their own.
 */
import { useCallback, useEffect, useState } from "react";
import { committed, done } from "./library.js";
import { renamedId, type Rename, type ViewOrder } from "./model.js";
import type { Share } from "./share.js";

const STORE = "settings";
const VIEW_ORDER = "view-order";
const INSTALL_PROMPT = "install-prompt";
/** Where a workspace's pins are kept. `workspace` is its host's key. */
const pinsKey = (workspace: string) => `pinned-views/${workspace}`;
/** Where the link a workspace was shared as is kept, with the token that changes it. */
const shareKey = (workspace: string) => `share/${workspace}`;

export class Settings {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly dbName = "open-arch-settings") {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => {
        const db = request.result;
        // Closed by a newer version of the app, or by the browser: the next call opens it again.
        db.onversionchange = () => {
          db.close();
          this.db = null;
        };
        db.onclose = () => {
          this.db = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch((error: Error) => {
      this.db = null;
      throw new Error(`This browser won't let open-arch keep your settings: ${error.message}`);
    });
    return this.db;
  }

  private async get<T>(key: string): Promise<T | undefined> {
    const store = (await this.open()).transaction(STORE, "readonly").objectStore(STORE);
    return done(store.get(key) as IDBRequest<T | undefined>);
  }

  /**
   * Changes a setting as it's stored now, so a change made in another tab isn't lost. `change`
   * returns the new value, undefined to remove it, or the value it was given to leave it be.
   */
  private async update<T>(key: string, change: (value: T | undefined) => T | undefined): Promise<T | undefined> {
    const store = (await this.open()).transaction(STORE, "readwrite").objectStore(STORE);
    const value = await done(store.get(key) as IDBRequest<T | undefined>);
    const next = change(value);
    if (next === value) return value;
    if (next === undefined) store.delete(key);
    else store.put(next, key);
    await committed(store.transaction);
    return next;
  }

  async viewOrder(): Promise<ViewOrder> {
    return (await this.get<ViewOrder>(VIEW_ORDER)) === "level" ? "level" : "name";
  }

  async setViewOrder(order: ViewOrder): Promise<void> {
    await this.update<ViewOrder>(VIEW_ORDER, () => order);
  }

  /** The IDs of the views pinned in a workspace, in the order they were pinned. */
  async pins(workspace: string): Promise<string[]> {
    return (await this.get<string[]>(pinsKey(workspace))) ?? [];
  }

  /** Pins a view in a workspace, or unpins it. Returns the workspace's pins. */
  async setPinned(workspace: string, view: string, pinned: boolean): Promise<string[]> {
    const next = await this.update<string[]>(pinsKey(workspace), (pins = []) => {
      const others = pins.filter((id) => id !== view);
      return pinned ? [...others, view] : others.length ? others : undefined;
    });
    return next ?? [];
  }

  /** Pinned views keep their pins when they're renamed. Returns the workspace's pins. */
  async renamePins(workspace: string, renames: Rename[]): Promise<string[]> {
    const next = await this.update<string[]>(pinsKey(workspace), (pins) => {
      const renamed = pins?.map((id) => renamedId(renames, id));
      return renamed?.some((id, i) => id !== pins![i]) ? renamed : pins;
    });
    return next ?? [];
  }

  /** Gives a workspace these pins, like an example the moment it's saved in the browser, which keeps it under another key. */
  async setPins(workspace: string, pins: string[]): Promise<void> {
    await this.update<string[]>(pinsKey(workspace), () => (pins.length ? pins : undefined));
  }

  /** Whether Not now was chosen on the offer to install the web app. */
  async installPromptDismissed(): Promise<boolean> {
    return (await this.get<string>(INSTALL_PROMPT)) === "dismissed";
  }

  async dismissInstallPrompt(): Promise<void> {
    await this.update<string>(INSTALL_PROMPT, () => "dismissed");
  }

  /** The link a workspace was shared as, from this browser or this computer. */
  async share(workspace: string): Promise<Share | undefined> {
    return this.get<Share>(shareKey(workspace));
  }

  /** Keeps the link a workspace was shared as, or forgets it once it isn't shared. */
  async setShare(workspace: string, share: Share | undefined): Promise<void> {
    await this.update<Share>(shareKey(workspace), () => share);
  }

  /** Removes what's kept for a workspace that's gone. Its link, if it had one, keeps working. */
  async forget(workspace: string): Promise<void> {
    await this.update<string[]>(pinsKey(workspace), () => undefined);
    await this.update<Share>(shareKey(workspace), () => undefined);
  }
}

/** The settings of whoever uses this browser, or this computer's desktop app. */
export const userSettings = new Settings();

export interface ViewSettings {
  /** Whether the stored settings have been read, so the view opened first can be the first in the list. */
  loaded: boolean;
  order: ViewOrder;
  /** The IDs of the views pinned in this workspace. */
  pins: string[];
  /** These reject if the setting couldn't be stored. It still changes for as long as the workspace is open. */
  setOrder(order: ViewOrder): Promise<void>;
  setPinned(view: string, pinned: boolean): Promise<void>;
  followRenames(renames: Rename[]): Promise<void>;
}

/** The Views list's settings for a workspace, by its host's key. */
export function useViewSettings(workspace: string, settings: Settings = userSettings): ViewSettings {
  const [order, setOrderShown] = useState<ViewOrder>("name");
  const [pins, setPins] = useState<string[]>([]);
  /** The workspace whose settings have been read. */
  const [loaded, setLoaded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([settings.viewOrder(), settings.pins(workspace)])
      .then(([o, p]) => {
        if (cancelled) return;
        setOrderShown(o);
        setPins(p);
      })
      // Without stored settings, the list is in its usual order and nothing is pinned.
      .catch(() => undefined)
      .finally(() => !cancelled && setLoaded(workspace));
    return () => {
      cancelled = true;
    };
  }, [workspace, settings]);

  const setOrder = useCallback(
    (next: ViewOrder) => {
      setOrderShown(next);
      return settings.setViewOrder(next);
    },
    [settings],
  );

  const setPinned = useCallback(
    async (view: string, pinned: boolean) => {
      setPins((p) => (pinned ? [...p.filter((id) => id !== view), view] : p.filter((id) => id !== view)));
      // What's stored has any pins made in another tab too.
      setPins(await settings.setPinned(workspace, view, pinned));
    },
    [settings, workspace],
  );

  const followRenames = useCallback(
    async (renames: Rename[]) => {
      if (renames.length === 0) return;
      setPins((p) => p.map((id) => renamedId(renames, id)));
      setPins(await settings.renamePins(workspace, renames));
    },
    [settings, workspace],
  );

  return { loaded: loaded === workspace, order, pins, setOrder, setPinned, followRenames };
}
