import { toast } from "./components/dialogs.js";
import { closeChoiceModal } from "./components/forms.js";
import { hideInstallBanner, isAppleMobile, isInAppBrowser, isStandalone, showInstallBanner, updateInstallButtons } from "./components/installPrompt.js";
import { sendSavedForms } from "./lib/api.js";
import { loadMemberProfile } from "./lib/member.js";
import { syncLocation, viewFromLocation } from "./lib/router.js";
import { state } from "./lib/state.js";
import { navigate, render } from "./render.js";

syncLocation(state.activeView, true);

window.addEventListener("popstate", () => navigate(viewFromLocation(), { fromHistory: true }));
window.addEventListener("hashchange", () => navigate(viewFromLocation(), { fromHistory: true }));

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.querySelector(".form-modal")) closeChoiceModal();
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  state.deferredInstall = event;
  updateInstallButtons();
  setTimeout(showInstallBanner, 2500);
});

// Browsers that never send beforeinstallprompt (iPhone, in-app browsers)
// still get the pop-up, offering the written steps instead.
if (!isStandalone() && (isAppleMobile() || isInAppBrowser())) {
  setTimeout(showInstallBanner, 4000);
}

window.addEventListener("appinstalled", () => {
  state.deferredInstall = null;
  hideInstallBanner();
  updateInstallButtons();
  toast("Harvesters Akure is installed. You'll find it on your home screen.", "success");
});

window.addEventListener("online", sendSavedForms);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") sendSavedForms();
});

// Only production builds: in `npm run dev` a service worker would serve
// stale files and hide changes while editing.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

render();
sendSavedForms();
if (state.memberProfile === undefined) loadMemberProfile();
