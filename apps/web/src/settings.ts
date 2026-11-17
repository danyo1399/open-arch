/**
 * The designer's settings for the person using it: how the Views list is sorted,
 * which views they pinned to the top of it in each workspace, the link of each
 * workspace they shared, whether they turned down the web app's offer to
 * install it, what boxes and notes snap to as they drag them, and the size of
 * the side panels and which are collapsed. They're kept in IndexedDB, in the
 * desktop app too, not in the .openarch file, so everyone who opens a workspace
 * has their own.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { committed, done } from "./library.js";
import { renamedId, type Rename, type ViewOrder } from "./model.js";
import { problemText } from "./problems.js";
import type { Share } from "./share.js";

const STORE = "settings";
const VIEW_ORDER = "view-order";
const INSTALL_PROMPT = "install-prompt";
const SNAP = "snap";
const PANELS = "panels";
/** What boxes and sticky notes snap to as they're dragged: the other boxes' edges and middles, the grid of dots, both or neither. */
export interface SnapSettings {
  guides: boolean;
  grid: boolean;
}

/** Until it's changed, what's dragged lines up with the other boxes, and not with the grid. */
export const SNAP_DEFAULTS: SnapSettings = { guides: true, grid: false };

/** The snap setting as it's stored, with what isn't stored as it is until it's changed. */
function snapIn(stored: Partial<SnapSettings> | undefined): SnapSettings {
  return {
    guides: typeof stored?.guides === "boolean" ? stored.guides : SNAP_DEFAULTS.guides,
    grid: typeof stored?.grid === "boolean" ? stored.grid : SNAP_DEFAULTS.grid,
  };
}

/**
 * The side panels beside the diagram: the Views & model panel on its left, and the Details
 * panel on its right, or under it on a screen up to 900 pixels wide. Each can be collapsed to a
 * strip, and dragged to a size. A size that's never been dragged is left out: the panel then has
 * its usual size for the screen.
 */
export interface PanelSettings {
  browseCollapsed: boolean;
  detailsCollapsed: boolean;
  /** The Views & model panel's width, in pixels. */
  browseWidth?: number;
  /** The Details panel's width beside the diagram. */
  detailsWidth?: number;
  /** The Details panel's height under the diagram. */
  detailsHeight?: number;
}

/** A side panel's size, as it's kept. */
export type PanelSize = "browseWidth" | "detailsWidth" | "detailsHeight";

/** Until they're changed, both panels are open, at their usual size. */
export const PANEL_DEFAULTS: PanelSettings = { browseCollapsed: false, detailsCollapsed: false };

/** The smallest and largest each size can be dragged to. A small window makes the largest smaller (see panelMax). */
export const PANEL_LIMITS: Record<PanelSize, { min: number; max: number }> = {
  browseWidth: { min: 180, max: 480 },
  detailsWidth: { min: 240, max: 560 },
  detailsHeight: { min: 120, max: 640 },
};

/** A size within its limits, in whole pixels. */
export function clampPanel(size: PanelSize, value: number): number {
  const { min, max } = PANEL_LIMITS[size];
  return Math.round(Math.min(max, Math.max(min, value)));
}

/** The panel settings as they're stored, with what isn't stored, or can't be used, as it is until it's changed. */
function panelsIn(stored: Partial<PanelSettings> | undefined): PanelSettings {
  const panels: PanelSettings = {
    browseCollapsed: typeof stored?.browseCollapsed === "boolean" ? stored.browseCollapsed : PANEL_DEFAULTS.browseCollapsed,
    detailsCollapsed: typeof stored?.detailsCollapsed === "boolean" ? stored.detailsCollapsed : PANEL_DEFAULTS.detailsCollapsed,
  };
  for (const size of Object.keys(PANEL_LIMITS) as PanelSize[]) {
    const value = stored?.[size];
    if (typeof value === "number" && Number.isFinite(value)) panels[size] = clampPanel(size, value);
  }
  return panels;
}

