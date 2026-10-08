import { state } from "../lib/state.js";
import { closeMenuIfOpen } from "../render.js";

// How installing works depends entirely on the browser:
//   - Chrome, Edge, Samsung Internet (Android and computers) hand the page a
//     `beforeinstallprompt` event, which lets our own button open the real
//     install dialog. Because we take that over, the browser's own automatic
//     install bar no longer appears -- so we show our own install pop-up.
//   - iPhone/iPad never allow a page to install itself; people must use
//     Safari's Share > Add to Home Screen, so we show those steps.
//   - In-app browsers (inside WhatsApp, Facebook, Instagram...) can't
//     install at all; people need to open the link in their real browser.
// The menu/footer button is always available (unless already installed) and
// falls back to the right written steps whenever no dialog can be opened.
export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const userAgent = navigator.userAgent;
export const isAppleMobile = () => /iphone|ipad|ipod/i.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(userAgent);
export const isInAppBrowser = () => /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|TikTok|musical_ly|; wv\)/i.test(userAgent);
const INSTALL_DISMISS_KEY = "ha-install-dismissed";
const INSTALL_DISMISS_DAYS = 14;

function installPlatform() {
  if (isInAppBrowser()) return isAppleMobile() ? "in-app-ios" : "in-app-android";
  if (isAppleMobile()) return /CriOS|FxiOS|EdgiOS/i.test(userAgent) ? "ios-other" : "ios-safari";
  if (isAndroid()) {
    if (/SamsungBrowser/i.test(userAgent)) return "samsung";
    if (/Firefox/i.test(userAgent)) return "android-firefox";
    return "android-chrome";
  }
  if (/Firefox/i.test(userAgent)) return "desktop-firefox";
  if (/Safari/i.test(userAgent) && !/Chrome|Chromium|Edg/i.test(userAgent)) return "desktop-safari";
  return "desktop-chrome";
}

const INSTALL_STEPS = {
  "ios-safari": [
    "Tap the <strong>Share</strong> button (the square with an arrow) at the bottom of Safari.",
    "Scroll down and tap <strong>Add to Home Screen</strong>.",
    "Tap <strong>Add</strong>. The app appears on your home screen."
  ],
  "ios-other": [
    "Tap the <strong>Share</strong> button (the square with an arrow) in the address bar.",
    "Tap <strong>Add to Home Screen</strong>. If you don't see it, open this page in <strong>Safari</strong> and try again.",
    "Tap <strong>Add</strong>."
  ],
  "in-app-ios": [
    "You're viewing this inside another app, which can't install apps.",
    "Tap the <strong>&middot;&middot;&middot;</strong> or <strong>Share</strong> button and choose <strong>Open in Safari</strong>.",
    "In Safari, tap <strong>Share</strong> then <strong>Add to Home Screen</strong>."
  ],
  "in-app-android": [
    "You're viewing this inside another app, which can't install apps.",
    "Tap the <strong>&#8942;</strong> menu (top right) and choose <strong>Open in Chrome</strong> (or <em>Open in browser</em>).",
    "In Chrome, tap <strong>Install App</strong> on this page."
  ],
  "android-chrome": [
    "Tap the <strong>&#8942;</strong> menu at the top right of Chrome.",
    "Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).",
    "Tap <strong>Install</strong>. The app appears on your home screen."
  ],
  samsung: [
    "Tap the <strong>&#8801;</strong> menu at the bottom of the screen.",
    "Tap <strong>Add page to</strong>, then <strong>Home screen</strong>.",
    "Tap <strong>Add</strong>."
  ],
  "android-firefox": [
    "Tap the <strong>&#8942;</strong> menu.",
    "Tap <strong>Install</strong> (or <strong>Add to Home screen</strong>).",
    "Tap <strong>Add</strong>."
  ],
  "desktop-chrome": [
    "Look for the <strong>install icon</strong> (a screen with a down arrow) at the right end of the address bar, and click it.",
    "No icon? Open the <strong>&#8942;</strong> menu &rarr; <strong>Cast, save and share</strong> &rarr; <strong>Install page as app</strong> (in Edge: <strong>Apps</strong> &rarr; <strong>Install this site as an app</strong>).",
    "Click <strong>Install</strong>. The app opens in its own window and appears in your Start menu or Dock."
  ],
  "desktop-safari": [
    "In the menu bar, click <strong>File</strong>.",
    "Click <strong>Add to Dock</strong>.",
    "Click <strong>Add</strong>."
  ],
  "desktop-firefox": [
    "Firefox on computers can't install web apps.",
    "Open this site in <strong>Chrome</strong> or <strong>Edge</strong>, then click <strong>Install App</strong>."
  ]
};

function showInstallSteps() {
  const steps = INSTALL_STEPS[installPlatform()];
  const modal = document.createElement("div");
  modal.className = "form-modal";
  modal.innerHTML = `
    <div class="form-modal-panel install-steps" role="dialog" aria-modal="true" aria-label="Install the app">
      <button class="form-modal-close" type="button" aria-label="Close">&times;</button>
      <img src="/icons/icon-192.png" alt="" />
      <h3>Install Harvesters Akure</h3>
      <ol>${steps.map(step => `<li>${step}</li>`).join("")}</ol>
      <button class="btn primary block" type="button">Got it</button>
    </div>
  `;
  const close = () => {
    modal.remove();
    document.body.classList.remove("modal-open");
  };
  modal.addEventListener("click", event => {
    if (event.target === modal || event.target.closest("button")) close();
  });
  document.body.appendChild(modal);
  document.body.classList.add("modal-open");
}

export async function installApp() {
  closeMenuIfOpen();
  hideInstallBanner();
  if (!state.deferredInstall) {
    showInstallSteps();
    return;
  }
  state.deferredInstall.prompt();
  const choice = await state.deferredInstall.userChoice.catch(() => null);
  state.deferredInstall = null;
  if (choice?.outcome === "dismissed") rememberInstallDismissed();
}

export function updateInstallButtons() {
  document.querySelectorAll("[data-install]").forEach(button => {
    button.hidden = isStandalone();
  });
}

// ---- Automatic install pop-up ----

function installRecentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(INSTALL_DISMISS_KEY));
    return Boolean(at) && Date.now() - at < INSTALL_DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

function rememberInstallDismissed() {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
  } catch {
    // private browsing: the pop-up may simply show again next visit
  }
}

export function hideInstallBanner() {
  document.querySelector(".install-banner")?.remove();
}

export function showInstallBanner() {
  if (isStandalone() || installRecentlyDismissed() || state.activeView === "dashboard" || document.querySelector(".install-banner")) return;
  const direct = Boolean(state.deferredInstall);
  const banner = document.createElement("div");
  banner.className = "install-banner";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-label", "Install the Harvesters Akure app");
  banner.innerHTML = `
    <img src="/icons/icon-192.png" alt="" />
    <div>
      <strong>Get the Harvesters Akure app</strong>
      <span>${direct ? "Install it on your device for quick access, even on a weak connection." : "Add it to your home screen for quick access."}</span>
    </div>
    <div class="install-banner-actions">
      <button class="btn primary small" type="button" data-banner-install>${direct ? "Install" : "Show me how"}</button>
      <button class="btn ghost-dark small" type="button" data-banner-dismiss>Not now</button>
    </div>
  `;
  banner.querySelector("[data-banner-install]").addEventListener("click", installApp);
  banner.querySelector("[data-banner-dismiss]").addEventListener("click", () => {
    rememberInstallDismissed();
    hideInstallBanner();
  });
  document.body.appendChild(banner);
}
