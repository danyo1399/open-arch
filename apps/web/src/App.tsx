import { useEffect, useState } from "react";
import { Designer } from "./Designer.js";
import { BrowserHost, desktopBridge, DesktopHost, type WorkspaceHost } from "./hosts.js";
import { browserLibrary } from "./library.js";
import { LibraryPage } from "./LibraryPage.js";
import { DesktopStart } from "./Start.js";

/** The web app names the open workspace in the URL, so reloading the page reopens it. */
const idInUrl = () => location.hash.slice(1);

export function App() {
  const desktop = desktopBridge();
  const [host, setHost] = useState<WorkspaceHost | null>(null);
  // Until the workspace in the URL is found, show nothing rather than flash the list.
  const [restoring, setRestoring] = useState(() => !desktop && idInUrl() !== "");

  useEffect(() => {
    let cancelled = false;
    if (desktop) {
      // The desktop app reopens the last file.
      void desktop.lastFile().then((file) => {
        if (file && !cancelled) setHost(new DesktopHost(desktop, file.path, file.name));
      });
    } else if (restoring) {
      browserLibrary
        .get(idInUrl())
        .then((record) => {
          if (record && !cancelled) setHost(new BrowserHost(browserLibrary, record.id, record.fileName));
        })
        .catch(() => undefined)
        .finally(() => !cancelled && setRestoring(false));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (desktop || restoring) return;
    const id = host instanceof BrowserHost ? host.id : "";
    if (idInUrl() !== id) history.replaceState(null, "", id ? `#${id}` : location.pathname + location.search);
  }, [desktop, host, restoring]);

  if (host) {
    const key = host instanceof BrowserHost ? host.id : host.name + host.storage;
    return <Designer key={key} host={host} onClose={() => setHost(null)} onHostChange={setHost} />;
  }
  if (restoring) return null;
  return desktop ? <DesktopStart desktop={desktop} onOpen={setHost} /> : <LibraryPage library={browserLibrary} onOpen={setHost} />;
}
