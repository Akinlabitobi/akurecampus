import { contactInfo, socialLinks } from "../lib/config.js";
import { memberButtonLabel } from "../lib/member.js";
import { navItems } from "../lib/router.js";
import { state } from "../lib/state.js";
import { icon } from "./icon.js";
import { isStandalone } from "./installPrompt.js";

export function shell(content) {
  return `
    <nav class="topbar">
      <a class="brand" href="/" data-nav="home" aria-label="Harvesters Akure home">
        <img src="/logo-black.png" alt="Harvesters Akure" />
        
      </a>
      <div class="navlinks ${state.menuOpen ? "open" : ""}">
        ${navItems.map(([id, label]) => `<button class="${state.activeView === id ? "active" : ""}" data-nav="${id}" ${id === "profile" ? "data-member-label" : ""}>${id === "profile" ? memberButtonLabel() : label}</button>`).join("")}
        <button class="install-link" type="button" data-install ${isStandalone() ? "hidden" : ""}>${icon("download")} Install App</button>
      </div>
      <div class="actions">
        <button class="btn member-btn ${state.activeView === "profile" ? "active" : ""}" data-nav="profile">${icon("users")} <span data-member-label>${memberButtonLabel()}</span></button>
        <button class="btn primary" data-nav="communities">Join Community</button>
        <button class="btn blue" data-nav="giving">Give</button>
        <button class="menu-toggle" aria-label="Toggle menu" data-menu>${icon("menu")}</button>
      </div>
    </nav>
    <main>${content}</main>
    ${footer()}
  `;
}

function footer() {
  return `
    <footer>
      <div class="newsletter">
        <div><h3>Stay Updated</h3><p>Get launch updates, prayer alerts, and community news from Harvesters Akure.</p></div>
        <form data-api-form data-form-type="newsletter"><input name="emailAddress" type="email" placeholder="Enter your email" required /><button class="btn primary">Stay Connected ${icon("arrow")}</button></form>
      </div>
      <div class="footer-main">
        <div><img src="/logo-white.png" alt="Harvesters Akure" /><p>A campus of Harvesters International Christian Centre, coming to Akure.</p></div>
        <div><h4>The Church</h4><button data-nav="about">About Harvesters Akure</button><button data-nav="nlp">Next Level Prayers</button><button data-nav="gallery">Gallery</button></div>
        <div><h4>Get Involved</h4><button data-nav="communities">Join a Community</button><button data-nav="workforce">Join the Workforce</button><button data-nav="lead-a-cell">Lead a Cell</button><button data-nav="partnership">Partner With Us</button><button data-nav="birthdays">Birthday Celebrations</button><button data-nav="profile">My Profile</button><button data-nav="attendance">Mark Attendance</button><button type="button" data-install ${isStandalone() ? "hidden" : ""}>Install the App</button></div>
        <div><h4>Contact</h4><p>Akure, Ondo State</p><a href="${contactInfo.phoneHref}">${contactInfo.phone}</a><p>akure@harvestersng.org</p><div class="footer-social">${socialLinks.map(social => `<a href="${social.url}" target="_blank" rel="noopener noreferrer" aria-label="${social.name} ${social.handle}" title="${social.name} ${social.handle}">${icon(social.name.toLowerCase())}</a>`).join("")}</div><button data-nav="dashboard">Team Dashboard</button><a href="/callcentre/">Outreach Call Centre</a></div>
      </div>
      <div class="copyright">© 2026 Harvesters Akure. A campus of Harvesters International Christian Centre.</div>
    </footer>
  `;
}