/** Whether two panel settings say the same. */
function samePanels(a: PanelSettings, b: PanelSettings): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof PanelSettings)[]);
  return [...keys].every((key) => a[key] === b[key]);
}

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
    }).catch((error: unknown) => {
      this.db = null;
      throw new Error(`This browser won't let open-arch keep your settings: ${problemText(error)}`);
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

  async snap(): Promise<SnapSettings> {
    return snapIn(await this.get<Partial<SnapSettings>>(SNAP));
  }

  /** Changes what's dragged snaps to, keeping a change made in another tab to the rest. Returns the setting as it's stored now. */
  async setSnap(change: Partial<SnapSettings>): Promise<SnapSettings> {
    return snapIn(await this.update<Partial<SnapSettings>>(SNAP, (stored) => ({ ...snapIn(stored), ...change })));
  }

  async panels(): Promise<PanelSettings> {
    return panelsIn(await this.get<Partial<PanelSettings>>(PANELS));
  }

  /**
   * Collapses or expands the side panels, or changes their size, keeping a change made in another
   * tab to the rest. A size of undefined goes back to the usual size. Returns the settings as
   * they're stored now.
   */
  async setPanels(change: Partial<PanelSettings>): Promise<PanelSettings> {
    return panelsIn(await this.update<Partial<PanelSettings>>(PANELS, (stored) => panelsIn({ ...panelsIn(stored), ...change })));
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

export interface SnapSetting {
  snap: SnapSettings;
  /** Turns lining up or the grid on or off. Rejects if the setting couldn't be stored. It still changes for as long as the designer is open. */
  setSnap(change: Partial<SnapSettings>): Promise<void>;
}

/** What boxes and sticky notes snap to as they're dragged, on every view. */
export function useSnapSettings(settings: Settings = userSettings): SnapSetting {
  const [snap, setShown] = useState<SnapSettings>(SNAP_DEFAULTS);
  /** Whether it was changed here, so reading what was stored doesn't undo a change made before it's read. */
  const changed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    settings
      .snap()
      .then((s) => !cancelled && !changed.current && setShown(s))
      // Without stored settings, it snaps as it does until it's changed.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settings]);

  const setSnap = useCallback(
    async (change: Partial<SnapSettings>) => {
      changed.current = true;
      setShown((s) => ({ ...s, ...change }));
      // What's stored has any change made in another tab too.
      setShown(await settings.setSnap(change));
    },
    [settings],
  );

  return { snap, setSnap };
}

/** How long the designer waits for the stored panel settings, in milliseconds. A browser whose storage doesn't answer still opens it. */
export const PANELS_WAIT = 500;

export interface PanelSetting {
  panels: PanelSettings;
  /**
   * Whether the stored settings have been read, so the panels open as they were left, not at
   * their usual size first. If they couldn't be read, or take longer than PANELS_WAIT, it's true
   * anyway, with the panels as they are until changed; settings read after that still apply.
   */
  loaded: boolean;
  /** Collapses or expands the panels, or sizes them. Rejects if the setting couldn't be stored. It still changes for as long as the designer is open. */
  setPanels(change: Partial<PanelSettings>): Promise<void>;
}

/** The side panels' sizes, and which are collapsed, in every workspace. */
export function usePanelSettings(settings: Settings = userSettings): PanelSetting {
  const [panels, setShown] = useState<PanelSettings>(PANEL_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  /** How many changes were made here, so reading what was stored doesn't undo a change made before it's read, or since. */
  const changes = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const waited = setTimeout(() => setLoaded(true), PANELS_WAIT);
    settings
      .panels()
      .then((p) => !cancelled && changes.current === 0 && setShown(p))
      // Without stored settings, the panels are open, at their usual size.
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(waited);
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
      clearTimeout(waited);
    };
  }, [settings]);

  const setPanels = useCallback(
    async (change: Partial<PanelSettings>) => {
      const made = ++changes.current;
      setShown((p) => panelsIn({ ...p, ...change }));
      const stored = await settings.setPanels(change);
      // What's stored has any change made in another tab too, unless a later change here is on its way.
      if (made === changes.current) setShown((p) => (samePanels(p, stored) ? p : stored));
    },
    [settings],
  );

  return { panels, loaded, setPanels };
}
