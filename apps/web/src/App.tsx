import { useEffect, useState } from "react";
import { Designer } from "./Designer.js";
import { BrowserHost, desktopBridge, DesktopHost, SharedHost, type WorkspaceHost } from "./hosts.js";
import { browserLibrary } from "./library.js";
import { LibraryPage } from "./LibraryPage.js";
import { linkSuffix, readLink, shareClient } from "./share.js";
import { DesktopStart } from "./Start.js";

/** The web app names the open workspace in the URL, so reloading the page reopens it. */
const idInUrl = () => location.hash.slice(1);

/** The URL for what's open: a shared workspace's link, a workspace in this browser's ID, or nothing. */
function urlFor(host: WorkspaceHost | null): string {
  const query = new URLSearchParams(location.search);
  query.delete("share");
  query.delete("v");
  const page = location.pathname + (query.size ? `?${query}` : "");
  if (host instanceof SharedHost) return location.pathname + linkSuffix(host.link);
  return host instanceof BrowserHost ? `${page}#${host.id}` : page;
}

export function App() {
  const desktop = desktopBridge();
  // A share link opens the workspace it names.
  const [host, setHost] = useState<WorkspaceHost | null>(() => {
    const link = desktop ? null : readLink(location.href);
    return link ? new SharedHost(shareClient, link) : null;
  });
  // Until the workspace in the URL is found, show nothing rather than flash the list.
  const [restoring, setRestoring] = useState(() => !desktop && !host && idInUrl() !== "");

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

  // A link to an earlier version of a shared workspace opens the latest, and the URL becomes its link.
  useEffect(() => {
    if (desktop || restoring) return;
    const follow = () => {
      const url = urlFor(host);
      if (location.pathname + location.search + location.hash !== url) history.replaceState(null, "", url);
    };
    follow();
    return host instanceof SharedHost ? host.onLinkChange(follow) : undefined;
  }, [desktop, host, restoring]);

  if (host) {
    const key = host instanceof BrowserHost ? host.id : host.key;
    return <Designer key={key} host={host} onClose={() => setHost(null)} onHostChange={setHost} />;
  }
  if (restoring) return null;
  return desktop ? <DesktopStart desktop={desktop} onOpen={setHost} /> : <LibraryPage library={browserLibrary} onOpen={setHost} />;
}
