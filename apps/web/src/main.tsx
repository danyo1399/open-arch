import "@xyflow/react/dist/style.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { installOffer } from "./install.js";

// Before the first render: the browser can offer to install the app as soon as the page loads.
installOffer.listen(window);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The service worker makes the app installable and lets it open offline. Only a build served over
// http(s) has one: the dev server doesn't write it, and the desktop app loads from file://.
if (import.meta.env.PROD && location.protocol.startsWith("http") && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register("./sw.js");
}
