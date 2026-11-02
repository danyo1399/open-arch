/** The web start page's offer to install open-arch as an app, on browsers that can. */
import { installOffer, useInstallPrompt, type InstallOffer } from "./install.js";
import { userSettings, type Settings } from "./settings.js";

const HOW = {
  prompt: null,
  share: (
    <>
      Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
    </>
  ),
  dock: (
    <>
      Choose <strong>File › Add to Dock</strong>.
    </>
  ),
};

export function InstallPrompt({ offer = installOffer, settings = userSettings }: { offer?: InstallOffer; settings?: Settings }) {
  const { way, install, dismiss } = useInstallPrompt(offer, settings);
  if (!way) return null;
  return (
    <section className="install-prompt" aria-label="Install open-arch">
      <p>
        <strong>Install open-arch as an app.</strong> It opens in its own window and works offline. {HOW[way]}
      </p>
      <div className="install-actions">
        {way === "prompt" && (
          <button className="primary" onClick={() => void install()}>
            Install
          </button>
        )}
        <button onClick={dismiss}>Not now</button>
      </div>
    </section>
  );
}
