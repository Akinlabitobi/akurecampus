import { SHARE_PAGES } from "./share-meta.js";

export const navItems = [
  ["home", "Home"],
  ["about", "About"],
  ["communities", "Communities"],
  ["nlp", "NLP"],
  ["giving", "Giving"],
  ["counselling", "Counselling"],
  ["workforce", "Workforce"],
  ["partnership", "Partnership"],
  ["birthdays", "Birthdays"],
  ["gallery", "Gallery"],
  ["contact", "Contact"],
  ["profile", "My Profile"]
];

// Every view has a real path (/birthdays, /admin...) so that a shared link
// gets that page's own WhatsApp/Facebook preview: vite.config.js writes a
// dist/<path>/index.html per view carrying its tags (see src/lib/share-meta.js).
// Old "#birthdays"-style links still work and are rewritten to the path.
// "admin" is the friendly public name for the "dashboard" view.
// "attendance" and "lead-a-cell" are linked from the footer, not the main menu.
const PATH_ALIASES = { admin: "dashboard" };
const VALID_VIEWS = [...navItems.map(([id]) => id), "attendance", "lead-a-cell", "dashboard"];

export function viewFromLocation() {
  const pick = raw => {
    const view = PATH_ALIASES[raw] || raw;
    return VALID_VIEWS.includes(view) ? view : "";
  };
  return pick(window.location.pathname.replace(/^\/+|\/+$/g, "")) || pick(window.location.hash.replace(/^#/, "")) || "home";
}

export function pathForView(view) {
  return SHARE_PAGES[view]?.path || `/${view}`;
}

export function syncLocation(view, replace = false) {
  const path = pathForView(view);
  if (window.location.pathname !== path || window.location.hash) {
    history[replace ? "replaceState" : "pushState"](null, "", path + window.location.search);
  }
  document.title = SHARE_PAGES[view]?.title || SHARE_PAGES.home.title;
}
