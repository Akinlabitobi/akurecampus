import * as THREE from "three";
import { externalLinks, contactInfo, socialLinks } from "./config.js";
import { SHARE_PAGES } from "./share-meta.js";
import { COMMUNITIES as communities } from "./communities.js";
import { postOrQueue, flushOutbox } from "./offline-queue.js";

const QUEUED_NOTE = "You're offline, so this has been saved on your device. It will be sent automatically when you're back online.";

const navItems = [
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
// dist/<path>/index.html per view carrying its tags (see src/share-meta.js).
// Old "#birthdays"-style links still work and are rewritten to the path.
// "admin" is the friendly public name for the "dashboard" view.
// "attendance" is linked from the footer only, not the main menu.
const PATH_ALIASES = { admin: "dashboard" };
const VALID_VIEWS = [...navItems.map(([id]) => id), "attendance", "dashboard"];

function viewFromLocation() {
  const pick = raw => {
    const view = PATH_ALIASES[raw] || raw;
    return VALID_VIEWS.includes(view) ? view : "";
  };
  return pick(window.location.pathname.replace(/^\/+|\/+$/g, "")) || pick(window.location.hash.replace(/^#/, "")) || "home";
}

function pathForView(view) {
  return SHARE_PAGES[view]?.path || `/${view}`;
}

function syncLocation(view, replace = false) {
  const path = pathForView(view);
  if (window.location.pathname !== path || window.location.hash) {
    history[replace ? "replaceState" : "pushState"](null, "", path + window.location.search);
  }
  document.title = SHARE_PAGES[view]?.title || SHARE_PAGES.home.title;
}

const stats = [
  ["12+", "Communities"],
  ["18", "Departments"],
  ["7", "Partnership Types"],
  ["1", "Akure Campus"]
];


const departments = [
  "Protocol", "Guest Experience", "Choir", "Media", "Production", "Ushering",
  "Security", "Children", "Teens", "Prayer", "Follow Up", "Decoration"
];

const dashboardCards = [
  ["Community Signups", "428", "+18 this week", "Track small-group interest by audience and location."],
  ["Workforce Leads", "176", "64 screened", "Monitor launch team applicants and department fit."],
  ["Partnership Pledges", "₦8.4m", "72% target", "Follow financial, resource, prayer, and volunteer partners."],
  ["Counselling Requests", "23", "6 urgent", "Assign pastoral care requests and session outcomes."]
];

const pipeline = [
  ["New", 68],
  ["Contacted", 44],
  ["Screened", 32],
  ["Assigned", 21],
  ["Onboarded", 11]
];

const adminRows = [
  ["Launch Sunday", "Event", "Published", "Aug 30"],
  ["Akure Workforce Form", "Form", "Draft", "Aug 21"],
  ["First-Time Guest Flow", "Automation", "Ready", "Aug 18"],
  ["Giving Campaign", "Finance", "Review", "Aug 24"]
];

const ALL_PERMISSIONS = ["view_dashboard", "edit_submissions", "delete_submissions", "manage_content", "send_broadcasts", "manage_admins", "export_data"];
const ROLE_DEFAULTS = {
  superadmin: ALL_PERMISSIONS.slice(),
  manager: ["view_dashboard", "edit_submissions", "manage_content", "export_data", "send_broadcasts"],
  viewer: ["view_dashboard"],
  cell_leader: ["cell_reports"]
};
const ROLE_LABELS = { viewer: "Viewer", manager: "Manager", superadmin: "Superadmin", cell_leader: "Cell leader" };
const PERMISSION_LABELS = {
  cell_reports: "Cell reports",
  view_dashboard: "View dashboard",
  edit_submissions: "Edit submissions",
  delete_submissions: "Delete submissions",
  manage_content: "Manage launch items",
  send_broadcasts: "Send SMS/email broadcasts",
  manage_admins: "Manage admin accounts",
  export_data: "Export data (CSV)"
};

const app = document.querySelector("#app");
let activeView = viewFromLocation();
syncLocation(activeView, true);
let menuOpen = false;
let activeDashboard = "overview";
let dashboardData = null;
let dashboardLoading = false;
let dailyAttendance = null;
let heroSceneCleanup = null;
let adminSession; // undefined = unchecked, null = signed out, object = signed in admin
let adminChecking = false;
let loginError = "";
let loginSubmitting = false;
let adminsList = null;
let adminsLoading = false;
let editingAdminId = null;
let adminFormError = "";
let editingLaunchItemId = null;
let broadcastAudience = null;
let broadcastBusy = false;
let broadcastNote = "";
let broadcastNoteType = "";
// The community/department picked on the Communities or Workforce page. The
// signup form stays hidden until one is picked, then opens with it locked in.
let selectedChoice = { community: "", workforce: "" };
// Photos picked on the birthday form and the profile editor, already shrunk
// to JPEG data URLs in the browser (see preparePhoto), kept outside the DOM
// so a re-render doesn't lose them.
let photoDrafts = { birthday: "", member: "" };
let photoBusy = { birthday: false, member: false };
// Member sign-in: undefined = unchecked, null = signed out, object = profile.
let memberProfile;
let memberChecking = false;
let memberStep = "email";
let memberEmail = "";
let memberNote = "";
let memberNoteType = "";
let memberBusy = false;
let memberEditing = false;
// Admin Members tab: the person whose full profile is open, by group key.
let selectedMemberKey = "";
// Cell reports (dashboard): data from /api/cell/overview, the cell and date
// being reported on, and the report being viewed.
let cellData;
let cellLoading = false;
let cellChoice = "";
let cellDate = "";
let cellDraft = null;
let cellReportView = "";
let cellReportFilter = "";

function icon(name) {
  const paths = {
    arrow: '<path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>',
    facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path>',
    instagram: '<rect width="20" height="20" x="2" y="2" rx="5"></rect><path d="M16 11.4A4 4 0 1 1 12.6 8 4 4 0 0 1 16 11.4z"></path><path d="M17.5 6.5h.01"></path>',
    tiktok: '<path d="M16 3a5 5 0 0 0 5 5"></path><path d="M16 3v12a5 5 0 1 1-5-5"></path>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>',
    heart: '<path d="M2 9.5a5.5 5.5 0 0 1 9.6-3.7.6.6 0 0 0 .8 0A5.5 5.5 0 0 1 22 9.5c0 2.3-1.5 4-3 5.5l-5.5 5.3a2 2 0 0 1-3 0L5 15c-1.5-1.5-3-3.2-3-5.5"></path>',
    briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path><rect x="2" y="6" width="20" height="14" rx="2"></rect>',
    menu: '<path d="M4 5h16"></path><path d="M4 12h16"></path><path d="M4 19h16"></path>',
    map: '<path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m22 7-9 5.7a2 2 0 0 1-2 0L2 7"></path>',
    phone: '<path d="M13.8 16.6a1 1 0 0 0 1.2-.3l.4-.5A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.5.4a1 1 0 0 0-.3 1.2 14 14 0 0 0 6.4 6.4"></path>',
    chart: '<path d="M3 3v18h18"></path><path d="m7 15 4-4 3 3 5-7"></path>',
    calendar: '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"></path><circle cx="12" cy="13" r="3"></circle>',
    cake: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"></path><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1"></path><path d="M2 21h20"></path><path d="M7 8v3"></path><path d="M12 8v3"></path><path d="M17 8v3"></path><path d="M7 4h.01"></path><path d="M12 4h.01"></path><path d="M17 4h.01"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>',
    download: '<path d="M12 15V3"></path><path d="m7 10 5 5 5-5"></path><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
}

function navigate(view, options = {}) {
  if (view !== activeView) {
    selectedChoice = { community: "", workforce: "" };
    photoDrafts = { birthday: "", member: "" };
    memberEditing = false;
    setMemberNote("");
  }
  activeView = view;
  menuOpen = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
  syncLocation(view, options.fromHistory);
  render();
}

window.addEventListener("popstate", () => navigate(viewFromLocation(), { fromHistory: true }));
window.addEventListener("hashchange", () => navigate(viewFromLocation(), { fromHistory: true }));

async function loadDashboard(force = false) {
  if (dashboardLoading || (dashboardData && !force)) return;
  dashboardLoading = true;
  try {
    const response = await fetch("/api/dashboard");
    if (response.status === 401) {
      adminSession = null;
      dashboardData = null;
      return;
    }
    if (!response.ok) throw new Error("Dashboard API is unavailable");
    dashboardData = await response.json();
  } catch (error) {
    dashboardData = { error: error.message, metrics: {}, submissions: [], recent: [], launchItems: [] };
  } finally {
    dashboardLoading = false;
    if (activeView === "dashboard") render();
  }
}

function can(permission) {
  if (!adminSession) return false;
  if (adminSession.role === "superadmin") return true;
  return Array.isArray(adminSession.permissions) && adminSession.permissions.includes(permission);
}

async function loadAdminSession() {
  if (adminChecking) return;
  adminChecking = true;
  try {
    const response = await fetch("/api/admin/me");
    const result = await response.json();
    adminSession = result.admin || null;
  } catch {
    adminSession = null;
  } finally {
    adminChecking = false;
    if (activeView === "dashboard") render();
  }
}

async function loadAdmins(force = false) {
  if (adminsLoading || (adminsList && !force)) return;
  adminsLoading = true;
  try {
    const response = await fetch("/api/admin/admins");
    if (!response.ok) throw new Error("Could not load admins.");
    const result = await response.json();
    adminsList = result.admins;
  } catch {
    adminsList = [];
  } finally {
    adminsLoading = false;
    if (activeView === "dashboard") render();
  }
}

async function loadCellData(force = false) {
  if (cellLoading || (cellData && !force)) return;
  cellLoading = true;
  try {
    const response = await fetch("/api/cell/overview");
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      adminSession = null;
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not load cell data.");
    cellData = result;
  } catch (error) {
    cellData = { error: error.message };
  } finally {
    cellLoading = false;
    if (activeView === "dashboard") render();
  }
}

async function loadBroadcastAudience(force = false) {
  if (broadcastAudience && !force) return;
  try {
    const response = await fetch("/api/admin/sms-audience");
    if (!response.ok) throw new Error("Could not load audience.");
    broadcastAudience = await response.json();
  } catch {
    broadcastAudience = { sms: { recipients: "-", maximumPerSend: 100 }, email: { recipients: "-", maximumPerSend: 100 } };
  } finally {
    if (activeView === "dashboard") render();
  }
}

async function updateSubmission(id, patch) {
  try {
    const response = await fetch(`/api/admin/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not update this record.");
    dashboardData = result.dashboard;
    render();
  } catch (error) {
    alert(error.message);
  }
}

async function deleteSubmission(id) {
  if (!confirm("Delete this record? This cannot be undone.")) return;
  // A member's key is their oldest record's id; if that record is the one
  // going, keep their detail page open by moving the key to the next one.
  const memberIds = selectedMemberKey === id
    ? memberDirectory(dashboardData?.submissions || []).find(person => person.key === id)?.records.map(row => row.id) || []
    : [];
  try {
    const response = await fetch(`/api/admin/submissions/${id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not delete this record.");
    dashboardData = result.dashboard;
    if (memberIds.length) selectedMemberKey = memberIds.find(other => other !== id) || "";
    render();
  } catch (error) {
    alert(error.message);
  }
}

// Removes every record grouped under one person in the Members tab.
async function deleteMember(key) {
  const person = memberDirectory(dashboardData?.submissions || []).find(item => item.key === key);
  if (!person) return;
  const count = person.records.length;
  if (!confirm(`Delete ${person.name || "this member"} and all ${count} of their record${count === 1 ? "" : "s"}? This cannot be undone.`)) return;
  const failed = [];
  for (const row of person.records) {
    try {
      const response = await fetch(`/api/admin/submissions/${row.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not delete this record.");
      dashboardData = result.dashboard;
    } catch (error) {
      failed.push(`${recordCode(row)}: ${error.message}`);
    }
  }
  if (!failed.length) selectedMemberKey = "";
  render();
  if (failed.length) alert(`Some records could not be deleted:\n${failed.join("\n")}`);
  else toast("Member deleted.", "success");
}

// The record "Edit" opens from the member list: their My Profile record if
// they have one, otherwise the most recent thing they submitted.
function primaryRecord(person) {
  return person.records.find(row => row.type === "member") || person.records[person.records.length - 1];
}

function fieldName(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
    // Only strips leftover separator characters (spaces, punctuation) --
    // must NOT exclude uppercase letters, since the replace above just
    // produced them (e.g. "Full name" -> "fullName"). The previous
    // [^a-z0-9] here stripped its own output's capitals right back out
    // ("fullName" -> "fullame"), silently corrupting every multi-word
    // field name the app has ever generated.
    .replace(/[^a-zA-Z0-9]/g, "");
}

function money(value) {
  return `₦${Number(value || 0).toLocaleString("en-NG")}`;
}

function recordCode(record) {
  return record.shortCode || String(record.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();
}

// Groups a table by one or more fields (e.g. community, then name within
// each community) rather than the default created-at order, so an admin
// scanning the list sees everyone in the same community/department
// together instead of interleaved by signup time.
function sortByFields(records, getters) {
  return [...records].sort((a, b) => {
    for (const get of getters) {
      const diff = String(get(a) || "").localeCompare(String(get(b) || ""));
      if (diff) return diff;
    }
    return 0;
  });
}

function shell(content) {
  return `
    <nav class="topbar">
      <a class="brand" href="/" data-nav="home" aria-label="Harvesters Akure home">
        <img src="/logo-black.png" alt="Harvesters Akure" />
        
      </a>
      <div class="navlinks ${menuOpen ? "open" : ""}">
        ${navItems.map(([id, label]) => `<button class="${activeView === id ? "active" : ""}" data-nav="${id}" ${id === "profile" ? "data-member-label" : ""}>${id === "profile" ? memberButtonLabel() : label}</button>`).join("")}
        <button class="install-link" type="button" data-install ${isStandalone() ? "hidden" : ""}>${icon("download")} Install App</button>
      </div>
      <div class="actions">
        <button class="btn member-btn ${activeView === "profile" ? "active" : ""}" data-nav="profile">${icon("users")} <span data-member-label>${memberButtonLabel()}</span></button>
        <button class="btn primary" data-nav="communities">Join Community</button>
        <button class="btn blue" data-nav="giving">Give</button>
        <button class="menu-toggle" aria-label="Toggle menu" data-menu>${icon("menu")}</button>
      </div>
    </nav>
    <main>${content}</main>
    ${footer()}
  `;
}

function home() {
  return `
    <section class="hero home-hero">
      <img class="hero-img" src="/hero_worship.png" alt="Harvesters worship gathering" />
      <div class="hero-overlay"></div>
      <canvas class="hero-canvas" data-hero-3d aria-label="3D sanctuary scene"></canvas>
      <div class="container hero-inner">
        <div class="hero-copy">
          <div class="eyebrow"><span></span> Harvesters Akure</div>
          <h1>There is a place for you here.</h1>
          <p>A Harvesters family is gathering in the city for prayer, worship, friendship, service, and spiritual growth.</p>
          <div class="hero-actions">
            <button class="btn primary xl" data-nav="communities">Join Community ${icon("arrow")}</button>
            <button class="btn ghost xl" data-nav="workforce">Serve</button>
          </div>
        </div>
        <div class="hero-scene-label">
          <span>Sunday Gathering</span>
          <strong>Akure Launch Home</strong>
          <small>Worship • Word • Community</small>
        </div>
        <div class="hero-strip">
          <div><span>Launch City</span><strong>Akure</strong></div>
          <div><span>Sunday Services</span><strong>8:00 AM / 10:00 AM</strong></div>
          <div><span>Prayer</span><strong>6:30 AM Daily</strong></div>
          <div><span>Teams</span><strong>18 Departments</strong></div>
        </div>
      </div>
    </section>
    ${homeIntro()}
    ${aboutSection()}
    ${serviceSection()}
    ${nextSteps()}
    ${visitSection()}
    ${gallerySection()}
    ${cta()}
  `;
}

function visitSection() {
  const items = [
    ["Arrive", "Friendly hosts help you find your seat and the right next step."],
    ["Worship", "A lively room, clear teaching, prayer, and a service built for people."],
    ["Connect", "Meet a community, join a team, or leave your details for follow-up."]
  ];
  return `
    <section class="section visit-section">
      <div class="container split">
        <div>
          <span class="label">Plan Your Visit</span>
          <h2>A Sunday experience that feels warm, clear, and alive.</h2>
          <p>From the first welcome to the final prayer, Harvesters Akure is designed to help people encounter God and find family without confusion.</p>
          <button class="btn secondary" data-nav="contact">Ask a Question ${icon("arrow")}</button>
        </div>
        <div class="visit-list">
          ${items.map(([title, text], index) => `
            <article>
              <span>${String(index + 1).padStart(2, "0")}</span>
              <div><strong>${title}</strong><p>${text}</p></div>
            </article>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function homeIntro() {
  const items = [
    ["Build", "Help prepare the people, systems, and service teams before launch.", "workforce", "Join the Workforce"],
    ["Belong", "Find a community for prayer, friendship, and steady spiritual growth.", "communities", "Join a Community"],
    ["Serve", "Join a department and bring your gifts into the room.", "workforce", "Join the Workforce"]
  ];
  return `
    <section class="home-intro">
      <div class="container intro-grid">
        <div>
          <span class="label">A Real Home Base</span>
          <h2>Take Your Next Step For A City - Wide Launch.</h2>
        </div>
        ${items.map(([title, text, view, cta]) => `
          <article>l
            <strong>${title}</strong>
            <p>${text}</p>
            <a class="intro-link" href="${pathForView(view)}" data-nav="${view}">${cta} ${icon("arrow")}</a>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function aboutSection() {
  return `
    <section class="section" id="about">
      <div class="container split">
        <div>
          <span class="label">About Us</span>
          <h2>Something Powerful is Coming to Akure</h2>
          <div class="divider"></div>
          <p>Harvesters Akure brings the Harvesters experience of worship, prayer, community, growth, purpose, and transformation to the heart of Ondo State.</p>
          <p>The Harvesters dream began on December 13, 2003, through a divine vision given to Pastor Bolaji Idowu. That same vision is reaching Akure with fresh energy and a city-wide invitation.</p>
          <button class="btn secondary" data-nav="about">Learn More ${icon("arrow")}</button>
        </div>
        <div class="image-stack">
          <img src="/pastor_preaching.png" alt="Harvesters ministry moment" />
          <div class="founded"><span>Founded</span><strong>2003</strong><small>Harvesters International</small></div>
        </div>
      </div>
    </section>
  `;
}

function nextSteps() {
  const cards = [
    ["users", "Join a Community", "Find people to do life with, grow with, pray with, and connect with before launch.", "communities", "Explore Communities"],
    ["heart", "Partner With Us", "Support the vision through giving, resources, skills, prayer, or collaboration.", "partnership", "Become a Partner"],
    ["briefcase", "Join the Workforce", "Be part of the launch team helping to build this new campus from the ground up.", "workforce", "Join Launch Team"]
  ];
  return `
    <section class="section soft">
      <div class="container">
        <div class="center">
          <span class="label">Take Your Next Step</span>
          <h2>Be Part of Harvesters Akure From the Beginning</h2>
        </div>
        <div class="card-grid">
          ${cards.map(([ic, title, text, view, ctaText]) => `
            <article class="card">
              <div class="icon-box ${ic === "heart" ? "red" : ""}">${icon(ic)}</div>
              <h3>${title}</h3>
              <p>${text}</p>
              <button class="btn primary block" data-nav="${view}">${ctaText} ${icon("arrow")}</button>
            </article>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function serviceSection() {
  return `
    <section class="section navy">
      <div class="container">
        <div class="center">
          <span class="label red-text">Service Times</span>
          <h2>Join Us When We Launch</h2>
        </div>
        <div class="service-grid">
          <div><strong>Sundays</strong><span>Celebration Service</span><em>10:30 AM and 12:30 PM</em></div>
          <div><strong>Wednesdays</strong><span>Midweek Recharge</span><em>6:00 PM</em></div>
          <div><strong>Daily</strong><span>Next Level Prayers</span><em>6:30 AM online</em></div>
          <div><strong>Saturday Prayer</strong><span>Intense with Pastor Abraham</span><em>9:30 AM</em></div>
        </div>
      </div>
    </section>
  `;
}

function dashboardPreview() {
  return `
    <section class="section">
      <div class="container">
        <div class="split dashboard-tease">
          <div>
            <span class="label">Launch Dashboards</span>
            <h2>Manage the Akure Launch With Clarity</h2>
            <p>Track communities, volunteers, partners, care requests, events, and content from one focused operations dashboard.</p>
            <button class="btn secondary" data-nav="dashboard">Open Dashboard ${icon("arrow")}</button>
          </div>
          <div class="mini-dashboard">
            ${dashboardCards.slice(0, 3).map(([title, value, change]) => `
              <div class="metric"><span>${title}</span><strong>${value}</strong><small>${change}</small></div>
            `).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function gallerySection() {
  return `
    <section class="section soft">
      <div class="container">
        <div class="center">
          <span class="label">Gallery</span>
          <h2>Moments That Carry the Vision</h2>
        </div>
        <div class="gallery">
          <img src="/hero_worship.png" alt="Worship gathering" />
          <img src="/pastor_preaching.png" alt="Teaching moment" />
          <img src="/gallery-globe.png" alt="Harvesters worship congregation" />
          <div class="gallery-card">
            <strong>Akure Launch Gallery</strong>
            <span>Upload worship, outreach, volunteer, and pre-launch photos from the dashboard.</span>
            <button class="btn primary" data-nav="gallery">View Gallery</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function cta() {
  return `
    <section class="cta">
      <img src="/hero_worship.png" alt="" />
      <div></div>
      <article>
        <span class="label red-text">Your Next Step</span>
        <h2>Be Part of Harvesters Akure <strong>From the Beginning</strong></h2>
        <p>Whether you join a community, serve on the team, or partner with the vision, there is a place for you here.</p>
        <div class="hero-actions centered">
          <button class="btn primary xl" data-nav="communities">Join Community ${icon("arrow")}</button>
          <button class="btn ghost xl" data-nav="partnership">Partner With Us</button>
          <button class="btn ghost xl" data-nav="workforce">Join Workforce</button>
        </div>
      </article>
    </section>
  `;
}

function simplePage(kind) {
  const pageData = {
    about: ["About Harvesters Akure", "A new Harvesters community for worship, prayer, community, growth, and transformation in Akure.", aboutSection() + serviceSection()],
    communities: ["Join a Community", "Find a circle for prayer, friendship, accountability, and spiritual growth before launch.", communityPage()],
    nlp: ["Next Level Prayers", "Start your mornings with prayer, clarity, and faith for the city.", nlpPage()],
    giving: ["Giving", "Give toward launch operations, venue readiness, media, outreach, and ministry infrastructure.", givingPage()],
    counselling: ["Counselling", "Book pastoral care, premarital support, family support, or prayer counselling.", formPage("Counselling Request", ["Full name", "Email address", "Phone number", "Care area", "Preferred time"], "counselling")],
    workforce: ["Join the Workforce", "Serve with your gifts and help build the Akure campus from the beginning.", workforcePage()],
    partnership: ["Partnership", "Partner through prayer, finance, media, venue support, logistics, or professional skills.", partnershipPage()],
    attendance: ["Attendance", "Mark attendance with today's daily code.", attendancePage()],
    birthdays: ["Birthday Celebrations", "Share your birthday with the Harvesters Akure family so we can celebrate you.", birthdayPage()],
    gallery: ["Gallery", "A growing archive of launch, worship, outreach, and community moments.", gallerySection() + formPage("Gallery Upload or Content Idea", ["Full name", "Email address", "Subject", "Message"], "content")],
    contact: ["Contact Us", "Reach the Akure launch team and stay updated.", contactPage()],
    profile: memberProfile
      ? ["My Profile", "Your Harvesters Akure details, communities and teams in one place.", profilePage()]
      : ["Member Sign In", "Sign in with your email to see and update your Harvesters Akure details.", profilePage()]
  };
  const [title, subtitle, body] = pageData[kind];
  return `
    <section class="page-hero">
      <div class="container">
        <span class="label">Harvesters Akure</span>
        <h1>${title}</h1>
        <p>${subtitle}</p>
      </div>
    </section>
    ${body}
  `;
}

function communityCard(title, text) {
  return `<article class="card compact ${selectedChoice.community === title ? "selected" : ""}"><h3>${title}</h3><p>${text}</p><button class="btn secondary block" data-choose="community" data-choice="${title}">Register Interest</button></article>`;
}

function communityPage() {
  return `
    <section class="section">
      <div class="container">
        <div class="center"><span class="label">Communities</span><h2>Find People Who Share Your Passion</h2></div>
        <div class="card-grid">${communities.map(([title, text]) => communityCard(title, text)).join("")}</div>
      </div>
    </section>
    ${lockedFormModal("Community Signup", ["Full name", "Phone number", "Email address", "Preferred community", "Area in Akure", "Date of Birth", "Would you like to lead?"], "community", "Preferred community")}
  `;
}

function nlpPage() {
  return `
    <section class="section">
      <div class="container split">
        <div>
          <span class="label">Prayer Movement</span>
          <h2>Next Level Prayers for Akure</h2>
          <p>Join daily prayer online as we prepare hearts, families, volunteers, and the city for what God is building.</p>
          <div class="hero-actions prayer-actions">
            ${externalLinkButton("Daily Prayer", externalLinks.dailyPrayer, "primary")}
            ${externalLinkButton("Weekly Prayer", externalLinks.weeklyPrayerWhatsapp, "secondary")}
          </div>
        </div>
        <div class="schedule">
          <div><strong>6:30 AM</strong><span>Daily Prayer Call</span></div>
          <div><strong>Weekly</strong><span>WhatsApp Prayer Community</span></div>
          <div><strong>Monthly</strong><span>City Prayer Walk</span></div>
        </div>
      </div>
    </section>
    ${formPage("NLP Prayer Updates", ["Full name", "Phone number", "Email address", "Prayer focus"], "nlp")}
  `;
}

function givingPage() {
  return `
    <section class="section">
      <div class="container card-grid">
        ${["Campus Launch", "Venue Readiness", "Media and Production", "Community Outreach", "Children and Teens", "Transport and Logistics"].map(item => `
          <article class="card compact"><h3>${item}</h3><p>Support ${item.toLowerCase()} for the Harvesters Akure launch.</p>${externalLinkButton("Give Now", externalLinks.giving, "primary block")}</article>
        `).join("")}
      </div>
    </section>
    ${formPage("Giving Pledge", ["Full name", "Phone number", "Email address", "Fund", "Amount"], "giving")}
  `;
}

function workforcePage() {
  return `
    <section class="section soft">
      <div class="container">
        <div class="center"><span class="label">Departments</span><h2>Serve With Your Gifts</h2></div>
        <div class="pill-grid">${departments.map(item => `<button class="${selectedChoice.workforce === item ? "active" : ""}" data-choose="workforce" data-choice="${item}">${item}</button>`).join("")}</div>
      </div>
    </section>
    ${lockedFormModal("Workforce Application", ["Full name", "Phone number", "Email address", "Department", "Relevant experience", "Would you like to lead?"], "workforce", "Department")}
  `;
}

// Nothing is rendered until a community/department has been picked; then the
// form opens in a pop-up with that pick filled into `lockedField`, read-only.
function lockedFormModal(title, fields, type, lockedField) {
  const choice = selectedChoice[type];
  if (!choice) return "";
  return `
    <div class="form-modal" data-close-choice>
      <div class="form-modal-panel" role="dialog" aria-modal="true" aria-label="${title}">
        <button class="form-modal-close" type="button" data-close-choice aria-label="Close">&times;</button>
        ${formMarkup(title, fields, type, { [lockedField]: choice })}
      </div>
    </div>
  `;
}

function partnershipPage() {
  return `
    <section class="section">
      <div class="container card-grid">
        ${["Prayer Partner", "Financial Partner", "Venue Partner", "Media Partner", "Logistics Partner", "Professional Services"].map(item => `
          <article class="card compact"><h3>${item}</h3><p>Stand with the Akure launch as a ${item.toLowerCase()}.</p><button class="btn secondary block" data-focus-form>Start Partnership</button></article>
        `).join("")}
      </div>
    </section>
    ${formPage("Partnership Interest", ["Full name", "Phone number", "Email address", "Partnership type", "Message"], "partnership")}
  `;
}

function attendancePage() {
  return `
    <section class="section">
      <div class="container split">
        <div>
          <span class="label">Daily Code</span>
          <h2>Mark Attendance With Today's Code</h2>
          <p>The team can announce one code for the day. People do not need to have registered on the website first; attendance is saved from the daily code plus their basic details.</p>
          <div class="daily-code" data-daily-code>
            <span>Today's code</span>
            <strong>Loading...</strong>
          </div>
          <div class="attendance-steps">
            <div><strong>1</strong><span>Announce today's code during service</span></div>
            <div><strong>2</strong><span>Collect name and phone with the code</span></div>
            <div><strong>3</strong><span>Attendance appears in the dashboard</span></div>
          </div>
        </div>
        <form class="form attendance-form" data-attendance-form>
          <h3>Daily Attendance</h3>
          <label><span>Today's code</span><input name="attendanceCode" placeholder="Example: HA0123" autocomplete="off" required /></label>
          <label><span>Full name</span><input name="name" placeholder="Attendee name" required /></label>
          <label><span>Phone number</span><input name="phone" type="tel" placeholder="Phone number" required /></label>
          <label><span>Department or group</span><input name="department" placeholder="Your department or group" required /></label>
          <label><span>Service</span><input name="service" value="Sunday Service" required /></label>
          <label><span>Note</span><input name="note" data-tall placeholder="Note" required /></label>
          <button class="btn primary block" type="submit">Save Attendance ${icon("arrow")}</button>
          <p class="form-note">Use the daily code shown on this page or in the dashboard.</p>
        </form>
      </div>
    </section>
  `;
}

function birthdayPage() {
  return `
    <section class="section">
      <div class="container split">
        <div>
          <span class="label">Celebrate With Us</span>
          <h2>We Love To Celebrate Our Family</h2>
          <p>Send your name, phone number, birthday, and a clear photo of yourself. When your day comes, the Harvesters Akure family will celebrate and pray with you.</p>
          <div class="attendance-steps">
            <div><strong>1</strong><span>Fill in your details and add a photo</span></div>
            <div><strong>2</strong><span>The team keeps it safe for your special day</span></div>
            <div><strong>3</strong><span>We celebrate you on your birthday</span></div>
          </div>
          <p class="muted">Already sent your details? Send them again with the same name and phone number at any time to update your photo or birthday.</p>
        </div>
        <form class="form" data-birthday-form novalidate>
          <h3>Birthday Details</h3>
          <label><span>Full name</span><input name="fullName" placeholder="Full name" autocomplete="name" required /></label>
          <label><span>Phone number</span><input name="phoneNumber" type="tel" placeholder="Phone number" autocomplete="tel" required /></label>
          <label><span>Email address</span><input name="emailAddress" type="email" placeholder="Email address" autocomplete="email" required value="${escapeHtml(memberProfile?.email || "")}" /></label>
          <label><span>Date of birth</span><input name="dateOfBirth" type="date" min="1900-01-01" max="${localDateKey(new Date())}" required /></label>
          ${photoPicker("birthday", "Your photo")}
          <label class="consent"><input name="photoConsent" type="checkbox" /> <span>I'm happy for Harvesters Akure to share this photo and my name when celebrating my birthday.</span></label>
          <button class="btn primary block" type="submit">Send My Birthday ${icon("arrow")}</button>
          <p class="form-note">Your phone number stays private to the team.</p>
        </form>
      </div>
    </section>
  `;
}

function profilePage() {
  if (memberProfile === undefined) {
    return `<section class="section"><div class="container narrow"><div class="form"><h3>Loading your profile...</h3></div></div></section>`;
  }
  return memberProfile ? memberProfileView() : memberSignIn();
}

function memberNoteMarkup() {
  return `<p class="form-note ${memberNoteType}">${escapeHtml(memberNote)}</p>`;
}

function memberSignIn() {
  const form = memberStep === "code"
    ? `
      <form class="form" data-member-code-form>
        <h3>Enter Your Code</h3>
        <p class="muted">We sent a 6-digit code to <strong>${escapeHtml(memberEmail)}</strong>. Check your spam folder if it hasn't arrived in a minute or two.</p>
        <label><span>6-digit code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required /></label>
        <button class="btn primary block" type="submit" ${memberBusy ? "disabled" : ""}>${memberBusy ? "Checking..." : "Sign In"} ${icon("arrow")}</button>
        <div class="inline-actions">
          <button class="btn ghost-dark" type="button" data-member-resend ${memberBusy ? "disabled" : ""}>Send a new code</button>
          <button class="btn ghost-dark" type="button" data-member-change-email>Use a different email</button>
        </div>
        ${memberNoteMarkup()}
      </form>
    `
    : `
      <form class="form" data-member-email-form>
        <h3>Sign In</h3>
        <p class="muted">Enter the email address you used on any Harvesters Akure form. We'll email you a 6-digit code &mdash; no password needed.</p>
        <label><span>Email address</span><input name="email" type="email" autocomplete="email" placeholder="you@example.com" value="${escapeHtml(memberEmail)}" required /></label>
        <button class="btn primary block" type="submit" ${memberBusy ? "disabled" : ""}>${memberBusy ? "Sending..." : "Email Me a Code"} ${icon("arrow")}</button>
        ${memberNoteMarkup()}
      </form>
    `;
  return `
    <section class="section">
      <div class="container split">
        <div>
          <span class="label">Members</span>
          <h2>Everything About You, In One Place</h2>
          <p>See your communities, the teams you serve on, and your birthday &mdash; and keep your name, phone number, and photo up to date.</p>
          <div class="attendance-steps">
            <div><strong>1</strong><span>Enter the email you used on our forms</span></div>
            <div><strong>2</strong><span>Type in the code we email you</span></div>
            <div><strong>3</strong><span>View and update your profile</span></div>
          </div>
          <p class="muted">New here? <a href="/communities" data-nav="communities">Join a community</a> or <a href="/birthdays" data-nav="birthdays">send your birthday</a> with your email address first, then come back to sign in.</p>
        </div>
        ${form}
      </div>
    </section>
  `;
}

function formatDate(value) {
  if (!value) return "-";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function initials(name) {
  return escapeHtml(String(name || "?").trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?");
}

function profileCard(title, iconName, body) {
  return `<article class="profile-section"><h3>${icon(iconName)} ${title}</h3>${body}</article>`;
}

function memberProfileView() {
  const profile = memberProfile;
  const list = (items, render) => `<ul class="profile-list">${items.map(item => `<li>${render(item)}</li>`).join("")}</ul>`;
  const empty = (text, view, cta) => `<p class="muted">${text}</p><button class="btn secondary" data-nav="${view}">${cta} ${icon("arrow")}</button>`;
  const editor = `
    <form class="form profile-editor" data-member-profile-form>
      <h3>Edit Profile</h3>
      <label><span>Full name</span><input name="fullName" value="${escapeHtml(profile.name)}" autocomplete="name" required /></label>
      <label><span>Phone number</span><input name="phoneNumber" type="tel" value="${escapeHtml(profile.phone)}" autocomplete="tel" placeholder="Phone number" /></label>
      <label><span>Email address</span><input value="${escapeHtml(profile.email)}" readonly /></label>
      ${photoPicker("member", "Profile photo", profile.photoUrl)}
      <div class="inline-actions">
        <button class="btn primary" type="submit">Save Changes</button>
        <button class="btn ghost-dark" type="button" data-member-cancel-edit>Cancel</button>
      </div>
      ${memberNoteMarkup()}
    </form>
  `;
  return `
    <section class="section">
      <div class="container profile-layout">
        <article class="profile-head">
          <div class="profile-photo">${profile.photoUrl ? `<img src="${escapeHtml(profile.photoUrl)}" alt="${escapeHtml(profile.name)}" />` : `<span>${initials(profile.name)}</span>`}</div>
          <div class="profile-identity">
            <h2>${escapeHtml(profile.name || "Welcome")}</h2>
            <p>${icon("mail")} ${escapeHtml(profile.email)}</p>
            ${profile.phone ? `<p>${icon("phone")} ${escapeHtml(profile.phone)}</p>` : ""}
            ${profile.memberSince ? `<small>With us since ${formatDate(profile.memberSince)}</small>` : ""}
          </div>
          <div class="profile-actions">
            ${memberEditing ? "" : `<button class="btn primary" type="button" data-member-edit>Edit Profile</button>`}
            <button class="btn ghost-dark" type="button" data-member-logout>Sign Out</button>
          </div>
        </article>
        ${memberEditing ? editor : memberNote ? memberNoteMarkup() : ""}
        <div class="profile-grid">
          ${profileCard("Communities", "users", profile.communities.length
            ? list(profile.communities, item => `<strong>${escapeHtml(item.name || "Community")}</strong><small>Joined ${formatDate(item.date)}</small>`)
            : empty("You haven't joined a community yet.", "communities", "Join a Community"))}
          ${profileCard("Workforce", "briefcase", profile.departments.length
            ? list(profile.departments, item => `<strong>${escapeHtml(item.name || "Department")}</strong><small>Applied ${formatDate(item.date)}</small>`)
            : empty("You're not serving on a team yet.", "workforce", "Join the Workforce"))}
          ${profileCard("Birthdays", "cake", profile.birthdays.length
            ? list(profile.birthdays, item => `<span class="profile-person">${item.photoUrl ? `<img src="${escapeHtml(item.photoUrl)}" alt="" />` : ""}<span><strong>${escapeHtml(item.name)}</strong><small>${birthdayLabel(item.dateOfBirth)}</small></span></span>`) + `<button class="btn outline small" data-nav="birthdays">Add or update a birthday</button>`
            : empty("We don't have your birthday yet. Add it with this email address so we can celebrate you.", "birthdays", "Add My Birthday"))}
          ${profile.activity.length ? profileCard("Other Activity", "heart", list(profile.activity, item => `<strong>${escapeHtml(item.label)}</strong><small>${item.detail ? `${escapeHtml(item.detail)} &middot; ` : ""}${formatDate(item.date)}</small>`)) : ""}
        </div>
      </div>
    </section>
  `;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function birthdayLabel(dateOfBirth) {
  const [, month, day] = String(dateOfBirth || "").split("-").map(Number);
  return month && day ? `${day} ${MONTHS[month - 1]}` : "-";
}

// Days from today until the next birthday (0 = today) and the age being
// turned. 29 February birthdays are celebrated on 28 February in non-leap
// years rather than rolling over to 1 March.
function nextBirthday(dateOfBirth, today = new Date()) {
  const [year, month, day] = String(dateOfBirth || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const occurrence = targetYear => {
    const isLeap = new Date(targetYear, 1, 29).getMonth() === 1;
    return new Date(targetYear, month - 1, month === 2 && day === 29 && !isLeap ? 28 : day);
  };
  let next = occurrence(start.getFullYear());
  if (next < start) next = occurrence(start.getFullYear() + 1);
  return { days: Math.round((next - start) / 86_400_000), age: next.getFullYear() - year, date: next };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, chr => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[chr]);
}

// Phone cameras produce 3-12MB photos; shrinking to at most 1200px JPEG in
// the browser keeps uploads quick on mobile data and well under the server's
// size limit. Drawing through an <img> also applies the photo's EXIF
// rotation, so sideways phone pictures come out upright.
function preparePhoto(file) {
  return new Promise((resolvePhoto, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolvePhoto(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This photo could not be opened. Please choose a JPEG or PNG picture."));
    };
    image.src = url;
  });
}

function contactPage() {
  return `
    <section class="section">
      <div class="container split">
        <div class="contact-list">
          <div>${icon("map")}<span>Akure, Ondo State, Nigeria</span></div>
          <a href="${contactInfo.phoneHref}">${icon("phone")}<span>${contactInfo.phone}</span></a>
          <div>${icon("mail")}<span>akure@harvestersng.org</span></div>
          ${socialLinks.map(social => `<a href="${social.url}" target="_blank" rel="noopener noreferrer">${icon(social.name.toLowerCase())}<span>${social.name} <strong>${social.handle}</strong></span></a>`).join("")}
        </div>
        ${formMarkup("Send a Message", ["Full name", "Email address", "Subject", "Message"], "contact")}
      </div>
    </section>
  `;
}

function formPage(title, fields, type) {
  return `<section class="section" id="form"><div class="container narrow">${formMarkup(title, fields, type)}</div></section>`;
}

function formMarkup(title, fields, type, locked = {}) {
  return `
    <form class="form" data-api-form data-form-type="${type}">
      <h3>${title}</h3>
      ${fields.map(field => field in locked ? lockedField(field, locked[field]) : formField(field, type)).join("")}
      ${["community", "counselling"].includes(type) ? `<label class="consent"><input name="communicationsConsent" type="checkbox" /> <span>I agree to receive Harvesters Akure updates by SMS and email.</span></label>` : ""}
      <button class="btn primary block" type="submit">Submit ${icon("arrow")}</button>
      <p class="form-note">Submissions save to the local database and appear in the dashboard.</p>
    </form>
  `;
}

function formField(field, type) {
  const name = fieldName(field);
  const dateOfBirth = field === "Date of Birth";
  const email = field === "Email address";
  const leadershipInterest = field === "Would you like to lead?";
  const phone = field === "Phone number";
  const amount = field === "Amount";
  const tall = field === "Message" || field === "Relevant experience";
  // Every field on every public form is required (the server checks too).
  if (leadershipInterest) {
    return `<label><span>${field}</span><select name="${name}" required><option value="">Select an option</option><option value="Yes">Yes</option><option value="No">No</option></select></label>`;
  }
  return `<label><span>${field}</span><input name="${name}" type="${dateOfBirth ? "date" : email ? "email" : phone ? "tel" : "text"}" ${amount ? 'inputmode="numeric"' : ""} ${tall ? "data-tall" : ""} required placeholder="${dateOfBirth ? "" : field}" /></label>`;
}

function lockedField(field, value) {
  return `<label><span>${field}</span><div class="locked-field"><input name="${fieldName(field)}" value="${value}" readonly /><button class="btn ghost-dark" type="button" data-close-choice>Change</button></div></label>`;
}

function externalLinkButton(label, url, classes = "primary") {
  if (!url) return `<button class="btn ${classes}" type="button" disabled title="This link has not been configured yet.">${label}</button>`;
  return `<a class="btn ${classes}" href="${url}" target="_blank" rel="noopener noreferrer">${label} ${icon("arrow")}</a>`;
}

function adminArea() {
  if (adminSession === undefined) return `<section class="dashboard-shell single"><div class="panel"><h3>Checking session...</h3></div></section>`;
  if (!adminSession) return loginView();
  return dashboard();
}

function loginView() {
  return `
    <section class="login-shell">
      <div class="login-card">
        <img src="/logo-black.png" alt="Harvesters Akure" />
        <h1>Team Sign In</h1>
        <p>Sign in with your admin account to open the launch dashboard.</p>
        <form data-login-form>
          <label><span>Email</span><input name="email" type="email" required autocomplete="username" /></label>
          <label><span>Password</span><input name="password" type="password" required autocomplete="current-password" /></label>
          ${loginError ? `<p class="form-note error">${loginError}</p>` : ""}
          <button class="btn primary block" type="submit" ${loginSubmitting ? "disabled" : ""}>${loginSubmitting ? "Signing in..." : "Sign In"}</button>
        </form>
      </div>
    </section>
  `;
}

function passwordNudge() {
  return `
    <div class="panel warn">
      <h3>Set a permanent password</h3>
      <p class="muted">Your account was created with a temporary password. Update it below to keep this account secure.</p>
      <form class="form inline-form" data-change-password-form>
        <label><span>Current password</span><input name="currentPassword" type="password" required /></label>
        <label><span>New password</span><input name="newPassword" type="password" minlength="8" required /></label>
        <button class="btn primary" type="submit">Update Password</button>
      </form>
    </div>
  `;
}

function dashboard() {
  // Cell leaders have no view_dashboard permission: they only get the two
  // cell tabs, scoped by the server to their own cells.
  const full = can("view_dashboard");
  const cellTabs = full || adminSession.role === "cell_leader";
  const tabs = [
    ["overview", "Overview", full],
    ["members", "Members", full],
    ["communities", "Communities", full],
    ["cell-attendance", "Cell Attendance", cellTabs],
    ["cell-reports", "Cell Reports", cellTabs],
    ["workforce", "Workforce", full],
    ["attendance", "Attendance", full],
    ["birthdays", "Birthdays", full],
    ["giving", "Giving", full],
    ["care", "Care", full],
    ["newsletter", "Newsletter", full],
    ["content", "Content", full],
    ["broadcast", "Broadcast", can("send_broadcasts")],
    ["admins", "Admins", can("manage_admins")]
  ].filter(([, , visible]) => visible);
  if (!tabs.some(([id]) => id === activeDashboard)) activeDashboard = tabs[0]?.[0] || "overview";
  return `
    <section class="dashboard-shell">
      <aside>
        <img src="/logo-white.png" alt="Harvesters Akure" />
        <span>Launch Command</span>
        ${tabs.map(([id, label]) => `<button class="${activeDashboard === id ? "active" : ""}" data-dash="${id}">${label}</button>`).join("")}
        <div class="admin-identity">
          <strong>${adminSession.name}</strong>
          <small>${ROLE_LABELS[adminSession.role] || adminSession.role}</small>
          <button class="btn ghost small" data-logout type="button">Sign Out</button>
        </div>
      </aside>
      <section class="dashboard-main">
        <header>
          <div>
            <span class="label">Dashboard</span>
            <h1>${tabs.find(([id]) => id === activeDashboard)?.[1] || "Overview"}</h1>
          </div>
          ${can("export_data") && !activeDashboard.startsWith("cell-") ? `<button class="btn primary" data-export>${activeDashboard === "communities" ? "Export Communities CSV" : activeDashboard === "workforce" ? "Export Workforce CSV" : activeDashboard === "birthdays" ? "Export Birthdays CSV" : "Export CSV"}</button>` : ""}
        </header>
        ${adminSession.mustChangePassword ? passwordNudge() : ""}
        ${dashboardContent()}
      </section>
    </section>
  `;
}

function dashboardContent() {
  if (activeDashboard === "cell-attendance") return cellAttendanceTab();
  if (activeDashboard === "cell-reports") return cellReportsTab();
  if (activeDashboard === "broadcast") return broadcastTab();
  if (activeDashboard === "admins") return adminsTab();
  if (!dashboardData) {
    return `<div class="panel"><h3>Loading live dashboard...</h3><p class="muted">Reading submissions from the local database.</p></div>`;
  }
  if (dashboardData.error) {
    return `<div class="panel"><h3>Dashboard API unavailable</h3><p class="muted">${dashboardData.error}. Start the API with npm run api or run the production server with npm start.</p></div>`;
  }
  const { metrics, submissions, recent, launchItems } = dashboardData;
  if (activeDashboard === "overview") {
    const liveCards = [
      ["Community Signups", metrics.community, "live database", "People who have registered interest in a Harvesters Akure community."],
      ["Workforce Leads", metrics.workforce, "live database", "Launch team applicants by department and readiness."],
      ["Giving Pledges", money(metrics.giving), `${metrics.fundsPercent}% target`, "Giving pledges recorded through the giving form."],
      ["Attendance", metrics.attendance, "daily-code check-ins", `Today's attendance code: ${dashboardData.dailyAttendance?.code || "-"}.`]
    ];
    return `
      <div class="metric-grid">${liveCards.map(([title, value, change, text]) => `<article class="metric large"><span>${title}</span><strong>${value}</strong><small>${change}</small><p>${text}</p></article>`).join("")}</div>
      <div class="dashboard-grid">
        <article class="panel"><h3>Workforce Pipeline</h3>${pipeline.map(([label, value]) => `<div class="bar"><span>${label}</span><div><i style="width:${value}%"></i></div><b>${value}</b></div>`).join("")}</article>
        <article class="panel"><h3>Launch Readiness</h3><div class="ring" style="background: conic-gradient(var(--red) 0 ${metrics.readiness}%, var(--soft) ${metrics.readiness}% 100%)"><strong>${metrics.readiness}%</strong><span>overall readiness</span></div></article>
      </div>
      <div class="table section-table">${table(["Type", "Code", "Name", "Phone", "Email", "Created"], recent.map(row => [row.type, recordCode(row), row.fields.fullName || row.fields.name || "-", row.fields.phoneNumber || row.fields.phone || "-", row.fields.emailAddress || row.fields.email || "-", new Date(row.createdAt).toLocaleString()]))}</div>
    `;
  }
  if (activeDashboard === "communities") {
    const records = sortByFields(submissions.filter(row => row.type === "community"), [
      row => row.fields.preferredCommunity,
      row => row.fields.fullName
    ]);
    const rows = records.map(row => [recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || "-", row.fields.emailAddress || "-", row.fields.preferredCommunity || "-", row.fields.areaInAkure || "-", row.fields.wouldYouLikeToLead || "-", new Date(row.createdAt).toLocaleDateString()]);
    return `${editableTable(["Code", "Name", "Phone", "Email", "Community", "Area", "Wants to Lead", "Date"], rows, records)}`;
  }
  if (activeDashboard === "workforce") {
    const records = sortByFields(submissions.filter(row => row.type === "workforce"), [
      row => row.fields.department,
      row => row.fields.fullName
    ]);
    const rows = records.map(row => [recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || "-", row.fields.emailAddress || "-", row.fields.department || "-", row.fields.relevantExperience || "-", row.fields.wouldYouLikeToLead || "-", row.status]);
    return `${editableTable(["Code", "Name", "Phone", "Email", "Department", "Experience", "Wants to Lead", "Status"], rows, records)}`;
  }
  if (activeDashboard === "attendance") {
    const records = submissions.filter(row => row.type === "attendance");
    const rows = records.map(row => [row.fields.name || "-", row.fields.attendanceCode || row.fields.shortCode || "-", row.fields.phone || "-", row.fields.department || "-", row.fields.service || "-", new Date(row.createdAt).toLocaleString()]);
    return `<div class="metric-grid"><article class="metric large"><span>Today's Code</span><strong>${dashboardData.dailyAttendance?.code || "-"}</strong><small>${dashboardData.dailyAttendance?.date || ""}</small></article><article class="metric large"><span>Total Check-Ins</span><strong>${metrics.attendance}</strong><small>attendance records</small></article></div>${editableTable(["Name", "Code", "Phone", "Department", "Service", "Time"], rows, records)}`;
  }
  if (activeDashboard === "birthdays") return birthdaysTab(submissions);
  if (activeDashboard === "members") return membersTab(submissions);
  if (activeDashboard === "giving") {
    const records = submissions.filter(row => ["giving", "partnership"].includes(row.type));
    const rows = records.map(row => [row.type, recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || "-", row.fields.fund || row.fields.partnershipType || "-", row.fields.amount ? money(row.fields.amount) : "-", new Date(row.createdAt).toLocaleDateString()]);
    return `<div class="metric-grid"><article class="metric large"><span>Total Giving</span><strong>${money(metrics.giving)}</strong><small>${metrics.fundsPercent}% funded</small></article><article class="metric large"><span>Partners</span><strong>${metrics.partnership}</strong><small>active interest</small></article></div>${editableTable(["Type", "Code", "Name", "Phone", "Category", "Amount", "Date"], rows, records)}`;
  }
  if (activeDashboard === "care") {
    const records = submissions.filter(row => ["counselling", "nlp", "contact"].includes(row.type));
    const rows = records.map(row => [row.type, recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || row.fields.emailAddress || "-", row.fields.careArea || row.fields.prayerFocus || row.fields.subject || "-", row.status]);
    return `${editableTable(["Type", "Code", "Name", "Contact", "Category", "Status"], rows, records)}`;
  }
  if (activeDashboard === "newsletter") {
    const records = submissions.filter(row => row.type === "newsletter");
    const rows = records.map(row => [recordCode(row), row.fields.emailAddress || row.fields.email || "-", new Date(row.createdAt).toLocaleString()]);
    return `<div class="metric-grid"><article class="metric large"><span>Newsletter Signups</span><strong>${metrics.newsletter}</strong><small>footer email opt-ins</small></article></div>${editableTable(["Code", "Email", "Date"], rows, records)}`;
  }
  const canManageContent = can("manage_content");
  const launchHeaders = ["Item", "Type", "Status", "Due", ...(canManageContent ? ["Actions"] : [])];
  const launchRows = launchItems.length
    ? launchItems.map(item => {
        const cells = [item.item, item.type, item.status, item.due];
        const actionsCell = canManageContent
          ? `<td class="actions-cell"><button class="btn outline small" type="button" data-edit-launch-item="${item.id}">Edit</button><button class="btn danger small" type="button" data-delete-launch-item="${item.id}">Delete</button></td>`
          : "";
        return `<tr>${cells.map(cell => `<td>${cell}</td>`).join("")}${actionsCell}</tr>`;
      }).join("")
    : `<tr><td colspan="${launchHeaders.length}">No launch items yet.</td></tr>`;
  const editingItem = editingLaunchItemId ? launchItems.find(item => item.id === editingLaunchItemId) : null;
  const rows = submissions.filter(row => row.type === "content").map(row => [row.fields.fullName || "-", row.fields.subject || "Content idea", row.fields.message || "-", new Date(row.createdAt).toLocaleDateString()]);
  return `
    <div class="table"><table><thead><tr>${launchHeaders.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${launchRows}</tbody></table></div>
    ${canManageContent ? launchItemForm(editingItem) : ""}
    <div class="table section-table">${table(["Name", "Title", "Note", "Date"], rows)}</div>
  `;
}

const SUBMISSION_LABELS = {
  community: "Community", workforce: "Workforce", birthday: "Birthday", attendance: "Attendance", member: "Profile",
  counselling: "Care request", partnership: "Partnership", giving: "Giving", nlp: "Prayer updates",
  contact: "Message", content: "Content idea", newsletter: "Newsletter"
};
const CONTACT_FIELDS = ["fullName", "name", "phoneNumber", "phone", "emailAddress", "email", "photoPath", "photoType", "photoConsent", "communicationsConsent", "lastSignInAt"];

function adminPhotoUrl(record) {
  return `/api/admin/birthday-photo/${encodeURIComponent(record.id)}?v=${Date.parse(record.updatedAt || record.createdAt)}`;
}

// One entry per person. Records are joined when they share a phone number
// (last 10 digits) or an email address, transitively -- so someone who gave
// phone + email on the community form and only their phone on the birthday
// form still comes out as one person. This is for the team only; members
// themselves only ever see records under their own verified email.
function memberDirectory(submissions) {
  const parent = new Map();
  const find = key => {
    while (parent.get(key) !== key) key = parent.get(key);
    return key;
  };
  const keysOf = row => {
    const phone = String(row.fields.phoneNumber || row.fields.phone || "").replace(/\D/g, "");
    const email = String(row.fields.emailAddress || row.fields.email || "").trim().toLowerCase();
    return [phone.length >= 10 ? `p:${phone.slice(-10)}` : "", email ? `e:${email}` : ""].filter(Boolean);
  };
  const entries = submissions.map(row => ({ row, keys: keysOf(row) })).filter(entry => entry.keys.length);
  entries.forEach(({ keys }) => keys.forEach(key => parent.has(key) || parent.set(key, key)));
  entries.forEach(({ keys }) => keys.slice(1).forEach(key => parent.set(find(key), find(keys[0]))));
  const groups = new Map();
  entries.forEach(({ row, keys }) => {
    const root = find(keys[0]);
    groups.set(root, [...(groups.get(root) || []), row]);
  });
  return [...groups.values()].map(summarizeMember).sort((a, b) => b.lastActive - a.lastActive);
}

function summarizeMember(records) {
  const sorted = [...records].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const member = sorted.find(row => row.type === "member");
  const latest = getter => [...sorted].reverse().map(row => getter(row.fields)).find(Boolean) || "";
  const name = member?.fields.fullName || latest(fields => fields.fullName || fields.name);
  const birthdays = sorted.filter(row => row.type === "birthday");
  const photoRecord = (member?.fields.photoPath && member)
    || birthdays.find(row => row.fields.photoPath && String(row.fields.fullName).toLowerCase() === String(name).toLowerCase())
    || birthdays.find(row => row.fields.photoPath);
  return {
    // The oldest record's id: stable across reloads, unlike the grouping keys.
    key: sorted[0].id,
    records: sorted,
    name,
    phone: member?.fields.phoneNumber || latest(fields => fields.phoneNumber || fields.phone),
    email: latest(fields => fields.emailAddress || fields.email),
    photoUrl: photoRecord ? adminPhotoUrl(photoRecord) : "",
    communities: [...new Set(sorted.filter(row => row.type === "community").map(row => row.fields.preferredCommunity).filter(Boolean))],
    departments: [...new Set(sorted.filter(row => row.type === "workforce").map(row => row.fields.department).filter(Boolean))],
    birthday: (birthdays.find(row => String(row.fields.fullName).toLowerCase() === String(name).toLowerCase()) || birthdays[0])?.fields.dateOfBirth || latest(fields => fields.dateOfBirth),
    attendance: sorted.filter(row => row.type === "attendance").length,
    signedInAt: member?.fields.lastSignInAt || "",
    lastActive: Math.max(...sorted.map(row => Date.parse(row.updatedAt || row.createdAt) || 0))
  };
}

function memberAvatar(person, size = "") {
  return person.photoUrl
    ? `<img class="member-avatar ${size}" src="${person.photoUrl}" alt="" loading="lazy" />`
    : `<span class="member-avatar ${size}">${initials(person.name)}</span>`;
}

function memberTags(person) {
  return [
    ...person.communities.map(name => `<span class="tag">${escapeHtml(name)}</span>`),
    ...person.departments.map(name => `<span class="tag blue">${escapeHtml(name)}</span>`),
    person.birthday ? `<span class="tag soft">${icon("cake")} ${birthdayLabel(person.birthday)}</span>` : "",
    person.attendance ? `<span class="tag soft">${person.attendance} check-in${person.attendance === 1 ? "" : "s"}</span>` : ""
  ].join("");
}

function recordDetails(row) {
  return Object.entries(row.fields)
    .filter(([key, value]) => value && !CONTACT_FIELDS.includes(key))
    .map(([key, value]) => `<span><b>${escapeHtml(key.replace(/([A-Z])/g, " $1").toLowerCase())}:</b> ${escapeHtml(value)}</span>`)
    .join("") || "-";
}

function membersTab(submissions) {
  const people = memberDirectory(submissions);
  const person = selectedMemberKey && people.find(item => item.key === selectedMemberKey);
  const canEdit = can("edit_submissions");
  const canDelete = can("delete_submissions");
  const recordActions = row => `
    ${canEdit && row.type !== "cell_report" ? `<button class="btn primary small" type="button" data-edit-submission="${row.id}">Edit</button>` : ""}
    ${canDelete ? `<button class="btn danger small" type="button" data-delete-submission="${row.id}">Delete</button>` : ""}
  `;
  if (person) {
    return `
      <div class="inline-actions">
        <button class="btn ghost-dark" type="button" data-member-back>&larr; All members</button>
        ${canDelete ? `<button class="btn danger" type="button" data-delete-member="${person.key}">Delete Member</button>` : ""}
      </div>
      <div class="panel member-detail">
        ${memberAvatar(person, "large")}
        <div>
          <h3>${escapeHtml(person.name || "Unnamed")}</h3>
          <p class="muted">${[person.phone, person.email].filter(Boolean).map(escapeHtml).join(" &middot; ") || "No contact details"}</p>
          <div class="tag-row">${memberTags(person)}</div>
          <small class="muted">${person.signedInAt ? `Last signed in to My Profile ${new Date(person.signedInAt).toLocaleString()}` : "Has not signed in to My Profile"}</small>
        </div>
      </div>
      <div class="table section-table">${table(["Type", "Code", "Name", "Details", "Date", ...(canEdit || canDelete ? ["Actions"] : [])], person.records.map(row => [
        SUBMISSION_LABELS[row.type] || escapeHtml(row.type),
        recordCode(row),
        escapeHtml(row.fields.fullName || row.fields.name || "-"),
        `<div class="record-details">${recordDetails(row)}</div>`,
        new Date(row.createdAt).toLocaleDateString(),
        ...(canEdit || canDelete ? [`<div class="actions-cell">${recordActions(row)}</div>`] : [])
      ]))}</div>
    `;
  }
  selectedMemberKey = "";
  const rows = people.map(item => `
    <tr data-member-row="${escapeHtml([item.name, item.phone, item.email, ...item.communities, ...item.departments].join(" ").toLowerCase())}">
      <td>${memberAvatar(item)}</td>
      <td><strong>${escapeHtml(item.name || "Unnamed")}</strong></td>
      <td>${escapeHtml(item.phone || "-")}</td>
      <td>${escapeHtml(item.email || "-")}</td>
      <td><div class="tag-row">${memberTags(item) || "-"}</div></td>
      <td>${new Date(item.lastActive).toLocaleDateString()}</td>
      <td class="actions-cell">
        <button class="btn outline small" type="button" data-view-member="${item.key}">View</button>
        ${canEdit && primaryRecord(item).type !== "cell_report" ? `<button class="btn primary small" type="button" data-edit-submission="${primaryRecord(item).id}">Edit</button>` : ""}
        ${canDelete ? `<button class="btn danger small" type="button" data-delete-member="${item.key}">Delete</button>` : ""}
      </td>
    </tr>
  `).join("");
  return `
    <div class="metric-grid">
      <article class="metric large"><span>People</span><strong>${people.length}</strong><small>grouped by phone and email</small></article>
      <article class="metric large"><span>Signed In</span><strong>${people.filter(item => item.signedInAt).length}</strong><small>used My Profile</small></article>
      <article class="metric large"><span>In a Community</span><strong>${people.filter(item => item.communities.length).length}</strong><small>joined at least one</small></article>
      <article class="metric large"><span>Serving</span><strong>${people.filter(item => item.departments.length).length}</strong><small>workforce applicants</small></article>
    </div>
    <div class="panel member-search"><input type="search" placeholder="Search by name, phone, email, community, or department" data-member-search /></div>
    <div class="table"><table><thead><tr><th>Photo</th><th>Name</th><th>Phone</th><th>Email</th><th>Involvement</th><th>Last Active</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7">No members yet.</td></tr>`}</tbody></table></div>
  `;
}

// Sorted by how soon each birthday comes round, so the people to celebrate
// next are always at the top.
function birthdaysTab(submissions) {
  const today = new Date();
  const records = submissions
    .filter(row => row.type === "birthday")
    .map(row => ({ row, next: nextBirthday(row.fields.dateOfBirth, today) }))
    .sort((a, b) => (a.next?.days ?? 999) - (b.next?.days ?? 999) || String(a.row.fields.fullName).localeCompare(String(b.row.fields.fullName)));
  const within = days => records.filter(({ next }) => next && next.days <= days);
  const thisMonth = records.filter(({ next }) => next && next.date.getMonth() === today.getMonth() && next.date.getFullYear() === today.getFullYear());
  const photoUrl = adminPhotoUrl;
  const photoCell = row => row.fields.photoPath
    ? `<a class="birthday-thumb" href="${photoUrl(row)}&download" title="Download photo"><img src="${photoUrl(row)}" alt="${escapeHtml(row.fields.fullName)}" loading="lazy" /></a>`
    : "-";
  const whenLabel = next => !next ? "-" : next.days === 0 ? `<strong class="today-badge">Today</strong>` : next.days === 1 ? "Tomorrow" : `In ${next.days} days`;
  const celebrants = within(0);
  const rows = records.map(({ row, next }) => [
    photoCell(row),
    escapeHtml(row.fields.fullName || "-"),
    escapeHtml(row.fields.phoneNumber || "-"),
    birthdayLabel(row.fields.dateOfBirth),
    next ? String(next.age) : "-",
    whenLabel(next)
  ]);
  return `
    <div class="metric-grid">
      <article class="metric large"><span>Today</span><strong>${celebrants.length}</strong><small>${birthdayLabel(localDateKey(today))}</small></article>
      <article class="metric large"><span>Next 7 Days</span><strong>${within(7).length}</strong><small>including today</small></article>
      <article class="metric large"><span>This Month</span><strong>${thisMonth.length}</strong><small>${MONTHS[today.getMonth()]}</small></article>
      <article class="metric large"><span>Total</span><strong>${records.length}</strong><small>birthdays saved</small></article>
    </div>
    ${celebrants.length ? `
      <div class="panel">
        <h3>Celebrating Today</h3>
        <div class="celebrant-grid">
          ${celebrants.map(({ row, next }) => `
            <article class="celebrant">
              ${row.fields.photoPath ? `<img src="${photoUrl(row)}" alt="${escapeHtml(row.fields.fullName)}" />` : `<div class="celebrant-placeholder">${icon("cake")}</div>`}
              <strong>${escapeHtml(row.fields.fullName)}</strong>
              <small>Turning ${next.age} &middot; ${escapeHtml(row.fields.phoneNumber)}</small>
              ${row.fields.photoPath ? `<a class="btn outline small" href="${photoUrl(row)}&download">Download Photo</a>` : ""}
            </article>
          `).join("")}
        </div>
      </div>
    ` : ""}
    ${editableTable(["Photo", "Name", "Phone", "Birthday", "Turning", "When"], rows, records.map(({ row }) => row))}
  `;
}

// ---- Cell reports ----

function sameCell(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

// Cells meet weekly: a week runs Monday to Sunday and is named by its Monday.
function weekOf(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return localDateKey(date);
}

function weekLabel(week) {
  const start = new Date(`${week}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const day = date => date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${day(start)} – ${day(end)} ${end.getFullYear()}`;
}

// A week belongs to the month holding most of its days (its Thursday), so a
// week spanning two months is only counted once.
function monthOfWeek(week) {
  const thursday = new Date(`${week}T00:00:00`);
  thursday.setDate(thursday.getDate() + 3);
  return localDateKey(thursday).slice(0, 7);
}

function monthName(month) {
  const [year, index] = month.split("-").map(Number);
  return `${MONTHS[index - 1]} ${year}`;
}

function cellReportsFor(cell) {
  return (cellData?.reports || []).filter(report => sameCell(report.cell, cell));
}

// A member's record at the cell's last few meetings (newest first): "P"
// present, "A" absent, "-" not yet a member. `missed` counts consecutive
// absences up to the latest meeting, for the follow-up list.
function memberHistory(cell, memberId, count = 4) {
  const held = cellReportsFor(cell).filter(report => report.held === "yes");
  const marks = held.slice(0, count).map(report => report.present.includes(memberId) ? "P" : report.absent.includes(memberId) ? "A" : "-");
  let missed = 0;
  for (const report of held) {
    if (!report.absent.includes(memberId)) break;
    missed += 1;
  }
  return { marks, missed };
}

function followUps(cells) {
  return cells.flatMap(cell => (cellData.members[cell] || [])
    .map(member => ({ ...member, cell, missed: memberHistory(cell, member.id).missed }))
    .filter(member => member.missed >= 3))
    .sort((a, b) => b.missed - a.missed);
}

function historyDots(marks) {
  if (!marks.length) return `<span class="history-dots muted">No meetings yet</span>`;
  const labels = { P: "Present", A: "Absent", "-": "Not yet a member" };
  return `<span class="history-dots" title="Last ${marks.length} meetings, newest first">${marks.map(mark => `<i class="dot-${mark === "-" ? "none" : mark}" title="${labels[mark]}"></i>`).join("")}</span>`;
}

function visitorRow(visitor = {}) {
  return `
    <div class="visitor-row" data-visitor-row>
      <input name="visitorName" placeholder="Visitor's name" value="${escapeHtml(visitor.name || "")}" />
      <input name="visitorPhone" type="tel" placeholder="Phone number" value="${escapeHtml(visitor.phone || "")}" />
      <label class="permission-check"><input type="checkbox" name="visitorJoin" ${visitor.addToCell === false ? "" : "checked"} /> <span>Add to cell</span></label>
      <button class="btn ghost-dark small" type="button" data-remove-visitor aria-label="Remove visitor">&times;</button>
    </div>
  `;
}

function cellDataNotice() {
  if (!cellData) return `<div class="panel"><h3>Loading cells...</h3></div>`;
  if (cellData.error) return `<div class="panel"><h3>Couldn't load cell data</h3><p class="muted">${escapeHtml(cellData.error)}</p></div>`;
  return "";
}

function cellAttendanceTab() {
  const notice = cellDataNotice();
  if (notice) return notice;
  const { cells, members } = cellData;
  if (cells.length === 1) cellChoice = cells[0];
  if (cellChoice && !cells.some(cell => sameCell(cell, cellChoice))) cellChoice = "";
  if (!cellDate) cellDate = localDateKey(new Date());
  const picker = `
    <div class="panel cell-picker">
      ${cells.length > 1 ? `
        <label><span>Cell</span>
          <select data-cell-select>
            <option value="">Choose a cell...</option>
            ${cells.map(cell => `<option value="${escapeHtml(cell)}" ${sameCell(cell, cellChoice) ? "selected" : ""}>${escapeHtml(cell)} (${(members[cell] || []).length})</option>`).join("")}
          </select>
        </label>` : `<div><span class="label">Your cell</span><h3>${escapeHtml(cellChoice)}</h3></div>`}
      <label><span>Meeting date</span><input type="date" data-cell-date value="${cellDate}" max="${localDateKey(new Date())}" /><small class="muted">Week of ${weekLabel(weekOf(cellDate))}</small></label>
    </div>
  `;
  if (!cellChoice) return `${picker}<div class="panel"><p class="muted">Choose a cell to take attendance.</p></div>`;

  const roster = members[cellChoice] || [];
  // One report per cell per week: picking any day of a reported week opens
  // that week's report for editing.
  const existing = cellReportsFor(cellChoice).find(report => report.week === weekOf(cellDate));
  const draftKey = `${cellChoice}|${weekOf(cellDate)}`;
  if (cellDraft?.key !== draftKey) {
    cellDraft = existing
      ? { key: draftKey, held: existing.held, present: new Set(existing.present), topic: existing.topic, notes: existing.notes, offering: existing.offering ? String(existing.offering) : "", visitors: existing.visitors.map(visitor => ({ ...visitor, addToCell: false })) }
      : { key: draftKey, held: "yes", present: new Set(), topic: "", notes: "", offering: "", visitors: [] };
  }
  const draft = cellDraft;
  const held = draft.held === "yes";
  const rows = roster.map(member => {
    const { marks, missed } = memberHistory(cellChoice, member.id);
    return `
      <label class="roster-row" data-roster-row="${escapeHtml(`${member.name} ${member.phone}`.toLowerCase())}">
        <input type="checkbox" name="present" value="${member.id}" ${draft.present.has(member.id) ? "checked" : ""} />
        <span class="roster-person"><strong>${escapeHtml(member.name || "Unnamed")}</strong><small>${escapeHtml(member.phone || "No phone")}</small></span>
        ${missed >= 3 ? `<span class="tag">Missed ${missed}</span>` : ""}
        ${historyDots(marks)}
      </label>
    `;
  }).join("");
  return `
    ${picker}
    ${existing ? `<p class="form-note">This week's report was already sent${existing.leaderName ? ` by ${escapeHtml(existing.leaderName)}` : ""} (meeting on ${formatDate(existing.meetingDate)}). Saving again updates it${existing.meetingDate !== cellDate ? ` and changes the meeting date to ${formatDate(cellDate)}` : ""}.</p>` : ""}
    <form class="form cell-report-form" data-cell-report-form>
      <fieldset class="held-toggle">
        <legend>Did the meeting hold?</legend>
        <label><input type="radio" name="held" value="yes" ${held ? "checked" : ""} data-cell-held /> <span>Yes</span></label>
        <label><input type="radio" name="held" value="no" ${held ? "" : "checked"} data-cell-held /> <span>No</span></label>
      </fieldset>
      <div class="cell-held-section" data-held-section ${held ? "" : "hidden"}>
        <div class="roster-head">
          <h3>Attendance</h3>
          <strong class="present-count" data-present-count>${draft.present.size} of ${roster.length} present</strong>
        </div>
        ${roster.length ? `
          <div class="roster-tools">
            <input type="search" placeholder="Search names or phone numbers" data-roster-search />
            <button class="btn outline small" type="button" data-mark-all>Mark all present</button>
          </div>
          <div class="roster-list">${rows}</div>
          <p class="muted roster-key">${historyDots(["P", "A", "-"]).replace(/title="[^"]*"/, "")} Present &middot; Absent &middot; Not yet a member &mdash; last 4 meetings, newest first.</p>
        ` : `<p class="muted">No one has joined this cell yet. People appear here when they register for it on the Communities page, or when you add visitors below.</p>`}
        <h3>Visitors</h3>
        <div class="visitor-list" data-visitor-list>${draft.visitors.map(visitorRow).join("")}</div>
        <button class="btn outline small" type="button" data-add-visitor>+ Add a visitor</button>
        <label><span>Topic or study</span><input name="topic" value="${escapeHtml(draft.topic)}" placeholder="What did you study or discuss?" /></label>
        <label><span>Offering (&#8358;)</span><input name="offering" inputmode="numeric" value="${escapeHtml(draft.offering)}" placeholder="0" /></label>
      </div>
      <label><span data-notes-label>${held ? "Notes, testimonies or prayer requests" : "Why didn't the meeting hold?"}</span><textarea name="notes" rows="3">${escapeHtml(draft.notes)}</textarea></label>
      <button class="btn primary block" type="submit">${existing ? "Update Report" : "Send Report"} ${icon("arrow")}</button>
      <p class="form-note"></p>
    </form>
  `;
}

function cellReportsTab() {
  const notice = cellDataNotice();
  if (notice) return notice;
  const { cells, members } = cellData;
  const scope = cellReportFilter && cells.some(cell => sameCell(cell, cellReportFilter)) ? [cellReportFilter] : cells;
  const reports = cellData.reports.filter(report => scope.some(cell => sameCell(cell, report.cell)));
  const report = cellReportView && reports.find(item => item.id === cellReportView);
  if (report) return cellReportDetail(report, members[report.cell] || []);
  cellReportView = "";

  const needFollowUp = followUps(scope);
  const weeks = weeklyTotals(reports, scope);
  const months = monthlyAverages(weeks);
  const thisWeek = weeks.find(week => week.week === weekOf(localDateKey(new Date())));
  const thisMonth = months.find(month => month.month === localDateKey(new Date()).slice(0, 7));
  const rate = (present, possible) => possible ? `${Math.round((present / possible) * 100)}%` : "-";
  const weekRows = weeks.slice(0, 12).map(week => [
    `<strong>${weekLabel(week.week)}</strong>`,
    `${week.cellsReported} of ${week.activeCells}`,
    String(week.present),
    String(week.possible),
    rate(week.present, week.possible),
    String(week.visitors),
    week.offering ? money(week.offering) : "-"
  ]);
  const monthRows = months.slice(0, 12).map(month => [
    `<strong>${monthName(month.month)}</strong>`,
    String(month.weeks),
    `<strong>${Math.round(month.averagePresent)}</strong> people`,
    rate(month.present, month.possible),
    String(month.visitors),
    month.offering ? money(month.offering) : "-"
  ]);
  const reportRows = reports.map(item => [
    formatDate(item.meetingDate),
    escapeHtml(item.cell),
    escapeHtml(item.leaderName || "-"),
    item.held === "yes" ? `${item.presentCount} / ${item.memberCount} (${rate(item.presentCount, item.memberCount)})` : `<span class="tag">Didn't hold</span>`,
    String(item.visitorCount || 0),
    item.offering ? money(item.offering) : "-",
    `<button class="btn outline small" type="button" data-view-report="${item.id}">View</button>`
  ]);
  const scopeLabel = scope.length === 1 ? escapeHtml(scope[0]) : "all cells";
  const monthLabel = MONTHS[new Date().getMonth()];
  return `
    <div class="panel cell-picker">
      ${cells.length > 1 ? `
        <label><span>Show</span>
          <select data-report-filter>
            <option value="">All cells</option>
            ${cells.map(cell => `<option value="${escapeHtml(cell)}" ${sameCell(cell, cellReportFilter) ? "selected" : ""}>${escapeHtml(cell)}</option>`).join("")}
          </select>
        </label>` : `<div><span class="label">Your cell</span><h3>${escapeHtml(cells[0])}</h3></div>`}
      <button class="btn outline" type="button" data-cell-csv ${reports.length ? "" : "disabled"}>Download CSV</button>
    </div>
    <div class="metric-grid">
      <article class="metric large"><span>This Week</span><strong>${thisWeek ? thisWeek.present : 0}</strong><small>${thisWeek ? `present across ${thisWeek.cellsReported} of ${thisWeek.activeCells} cells` : "no reports yet this week"}</small></article>
      <article class="metric large"><span>Monthly Average</span><strong>${thisMonth ? Math.round(thisMonth.averagePresent) : "-"}</strong><small>${thisMonth ? `people a week in ${monthLabel} (${rate(thisMonth.present, thisMonth.possible)})` : `no reports in ${monthLabel} yet`}</small></article>
      <article class="metric large"><span>Visitors</span><strong>${thisMonth ? thisMonth.visitors : 0}</strong><small>this month</small></article>
      <article class="metric large"><span>Need Follow-Up</span><strong>${needFollowUp.length}</strong><small>missed 3+ meetings in a row</small></article>
    </div>
    ${needFollowUp.length ? `
      <div class="panel">
        <h3>Follow Up</h3>
        <p class="muted">Members who missed their last 3 or more meetings. A call or visit goes a long way.</p>
        <div class="follow-up-list">
          ${needFollowUp.map(member => `
            <div class="follow-up">
              <span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.cell)} &middot; missed ${member.missed}</small></span>
              ${member.phone ? `<a class="btn outline small" href="tel:${escapeHtml(member.phone.replace(/[^\d+]/g, ""))}">${icon("phone")} ${escapeHtml(member.phone)}</a>` : ""}
            </div>
          `).join("")}
        </div>
      </div>
    ` : ""}
    <div class="panel report-section">
      <h3>Weekly Attendance</h3>
      <p class="muted">Every cell's attendance added up for each week (Monday to Sunday), for ${scopeLabel}.</p>
      <div class="table">${table(["Week", "Cells Reported", "Present", "Members", "Attendance", "Visitors", "Offering"], weekRows)}</div>
    </div>
    <div class="panel report-section">
      <h3>Monthly Average</h3>
      <p class="muted">Average weekly attendance for each month: that month's weekly totals added up, divided by the number of weeks reported.</p>
      <div class="table">${table(["Month", "Weeks", "Avg. Weekly Attendance", "Attendance Rate", "Visitors", "Offering"], monthRows)}</div>
    </div>
    <div class="panel report-section">
      <h3>All Reports</h3>
      <div class="table">${table(["Date", "Cell", "Leader", "Attendance", "Visitors", "Offering", ""], reportRows)}</div>
    </div>
  `;
}

// Adds up every cell's report for each week. "activeCells" is how many of
// the cells in view could have reported (they have members or have reported
// before), so "3 of 8" shows at a glance which cells are missing.
function weeklyTotals(reports, scope) {
  const activeCells = scope.filter(cell => (cellData.members[cell] || []).length || cellReportsFor(cell).length).length;
  const byWeek = new Map();
  for (const report of reports) {
    const week = byWeek.get(report.week) || { week: report.week, cellsReported: 0, present: 0, possible: 0, visitors: 0, offering: 0 };
    week.cellsReported += 1;
    if (report.held === "yes") {
      week.present += report.presentCount;
      week.possible += report.memberCount;
    }
    week.visitors += report.visitorCount || 0;
    week.offering += report.offering || 0;
    byWeek.set(report.week, week);
  }
  return [...byWeek.values()]
    .map(week => ({ ...week, activeCells: Math.max(activeCells, week.cellsReported) }))
    .sort((a, b) => b.week.localeCompare(a.week));
}

function monthlyAverages(weeks) {
  const byMonth = new Map();
  for (const week of weeks) {
    const key = monthOfWeek(week.week);
    const month = byMonth.get(key) || { month: key, weeks: 0, present: 0, possible: 0, visitors: 0, offering: 0 };
    month.weeks += 1;
    month.present += week.present;
    month.possible += week.possible;
    month.visitors += week.visitors;
    month.offering += week.offering;
    byMonth.set(key, month);
  }
  return [...byMonth.values()]
    .map(month => ({ ...month, averagePresent: month.present / month.weeks }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

function cellReportDetail(report, roster) {
  const byId = new Map(roster.map(member => [member.id, member]));
  const person = id => byId.get(id) || { name: "(no longer in this cell)", phone: "" };
  const names = ids => ids.length
    ? `<ul class="profile-list">${ids.map(id => person(id)).map(member => `<li><strong>${escapeHtml(member.name)}</strong>${member.phone ? `<small>${escapeHtml(member.phone)}</small>` : ""}</li>`).join("")}</ul>`
    : `<p class="muted">None</p>`;
  return `
    <button class="btn ghost-dark" type="button" data-report-back>&larr; All reports</button>
    <div class="panel report-head">
      <div>
        <span class="label">${escapeHtml(report.cell)}</span>
        <h3>${formatDate(report.meetingDate)}</h3>
        <p class="muted">Sent by ${escapeHtml(report.leaderName || "-")} &middot; ${new Date(report.updatedAt || report.createdAt).toLocaleString()}</p>
      </div>
      <div class="inline-actions">
        <button class="btn primary small" type="button" data-edit-report="${report.id}">Edit</button>
        ${can("delete_submissions") ? `<button class="btn danger small" type="button" data-delete-report="${report.id}">Delete</button>` : ""}
      </div>
    </div>
    ${report.held === "yes" ? `
      <div class="metric-grid">
        <article class="metric large"><span>Present</span><strong>${report.presentCount} / ${report.memberCount}</strong><small>${report.memberCount ? Math.round((report.presentCount / report.memberCount) * 100) : 0}% attendance</small></article>
        <article class="metric large"><span>Visitors</span><strong>${report.visitorCount}</strong><small>first-timers and guests</small></article>
        <article class="metric large"><span>Offering</span><strong>${report.offering ? money(report.offering) : "-"}</strong><small>recorded</small></article>
      </div>
      <div class="profile-grid">
        ${profileCard("Present", "check", names(report.present))}
        ${profileCard("Absent", "users", names(report.absent))}
        ${profileCard("Visitors", "heart", report.visitors.length ? `<ul class="profile-list">${report.visitors.map(visitor => `<li><strong>${escapeHtml(visitor.name)}</strong>${visitor.phone ? `<small>${escapeHtml(visitor.phone)}</small>` : ""}</li>`).join("")}</ul>` : `<p class="muted">None</p>`)}
      </div>
      ${report.topic ? `<div class="panel"><h3>Topic</h3><p>${escapeHtml(report.topic)}</p></div>` : ""}
    ` : `<div class="panel"><h3>The meeting didn't hold</h3></div>`}
    ${report.notes ? `<div class="panel"><h3>Notes</h3><p>${escapeHtml(report.notes)}</p></div>` : ""}
  `;
}

function downloadCellReportsCsv() {
  const { cells, members } = cellData;
  const scope = cellReportFilter ? [cellReportFilter] : cells;
  const reports = cellData.reports.filter(report => scope.some(cell => sameCell(cell, report.cell)));
  const nameOf = (cell, id) => (members[cell] || []).find(member => member.id === id)?.name || "(removed)";
  const cell = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const headers = ["Week", "Date", "Cell", "Leader", "Held", "Present", "Members", "Attendance %", "Visitors", "Offering", "Topic", "Notes", "Present names", "Absent names", "Visitor names"];
  const rows = reports.map(report => [
    weekLabel(report.week), report.meetingDate, report.cell, report.leaderName, report.held, report.presentCount, report.memberCount,
    report.held === "yes" && report.memberCount ? Math.round((report.presentCount / report.memberCount) * 100) : "",
    report.visitorCount, report.offering || "", report.topic, report.notes,
    report.present.map(id => nameOf(report.cell, id)).join("; "),
    report.absent.map(id => nameOf(report.cell, id)).join("; "),
    report.visitors.map(visitor => visitor.name).join("; ")
  ]);
  const csv = [headers, ...rows].map(row => row.map(cell).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  link.download = `cell-reports${cellReportFilter ? `-${cellReportFilter.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function submitCellReport(form) {
  const note = form.querySelector(".form-note");
  const button = form.querySelector("button[type='submit']");
  const data = new FormData(form);
  const held = data.get("held") === "no" ? "no" : "yes";
  const visitors = [...form.querySelectorAll("[data-visitor-row]")].map(row => ({
    name: row.querySelector("[name=visitorName]").value.trim(),
    phone: row.querySelector("[name=visitorPhone]").value.trim(),
    addToCell: row.querySelector("[name=visitorJoin]").checked
  })).filter(visitor => visitor.name);
  const body = {
    cell: cellChoice,
    meetingDate: cellDate,
    held,
    present: data.getAll("present"),
    visitors,
    topic: data.get("topic") || "",
    offering: data.get("offering") || "",
    notes: data.get("notes") || "",
    submissionId: crypto.randomUUID()
  };
  if (held === "no" && !body.notes.trim()) {
    note.className = "form-note error";
    note.textContent = "Please say briefly why the meeting didn't hold.";
    return;
  }
  button.disabled = true;
  note.className = "form-note";
  note.textContent = "Sending report...";
  try {
    const result = await postOrQueue("/api/cell/reports", body, `${cellChoice} report`);
    if (result.queued) {
      note.className = "form-note success";
      note.textContent = QUEUED_NOTE;
      return;
    }
    cellData = result.overview;
    cellDraft = null;
    const summary = held === "yes" ? `${body.present.length} present` : "meeting marked as not held";
    toast(`${result.updated ? "Report updated" : "Report sent"}: ${summary}.${result.added.length ? ` Added ${result.added.join(", ")} to the cell.` : ""}`, "success");
    render();
  } catch (error) {
    note.className = "form-note error";
    note.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function editableTable(headers, rows, records) {
  const canEdit = can("edit_submissions");
  const canDelete = can("delete_submissions");
  const showActions = canEdit || canDelete;
  const head = [...headers, ...(showActions ? ["Actions"] : [])];
  const body = rows.length
    ? rows.map((row, index) => {
        const record = records[index];
        const actionsCell = showActions
          ? `<td class="actions-cell">
              ${canEdit && record.type !== "cell_report" ? `<button class="btn primary small" type="button" data-edit-submission="${record.id}">Edit</button>` : ""}
              ${canEdit ? `<span class="status-editor"><input data-status-input data-id="${record.id}" value="${record.status || ""}" /><button class="btn outline small" type="button" data-save-status="${record.id}">Save</button></span>` : ""}
              ${canDelete ? `<button class="btn danger small" type="button" data-delete-submission="${record.id}">Delete</button>` : ""}
            </td>`
          : "";
        return `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}${actionsCell}</tr>`;
      }).join("")
    : `<tr><td colspan="${head.length}">No records yet.</td></tr>`;
  // Wide tables scroll horizontally rather than squeezing off the page (see
  // .dashboard-main / .table in styles.css), but a scrollbar alone is easy
  // to miss -- this line makes "there's more to the right" impossible to
  // miss instead of relying on a thin bar admins might not notice.
  const hint = showActions ? `<p class="table-scroll-hint">Scroll right to edit, change status or delete &rarr;</p>` : "";
  return `${hint}<div class="table"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function launchItemForm(editing) {
  return `
    <div class="panel">
      <h3>${editing ? "Edit Launch Item" : "Add Launch Item"}</h3>
      <form class="form inline-form" data-launch-item-form data-editing-id="${editing?.id || ""}">
        <label><span>Item</span><input name="item" value="${editing?.item || ""}" required /></label>
        <label><span>Type</span><input name="type" value="${editing?.type || ""}" placeholder="Event, Form, Automation, Finance..." /></label>
        <label><span>Status</span><input name="status" value="${editing?.status || ""}" placeholder="Draft, Live, Review..." /></label>
        <label><span>Due</span><input name="due" value="${editing?.due || ""}" placeholder="Example: Sep 30" /></label>
        <div class="inline-actions">
          <button class="btn primary" type="submit">${editing ? "Save Changes" : "Add Item"}</button>
          ${editing ? `<button class="btn ghost-dark" type="button" data-cancel-edit-launch-item>Cancel</button>` : ""}
        </div>
      </form>
    </div>
  `;
}

function broadcastTab() {
  return `
    <div class="panel">
      <h3>Audience</h3>
      ${broadcastAudience ? `
        <div class="metric-grid">
          <article class="metric"><span>Opted-in SMS</span><strong>${broadcastAudience.sms.recipients}</strong><small>max ${broadcastAudience.sms.maximumPerSend} per send</small></article>
          <article class="metric"><span>Opted-in Email</span><strong>${broadcastAudience.email.recipients}</strong><small>max ${broadcastAudience.email.maximumPerSend} per send</small></article>
        </div>
      ` : `<p class="muted">Loading audience...</p>`}
    </div>
    <div class="dashboard-grid">
      <article class="panel">
        <h3>Send SMS</h3>
        <form class="form inline-form" data-broadcast-form="sms">
          <label><span>Message</span><input name="message" data-tall maxlength="480" required /></label>
          <button class="btn primary" type="submit" ${broadcastBusy ? "disabled" : ""}>${broadcastBusy === "sms" ? "Sending..." : "Send SMS"}</button>
        </form>
      </article>
      <article class="panel">
        <h3>Send Email</h3>
        <form class="form inline-form" data-broadcast-form="email">
          <label><span>Subject</span><input name="subject" maxlength="120" required /></label>
          <label><span>Message</span><input name="message" data-tall required /></label>
          <button class="btn primary" type="submit" ${broadcastBusy ? "disabled" : ""}>${broadcastBusy === "email" ? "Sending..." : "Send Email"}</button>
        </form>
      </article>
    </div>
    ${broadcastNote ? `<p class="form-note ${broadcastNoteType}">${broadcastNote}</p>` : ""}
  `;
}

function adminsTab() {
  if (!adminsList) return `<div class="panel"><h3>Loading admins...</h3></div>`;
  const editing = editingAdminId ? adminsList.find(admin => admin.id === editingAdminId) : null;
  const rows = adminsList.map(admin => `
    <tr>
      <td>${admin.name}</td>
      <td>${admin.email}</td>
      <td><span class="badge role-${admin.role}">${ROLE_LABELS[admin.role] || admin.role}</span></td>
      <td>${admin.permissions?.length ? admin.permissions.map(permissionLabel).join(", ") : "-"}</td>
      <td>${admin.active ? "Active" : "Suspended"}</td>
      <td>${admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : "Never"}</td>
      <td class="actions-cell">
        <button class="btn outline small" type="button" data-edit-admin="${admin.id}">Edit</button>
        ${admin.id !== adminSession.id ? `<button class="btn danger small" type="button" data-delete-admin="${admin.id}">Remove</button>` : ""}
      </td>
    </tr>
  `).join("");
  return `
    <div class="table">
      <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Permissions</th><th>Status</th><th>Last Sign-in</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="7">No admins yet.</td></tr>`}</tbody></table>
    </div>
    ${adminForm(editing)}
  `;
}

function permissionLabel(permission) {
  if (permission.startsWith("cell:")) return `Cell: ${permission.slice(5)}`;
  return PERMISSION_LABELS[permission] || permission;
}

function adminForm(editing) {
  const permissions = editing ? editing.permissions || [] : ROLE_DEFAULTS.viewer;
  return `
    <div class="panel">
      <h3>${editing ? `Edit ${editing.name}` : "Add Admin"}</h3>
      ${adminFormError ? `<p class="form-note error">${adminFormError}</p>` : ""}
      <form class="form inline-form" data-admin-form data-editing-id="${editing?.id || ""}">
        <label><span>Full name</span><input name="name" value="${editing?.name || ""}" required /></label>
        <label><span>Email</span><input name="email" type="email" value="${editing?.email || ""}" ${editing ? "readonly" : ""} required /></label>
        <label><span>${editing ? "New password (leave blank to keep current)" : "Temporary password"}</span><input name="password" type="password" minlength="8" ${editing ? "" : "required"} /></label>
        <label><span>Role</span>
          <select name="role" data-role-select>
            ${["viewer", "manager", "superadmin", "cell_leader"].map(role => `<option value="${role}" ${(editing?.role || "viewer") === role ? "selected" : ""}>${ROLE_LABELS[role]}</option>`).join("")}
          </select>
        </label>
        <fieldset class="permission-grid" data-cell-picker ${editing?.role === "cell_leader" ? "" : "hidden"}>
          <legend>Cells this leader manages</legend>
          ${communities.map(([name]) => `
            <label class="permission-check"><input type="checkbox" name="cells" value="${escapeHtml(name)}" ${permissions.includes(`cell:${name}`) ? "checked" : ""} /> <span>${escapeHtml(name)}</span></label>
          `).join("")}
        </fieldset>
        <fieldset class="permission-grid" data-permission-picker ${editing?.role === "cell_leader" ? "hidden" : ""}>
          <legend>Permissions</legend>
          ${ALL_PERMISSIONS.map(permission => `
            <label class="permission-check"><input type="checkbox" name="permissions" value="${permission}" ${permissions.includes(permission) ? "checked" : ""} /> <span>${permissionLabel(permission)}</span></label>
          `).join("")}
        </fieldset>
        ${editing ? `<label class="permission-check"><input type="checkbox" name="active" ${editing.active ? "checked" : ""} /> <span>Account active</span></label>` : ""}
        <div class="inline-actions">
          <button class="btn primary" type="submit">${editing ? "Save Changes" : "Create Admin"}</button>
          ${editing ? `<button class="btn ghost-dark" type="button" data-cancel-edit-admin>Cancel</button>` : ""}
        </div>
      </form>
    </div>
  `;
}

function table(headers, rows) {
  const body = rows.length
    ? rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}">No records yet.</td></tr>`;
  return `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
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
        <div><h4>Get Involved</h4><button data-nav="communities">Join a Community</button><button data-nav="workforce">Join the Workforce</button><button data-nav="partnership">Partner With Us</button><button data-nav="birthdays">Birthday Celebrations</button><button data-nav="profile">My Profile</button><button data-nav="attendance">Mark Attendance</button><button type="button" data-install ${isStandalone() ? "hidden" : ""}>Install the App</button></div>
        <div><h4>Contact</h4><p>Akure, Ondo State</p><a href="${contactInfo.phoneHref}">${contactInfo.phone}</a><p>akure@harvestersng.org</p><div class="footer-social">${socialLinks.map(social => `<a href="${social.url}" target="_blank" rel="noopener noreferrer" aria-label="${social.name} ${social.handle}" title="${social.name} ${social.handle}">${icon(social.name.toLowerCase())}</a>`).join("")}</div><button data-nav="dashboard">Team Dashboard</button><a href="/callcentre/">Outreach Call Centre</a></div>
      </div>
      <div class="copyright">© 2026 Harvesters Akure. A campus of Harvesters International Christian Centre.</div>
    </footer>
  `;
}

function initHeroScene() {
  const canvas = document.querySelector("[data-hero-3d]");
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
  renderer.setClearColor(0x06152a, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x08172b, 0.055);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 90);
  camera.position.set(0, 5.2, 16);
  camera.lookAt(0, 1.5, 0);

  const group = new THREE.Group();
  scene.add(group);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 34),
    new THREE.MeshStandardMaterial({ color: 0x111f36, roughness: 0.78, metalness: 0.08 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -2;
  group.add(floor);

  const stage = new THREE.Mesh(
    new THREE.BoxGeometry(15, 0.7, 5.2),
    new THREE.MeshStandardMaterial({ color: 0x0b2445, roughness: 0.58, metalness: 0.18 })
  );
  stage.position.set(0, 0.35, -8.6);
  group.add(stage);

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(17, 8.5, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x071e3d, roughness: 0.7 })
  );
  backWall.position.set(0, 4.3, -11.2);
  group.add(backWall);

  const crossMaterial = new THREE.MeshStandardMaterial({
    color: 0xd71920,
    emissive: 0xd71920,
    emissiveIntensity: 1.6,
    roughness: 0.25
  });
  const crossVertical = new THREE.Mesh(new THREE.BoxGeometry(0.38, 4.2, 0.22), crossMaterial);
  const crossHorizontal = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.35, 0.22), crossMaterial);
  crossVertical.position.set(0, 4.5, -10.9);
  crossHorizontal.position.set(0, 5.15, -10.85);
  group.add(crossVertical, crossHorizontal);

  const seatMaterial = new THREE.MeshStandardMaterial({ color: 0x132b4a, roughness: 0.68, metalness: 0.08 });
  const seatGeometry = new THREE.BoxGeometry(0.92, 0.42, 0.82);
  for (let row = 0; row < 7; row += 1) {
    const z = 4.8 - row * 1.55;
    const width = 4 + row;
    for (let col = -width; col <= width; col += 1) {
      if (Math.abs(col) < 1 && row > 1) continue;
      const seat = new THREE.Mesh(seatGeometry, seatMaterial);
      seat.position.set(col * 1.08, 0.45, z);
      seat.rotation.y = col * -0.018;
      group.add(seat);
    }
  }

  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  [-4.8, 0, 4.8].forEach((x, index) => {
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.1, 11, 32, 1, true), beamMaterial.clone());
    beam.position.set(x, 6.2, -5.7);
    beam.rotation.x = Math.PI;
    beam.rotation.z = (index - 1) * 0.14;
    group.add(beam);
  });

  const ambient = new THREE.AmbientLight(0x8fb5ff, 0.55);
  const key = new THREE.PointLight(0xffffff, 22, 34);
  key.position.set(-4, 7, 4);
  const red = new THREE.PointLight(0xd71920, 24, 26);
  red.position.set(0, 4.8, -9.8);
  scene.add(ambient, key, red);

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  let frame = 0;
  const animate = () => {
    frame = requestAnimationFrame(animate);
    const t = performance.now() * 0.001;
    group.rotation.y = Math.sin(t * 0.28) * 0.055;
    group.position.y = Math.sin(t * 0.45) * 0.08;
    camera.position.x = Math.sin(t * 0.18) * 0.8;
    camera.lookAt(0, 2.1, -2.5);
    renderer.render(scene, camera);
  };

  resize();
  animate();
  window.addEventListener("resize", resize);

  heroSceneCleanup = () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
    scene.traverse(object => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      }
    });
    renderer.dispose();
  };
}

function closeChoiceModal() {
  selectedChoice = { community: "", workforce: "" };
  // Keep the reader where they were in the list rather than jumping to the top.
  const scrollY = window.scrollY;
  render();
  window.scrollTo(0, scrollY);
}

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && document.querySelector(".form-modal")) closeChoiceModal();
});

function render() {
  if (heroSceneCleanup) {
    heroSceneCleanup();
    heroSceneCleanup = null;
  }
  const content = activeView === "home" ? home() : activeView === "dashboard" ? adminArea() : simplePage(activeView);
  app.innerHTML = shell(content);
  document.querySelectorAll("[data-nav]").forEach(el => el.addEventListener("click", event => {
    event.preventDefault();
    navigate(el.dataset.nav);
  }));
  document.querySelectorAll("[data-dash]").forEach(el => el.addEventListener("click", () => {
    activeDashboard = el.dataset.dash;
    render();
  }));
  document.querySelectorAll("[data-focus-form]").forEach(el => el.addEventListener("click", () => {
    document.querySelector("#form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  document.querySelectorAll("[data-choose]").forEach(el => el.addEventListener("click", () => {
    selectedChoice[el.dataset.choose] = el.dataset.choice;
    render();
    document.querySelector(".form-modal input:not([readonly])")?.focus();
  }));
  document.querySelectorAll("[data-close-choice]").forEach(el => el.addEventListener("click", event => {
    // The backdrop carries data-close-choice too; ignore clicks that land
    // inside the panel and merely bubble up to it.
    if (event.target !== el) return;
    closeChoiceModal();
  }));
  document.body.classList.toggle("modal-open", Boolean(document.querySelector(".form-modal")));
  document.querySelector("[data-export]")?.addEventListener("click", () => {
    const type = { communities: "community", workforce: "workforce", birthdays: "birthday" }[activeDashboard] || "";
    window.location.href = type ? `/api/export?type=${type}` : "/api/export";
  });
  const menu = document.querySelector("[data-menu]");
  if (menu) menu.addEventListener("click", () => {
    menuOpen = !menuOpen;
    render();
  });
  document.querySelectorAll("[data-api-form]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const note = form.querySelector(".form-note") || document.createElement("p");
    const button = form.querySelector("button[type='submit']") || form.querySelector("button");
    const fields = Object.fromEntries(new FormData(form).entries());
    if (!fields.name && fields.fullName) fields.name = fields.fullName;
    const submissionId = form.dataset.submissionId || crypto.randomUUID();
    form.dataset.submissionId = submissionId;
    note.className = "form-note";
    note.textContent = "Saving...";
    form.appendChild(note);
    if (button) button.disabled = true;
    try {
      const result = await postOrQueue("/api/submissions", { type: form.dataset.formType, fields, submissionId }, form.querySelector("h3")?.textContent || "Form");
      dashboardData = null;
      form.reset();
      delete form.dataset.submissionId;
      note.className = "form-note success";
      note.textContent = result.queued
        ? QUEUED_NOTE
        : result.googleSheet?.synced
        ? `Saved and sent to the team. Short code: ${result.record.shortCode || recordCode(result.record)}.`
        : `Saved. Short code: ${result.record.shortCode || recordCode(result.record)}.`;
      if (!result.queued) welcomeAfterSubmit(form, form.dataset.formType, fields, result.record);
    } catch (error) {
      note.className = "form-note error";
      note.textContent = error.message;
    } finally {
      if (button) button.disabled = false;
    }
  }));
  document.querySelectorAll("[data-attendance-form]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    saveAttendance(form);
  }));
  document.querySelectorAll("[data-photo-input]").forEach(input => input.addEventListener("change", () => choosePhoto(input)));
  document.querySelector("[data-member-email-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    memberEmail = event.target.email.value.trim();
    requestMemberCode();
  });
  document.querySelector("[data-member-code-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    verifyMemberCode(event.target.code.value);
  });
  document.querySelector("[data-member-resend]")?.addEventListener("click", () => requestMemberCode());
  document.querySelector("[data-member-change-email]")?.addEventListener("click", () => {
    memberStep = "email";
    setMemberNote("");
    render();
  });
  document.querySelector("[data-member-edit]")?.addEventListener("click", () => {
    memberEditing = true;
    setMemberNote("");
    render();
  });
  document.querySelector("[data-member-cancel-edit]")?.addEventListener("click", () => {
    memberEditing = false;
    photoDrafts.member = "";
    setMemberNote("");
    render();
  });
  document.querySelector("[data-member-profile-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    saveMemberProfile(event.target);
  });
  document.querySelector("[data-member-logout]")?.addEventListener("click", signOutMember);
  document.querySelectorAll("[data-install]").forEach(button => button.addEventListener("click", installApp));
  // Cell reports. Ticking, searching and adding visitors change the page in
  // place (no re-render) so nothing the leader has typed is lost.
  document.querySelector("[data-cell-select]")?.addEventListener("change", event => {
    cellChoice = event.target.value;
    cellDraft = null;
    render();
  });
  document.querySelector("[data-cell-date]")?.addEventListener("change", event => {
    if (!event.target.value) return;
    cellDate = event.target.value;
    cellDraft = null;
    render();
  });
  const cellForm = document.querySelector("[data-cell-report-form]");
  if (cellForm) {
    const updateCount = () => {
      const boxes = cellForm.querySelectorAll("input[name=present]");
      const ticked = [...boxes].filter(box => box.checked);
      cellDraft.present = new Set(ticked.map(box => box.value));
      const count = cellForm.querySelector("[data-present-count]");
      if (count) count.textContent = `${ticked.length} of ${boxes.length} present`;
    };
    cellForm.addEventListener("change", event => {
      if (event.target.name === "present") updateCount();
      if (event.target.matches("[data-cell-held]")) {
        cellDraft.held = event.target.value;
        cellForm.querySelector("[data-held-section]").hidden = event.target.value !== "yes";
        cellForm.querySelector("[data-notes-label]").textContent = event.target.value === "yes" ? "Notes, testimonies or prayer requests" : "Why didn't the meeting hold?";
      }
    });
    cellForm.querySelector("[data-roster-search]")?.addEventListener("input", event => {
      const query = event.target.value.trim().toLowerCase();
      cellForm.querySelectorAll("[data-roster-row]").forEach(row => {
        row.hidden = Boolean(query) && !row.dataset.rosterRow.includes(query);
      });
    });
    cellForm.querySelector("[data-mark-all]")?.addEventListener("click", () => {
      cellForm.querySelectorAll("[data-roster-row]:not([hidden]) input[name=present]").forEach(box => { box.checked = true; });
      updateCount();
    });
    cellForm.querySelector("[data-add-visitor]").addEventListener("click", () => {
      const list = cellForm.querySelector("[data-visitor-list]");
      list.insertAdjacentHTML("beforeend", visitorRow());
      list.lastElementChild.querySelector("input").focus();
    });
    cellForm.addEventListener("click", event => {
      if (event.target.closest("[data-remove-visitor]")) event.target.closest("[data-visitor-row]").remove();
    });
    cellForm.addEventListener("submit", event => {
      event.preventDefault();
      submitCellReport(cellForm);
    });
  }
  document.querySelector("[data-report-filter]")?.addEventListener("change", event => {
    cellReportFilter = event.target.value;
    render();
  });
  document.querySelector("[data-cell-csv]")?.addEventListener("click", downloadCellReportsCsv);
  document.querySelectorAll("[data-view-report]").forEach(button => button.addEventListener("click", () => {
    cellReportView = button.dataset.viewReport;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  document.querySelector("[data-report-back]")?.addEventListener("click", () => {
    cellReportView = "";
    render();
  });
  document.querySelector("[data-edit-report]")?.addEventListener("click", event => {
    const report = cellData.reports.find(item => item.id === event.currentTarget.dataset.editReport);
    cellChoice = report.cell;
    cellDate = report.meetingDate;
    cellDraft = null;
    cellReportView = "";
    activeDashboard = "cell-attendance";
    render();
  });
  document.querySelector("[data-delete-report]")?.addEventListener("click", async event => {
    if (!confirm("Delete this cell report? This cannot be undone.")) return;
    try {
      const response = await fetch(`/api/admin/submissions/${event.currentTarget.dataset.deleteReport}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not delete this report.");
      cellReportView = "";
      dashboardData = result.dashboard || null;
      await loadCellData(true);
    } catch (error) {
      alert(error.message);
    }
  });
  document.querySelector("[data-member-search]")?.addEventListener("input", event => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll("[data-member-row]").forEach(row => {
      row.hidden = Boolean(query) && !row.dataset.memberRow.includes(query);
    });
  });
  document.querySelectorAll("[data-view-member]").forEach(button => button.addEventListener("click", () => {
    selectedMemberKey = button.dataset.viewMember;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  document.querySelector("[data-member-back]")?.addEventListener("click", () => {
    selectedMemberKey = "";
    render();
  });
  document.querySelectorAll("[data-delete-member]").forEach(button => button.addEventListener("click", () => {
    deleteMember(button.dataset.deleteMember);
  }));
  document.querySelector("[data-birthday-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    saveBirthday(event.target);
  });
  document.querySelector("[data-login-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.target).entries());
    loginSubmitting = true;
    loginError = "";
    render();
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not sign in.");
      adminSession = result.admin;
      activeDashboard = "overview";
      dashboardData = null;
      cellData = undefined;
    } catch (error) {
      loginError = error.message;
    } finally {
      loginSubmitting = false;
      render();
    }
  });
  document.querySelector("[data-logout]")?.addEventListener("click", async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // ignore network errors on logout; the local session is cleared regardless
    }
    adminSession = null;
    dashboardData = null;
    adminsList = null;
    broadcastAudience = null;
    cellData = undefined;
    cellChoice = "";
    cellDraft = null;
    cellReportView = "";
    cellReportFilter = "";
    activeDashboard = "overview";
    render();
  });
  document.querySelector("[data-change-password-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const fields = Object.fromEntries(new FormData(form).entries());
    const note = form.querySelector(".form-note") || document.createElement("p");
    form.appendChild(note);
    try {
      const response = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update your password.");
      adminSession = result.admin;
      render();
    } catch (error) {
      note.className = "form-note error";
      note.textContent = error.message;
    }
  });
  document.querySelectorAll("[data-save-status]").forEach(button => button.addEventListener("click", () => {
    const id = button.dataset.saveStatus;
    const input = document.querySelector(`[data-status-input][data-id="${id}"]`);
    updateSubmission(id, { status: input.value });
  }));
  document.querySelectorAll("[data-edit-submission]").forEach(button => button.addEventListener("click", () => {
    const record = dashboardData?.submissions?.find(item => item.id === button.dataset.editSubmission);
    if (record) showSubmissionEditor(record);
  }));
  document.querySelectorAll("[data-delete-submission]").forEach(button => button.addEventListener("click", () => {
    deleteSubmission(button.dataset.deleteSubmission);
  }));
  document.querySelectorAll("[data-edit-launch-item]").forEach(button => button.addEventListener("click", () => {
    editingLaunchItemId = button.dataset.editLaunchItem;
    render();
  }));
  document.querySelector("[data-cancel-edit-launch-item]")?.addEventListener("click", () => {
    editingLaunchItemId = null;
    render();
  });
  document.querySelectorAll("[data-delete-launch-item]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Remove this launch item?")) return;
    try {
      const response = await fetch(`/api/admin/launch-items/${button.dataset.deleteLaunchItem}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not remove this item.");
      dashboardData = result.dashboard;
      render();
    } catch (error) {
      alert(error.message);
    }
  }));
  document.querySelector("[data-launch-item-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const fields = Object.fromEntries(new FormData(form).entries());
    const editingId = form.dataset.editingId;
    try {
      const response = await fetch(editingId ? `/api/admin/launch-items/${editingId}` : "/api/admin/launch-items", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this item.");
      dashboardData = result.dashboard;
      editingLaunchItemId = null;
      render();
    } catch (error) {
      alert(error.message);
    }
  });
  document.querySelectorAll("[data-broadcast-form]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const kind = form.dataset.broadcastForm;
    const fields = Object.fromEntries(new FormData(form).entries());
    broadcastBusy = kind;
    broadcastNote = "";
    render();
    try {
      const response = await fetch(kind === "sms" ? "/api/admin/bulk-sms" : "/api/admin/bulk-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not send this broadcast.");
      broadcastNote = `Sent to ${result.recipients} recipients.`;
      broadcastNoteType = "success";
    } catch (error) {
      broadcastNote = error.message;
      broadcastNoteType = "error";
    } finally {
      broadcastBusy = false;
      render();
    }
  }));
  document.querySelector("[data-role-select]")?.addEventListener("change", event => {
    const leader = event.target.value === "cell_leader";
    document.querySelector("[data-cell-picker]").hidden = !leader;
    document.querySelector("[data-permission-picker]").hidden = leader;
    const defaults = ROLE_DEFAULTS[event.target.value] || [];
    document.querySelectorAll("[data-admin-form] input[name='permissions']").forEach(checkbox => {
      checkbox.checked = defaults.includes(checkbox.value);
    });
  });
  document.querySelectorAll("[data-edit-admin]").forEach(button => button.addEventListener("click", () => {
    editingAdminId = button.dataset.editAdmin;
    adminFormError = "";
    render();
  }));
  document.querySelector("[data-cancel-edit-admin]")?.addEventListener("click", () => {
    editingAdminId = null;
    adminFormError = "";
    render();
  });
  document.querySelectorAll("[data-delete-admin]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Remove this admin account?")) return;
    try {
      const response = await fetch(`/api/admin/admins/${button.dataset.deleteAdmin}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not remove this admin.");
      await loadAdmins(true);
    } catch (error) {
      alert(error.message);
    }
  }));
  document.querySelector("[data-admin-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const editingId = form.dataset.editingId;
    const payload = {
      name: formData.get("name"),
      role: formData.get("role"),
      permissions: formData.get("role") === "cell_leader"
        ? formData.getAll("cells").map(cell => `cell:${cell}`)
        : formData.getAll("permissions")
    };
    if (!editingId) {
      payload.email = formData.get("email");
      payload.password = formData.get("password");
    } else {
      const password = formData.get("password");
      if (password) payload.newPassword = password;
      payload.active = formData.get("active") === "on";
    }
    adminFormError = "";
    try {
      const response = await fetch(editingId ? `/api/admin/admins/${editingId}` : "/api/admin/admins", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this admin.");
      editingAdminId = null;
      await loadAdmins(true);
    } catch (error) {
      adminFormError = error.message;
      render();
    }
  });
  if (activeView === "home") initHeroScene();
  if (activeView === "attendance") loadDailyAttendanceCode();
  if (activeView === "profile" && memberProfile === undefined) loadMemberProfile();
  if (activeView === "dashboard") {
    if (adminSession === undefined) loadAdminSession();
    else if (adminSession) {
      if (can("view_dashboard")) loadDashboard();
      if (activeDashboard.startsWith("cell-")) loadCellData();
      if (activeDashboard === "admins") loadAdmins();
      if (activeDashboard === "broadcast") loadBroadcastAudience();
    }
  }
}

async function loadDailyAttendanceCode() {
  const codeCard = document.querySelector("[data-daily-code]");
  if (!codeCard) return;
  try {
    const response = await fetch("/api/daily-attendance-code");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load today's code");
    dailyAttendance = result;
    codeCard.innerHTML = `<span>Today's code</span><strong>${result.code}</strong><small>${result.date}</small>`;
    const input = document.querySelector("[data-attendance-form] input[name='attendanceCode']");
    if (input && !input.value) input.value = result.code;
  } catch (error) {
    codeCard.innerHTML = `<span>Today's code</span><strong>Unavailable</strong><small>${error.message}</small>`;
  }
}

// The preview shows, in order: a newly picked photo, the photo already on
// file (the profile editor passes it as `existing`), or a camera icon.
function photoPickerInner(target, existing = "") {
  const shown = photoDrafts[target] || existing;
  return `
    <span class="photo-preview">${shown ? `<img src="${escapeHtml(shown)}" alt="Selected photo" />` : icon("camera")}</span>
    <span class="photo-copy">
      <strong>${photoBusy[target] ? "Preparing photo..." : shown ? "Change photo" : "Add a photo"}</strong>
      <small>A clear, recent picture of your face. JPEG or PNG.</small>
    </span>
  `;
}

function photoPicker(target, label, existing = "") {
  return `
    <div class="photo-field">
      <span>${label}</span>
      <label class="photo-picker ${photoDrafts[target] || existing ? "has-photo" : ""}" data-photo-existing="${escapeHtml(existing)}">
        <input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-photo-input="${target}" />
        <span class="photo-picker-inner">${photoPickerInner(target, existing)}</span>
      </label>
    </div>
  `;
}

function updatePhotoPicker(form, target) {
  const picker = form.querySelector(".photo-picker");
  const existing = picker.dataset.photoExisting || "";
  picker.classList.toggle("has-photo", Boolean(photoDrafts[target] || existing));
  picker.querySelector(".photo-picker-inner").innerHTML = photoPickerInner(target, existing);
}

async function choosePhoto(input) {
  const form = input.form;
  const target = input.dataset.photoInput;
  const note = form.querySelector(".form-note");
  const file = input.files?.[0];
  if (!file) return;
  photoBusy[target] = true;
  updatePhotoPicker(form, target);
  try {
    photoDrafts[target] = await preparePhoto(file);
    note.className = "form-note";
    note.textContent = "Photo added.";
  } catch (error) {
    note.className = "form-note error";
    note.textContent = error.message;
  } finally {
    photoBusy[target] = false;
    input.value = "";
    updatePhotoPicker(form, target);
  }
}

async function saveBirthday(form) {
  const note = form.querySelector(".form-note");
  const button = form.querySelector("button[type='submit']");
  const fields = Object.fromEntries(new FormData(form).entries());
  delete fields.photo;
  const showError = message => {
    note.className = "form-note error";
    note.textContent = message;
  };
  if (!fields.fullName.trim()) return showError("Please enter your full name.");
  if (fields.phoneNumber.replace(/\D/g, "").length < 7) return showError("Please enter a valid phone number.");
  if (!fields.dateOfBirth) return showError("Please enter your date of birth.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.emailAddress || "")) return showError("Please enter a valid email address.");
  if (photoBusy.birthday) return showError("Your photo is still being prepared. Please wait a moment.");
  if (!photoDrafts.birthday) return showError("Please add a photo of yourself.");
  if (!fields.photoConsent) return showError("Please tick the box to confirm we may share your photo on your birthday.");
  const submissionId = form.dataset.submissionId || crypto.randomUUID();
  form.dataset.submissionId = submissionId;
  note.className = "form-note";
  note.textContent = "Sending...";
  button.disabled = true;
  try {
    const result = await postOrQueue("/api/birthdays", { ...fields, photo: photoDrafts.birthday, submissionId }, "Birthday details");
    const firstName = fields.fullName.trim().split(/\s+/)[0];
    form.reset();
    delete form.dataset.submissionId;
    photoDrafts.birthday = "";
    updatePhotoPicker(form, "birthday");
    dashboardData = null;
    if (memberProfile) loadMemberProfile();
    note.className = "form-note success";
    note.textContent = result.queued
      ? QUEUED_NOTE
      : result.updated
      ? `Thanks, ${firstName}! Your birthday details have been updated.`
      : `Thank you, ${firstName}! We look forward to celebrating you on ${birthdayLabel(fields.dateOfBirth)}.`;
    if (!result.queued) showWelcome("birthday", fields, result.record);
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
  }
}

function setMemberNote(text, type = "") {
  memberNote = text;
  memberNoteType = type;
}

async function memberRequest(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}

async function loadMemberProfile() {
  if (memberChecking) return;
  memberChecking = true;
  try {
    const response = await fetch("/api/member/me");
    memberProfile = (await response.json()).profile || null;
  } catch {
    memberProfile = null;
  } finally {
    memberChecking = false;
    if (activeView === "profile") render();
    else updateMemberButtons();
  }
}

function memberButtonLabel() {
  return memberProfile ? "My Profile" : "Sign In";
}

function updateMemberButtons() {
  document.querySelectorAll("[data-member-label]").forEach(element => {
    element.textContent = memberButtonLabel();
  });
}

async function requestMemberCode() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(memberEmail)) {
    setMemberNote("Please enter a valid email address.", "error");
    render();
    return;
  }
  memberBusy = true;
  setMemberNote("");
  render();
  try {
    const result = await memberRequest("/api/member/request-code", { email: memberEmail });
    memberStep = "code";
    setMemberNote(result.message, "success");
  } catch (error) {
    setMemberNote(error.message, "error");
  } finally {
    memberBusy = false;
    render();
    document.querySelector("[data-member-code-form] input[name='code']")?.focus();
  }
}

async function verifyMemberCode(code) {
  memberBusy = true;
  setMemberNote("");
  render();
  try {
    const result = await memberRequest("/api/member/verify", { email: memberEmail, code });
    memberProfile = result.profile;
    memberStep = "email";
    // A brand-new profile has no name yet; open the editor straight away.
    memberEditing = !memberProfile.name;
    setMemberNote(memberEditing ? "Welcome! Add your name and photo to finish your profile." : "", "success");
  } catch (error) {
    setMemberNote(error.message, "error");
  } finally {
    memberBusy = false;
    render();
  }
}

async function saveMemberProfile(form) {
  // Errors are shown in place rather than through render(), which would
  // rebuild the form and throw away what the member just typed.
  const note = form.querySelector(".form-note");
  const button = form.querySelector("button[type='submit']");
  const showError = message => {
    note.className = "form-note error";
    note.textContent = message;
  };
  const fields = Object.fromEntries(new FormData(form).entries());
  delete fields.photo;
  if (!fields.fullName.trim()) return showError("Please enter your full name.");
  if (photoBusy.member) return showError("Your photo is still being prepared. Please wait a moment.");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const result = await memberRequest("/api/member/profile", { ...fields, photo: photoDrafts.member || undefined });
    memberProfile = result.profile;
    photoDrafts.member = "";
    memberEditing = false;
    dashboardData = null;
    setMemberNote("Your profile has been updated.", "success");
    render();
  } catch (error) {
    if (/sign in again/i.test(error.message)) {
      memberProfile = null;
      setMemberNote(error.message, "error");
      render();
      return;
    }
    showError(error.message);
    button.disabled = false;
    button.textContent = "Save Changes";
  }
}

async function signOutMember() {
  try {
    await memberRequest("/api/member/logout");
  } catch {
    // the local session is cleared regardless
  }
  memberProfile = null;
  memberEditing = false;
  memberStep = "email";
  photoDrafts.member = "";
  setMemberNote("You've been signed out.", "success");
  render();
}

async function saveAttendance(form) {
  const note = form.querySelector(".form-note");
  const button = form.querySelector("button[type='submit']");
  const fields = Object.fromEntries(new FormData(form).entries());
  note.className = "form-note";
  note.textContent = "Saving attendance...";
  if (button) button.disabled = true;
  try {
    const result = await postOrQueue("/api/attendance", { ...fields, submissionId: crypto.randomUUID() }, "Attendance check-in");
    dashboardData = null;
    form.reset();
    if (dailyAttendance?.code) form.attendanceCode.value = dailyAttendance.code;
    note.className = "form-note success";
    note.textContent = result.queued ? `${QUEUED_NOTE} Today's code only works today, so reconnect before the day ends.` : "Attendance saved to the dashboard.";
  } catch (error) {
    note.className = "form-note error";
    note.textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
}

// ---- Installable app ---------------------------------------------------

function toast(message, type = "") {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.setAttribute("role", "status");
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.classList.add("hide"), 6000);
  setTimeout(() => element.remove(), 6600);
}

async function sendSavedForms() {
  const { sent, failed } = await flushOutbox().catch(() => ({ sent: [], failed: [] }));
  if (sent.length) {
    toast(sent.length === 1 ? `Back online: your ${sent[0].label.toLowerCase()} has been sent.` : `Back online: ${sent.length} saved forms have been sent.`, "success");
  }
  failed.forEach(item => toast(`Your saved ${item.label.toLowerCase()} couldn't be sent: ${item.error}`, "error"));
}

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
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const userAgent = navigator.userAgent;
const isAppleMobile = () => /iphone|ipad|ipod/i.test(userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(userAgent);
const isInAppBrowser = () => /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Snapchat|TikTok|musical_ly|; wv\)/i.test(userAgent);
const INSTALL_DISMISS_KEY = "ha-install-dismissed";
const INSTALL_DISMISS_DAYS = 14;
let deferredInstall = null;

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

function closeMenuIfOpen() {
  if (!menuOpen) return;
  menuOpen = false;
  document.querySelector(".navlinks")?.classList.remove("open");
}

// ---- Pop-up dialogs (welcome, submission editor) ----

// Appends a dialog to <body> (outside the re-rendered app) and returns a
// function that closes it. Clicking the dim backdrop or any [data-close]
// element closes it too.
function openDialog(innerHtml, className = "") {
  const modal = document.createElement("div");
  modal.className = "form-modal";
  modal.innerHTML = `
    <div class="form-modal-panel ${className}" role="dialog" aria-modal="true">
      <button class="form-modal-close" type="button" aria-label="Close" data-close>&times;</button>
      ${innerHtml}
    </div>
  `;
  const close = () => {
    modal.remove();
    document.body.classList.remove("modal-open");
  };
  modal.addEventListener("click", event => {
    if (event.target === modal || event.target.closest("[data-close]")) close();
  });
  document.body.appendChild(modal);
  document.body.classList.add("modal-open");
  return { modal, close };
}

// What to say after each kind of form. Community and workforce signups are
// welcomed into the specific group they chose.
function welcomeContent(type, fields) {
  const firstName = String(fields.fullName || fields.name || "").trim().split(/\s+/)[0];
  const hello = firstName ? `${firstName}, welcome` : "Welcome";
  if (type === "community") {
    const group = fields.preferredCommunity || "the community";
    const description = communities.find(([name]) => name === group)?.[1] || "";
    const isCell = /cell$/i.test(group);
    return {
      icon: "users",
      title: `${hello} to ${group}!`,
      message: `${description} ${isCell
        ? "Your cell leader will reach out with details of your next cell meeting."
        : "Someone from the group will reach out soon about how to get involved."}`,
      extra: "We're so glad you're part of the Harvesters Akure family."
    };
  }
  if (type === "workforce") {
    const team = fields.department || "Workforce";
    return {
      icon: "briefcase",
      title: `${hello} to the ${team} team!`,
      message: `Thank you for choosing to serve. The ${team} team lead will contact you about training and next steps.`,
      extra: "Together we're building something powerful in Akure."
    };
  }
  if (type === "birthday") {
    return {
      icon: "cake",
      title: `${hello} to our birthday family!`,
      message: `We'll celebrate you on ${birthdayLabel(fields.dateOfBirth)}. Look out for your birthday shout-out!`,
      extra: "Every year of your life is a reason to give thanks."
    };
  }
  return {
    counselling: { icon: "heart", title: "We've received your request", message: "A member of our pastoral team will reach out to you at your preferred time. You are not alone, and we're here for you.", extra: "" },
    partnership: { icon: "heart", title: "Thank you for partnering with us!", message: "Our partnership team will contact you about how we can work together for the Akure launch.", extra: "Your support makes a real difference." },
    giving: { icon: "heart", title: "Thank you for your generosity!", message: "Your pledge has been recorded. The finance team may reach out to confirm the details.", extra: "God loves a cheerful giver." },
    nlp: { icon: "calendar", title: `${hello} to Next Level Prayers!`, message: "You'll receive prayer updates and reminders. Join us daily at 6:30 AM.", extra: "" },
    contact: { icon: "mail", title: "Message received", message: "Thank you for reaching out. Someone from the Harvesters Akure team will get back to you shortly.", extra: "" },
    content: { icon: "check", title: "Thank you for sharing!", message: "The media team will review your content idea or upload.", extra: "" }
  }[type] || { icon: "check", title: "Thank you!", message: "Your details have been saved.", extra: "" };
}

function showWelcome(type, fields, record) {
  const content = welcomeContent(type, fields);
  const code = record ? record.shortCode || recordCode(record) : "";
  const email = fields.emailAddress || fields.email || "";
  const offerProfile = email && !memberProfile;
  const { modal, close } = openDialog(`
    <div class="welcome-card">
      <span class="welcome-icon">${icon(content.icon)}</span>
      <h3>${escapeHtml(content.title)}</h3>
      <p>${escapeHtml(content.message)}</p>
      ${content.extra ? `<p class="muted">${escapeHtml(content.extra)}</p>` : ""}
      ${code ? `<p class="welcome-code">Your reference: <strong>${escapeHtml(code)}</strong></p>` : ""}
      <div class="welcome-actions">
        <button class="btn primary" type="button" data-close>Done</button>
        ${offerProfile ? `<button class="btn outline" type="button" data-welcome-profile>See my profile</button>` : ""}
      </div>
    </div>
  `, "welcome-panel");
  modal.querySelector("[data-welcome-profile]")?.addEventListener("click", () => {
    close();
    memberEmail = email;
    memberStep = "email";
    navigate("profile");
  });
}

function welcomeAfterSubmit(form, type, fields, record) {
  if (type === "newsletter") {
    toast("You're subscribed! Launch updates will come to your inbox.", "success");
    return;
  }
  // Signups made inside the community/department pop-up: close it first.
  if (form.closest(".form-modal") && selectedChoice[type] !== undefined) {
    selectedChoice[type] = "";
    render();
  }
  showWelcome(type, fields, record);
}

// Admin editor for any submitted form. Shows every text field on the record
// (photos, sign-in data and cell-report lists are edited elsewhere).
const NON_EDITABLE_FIELDS = ["name", "photoPath", "photoType", "photoConsent", "communicationsConsent", "signInCode", "lastSignInAt", "present", "absent", "visitors"];

function fieldLabel(key) {
  const text = key.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function editorInput(key, value) {
  const name = `field:${key}`;
  const safe = escapeHtml(value);
  const select = (options, current) => {
    const list = options.includes(current) || !current ? options : [current, ...options];
    return `<select name="${name}"><option value="">-</option>${list.map(option => `<option value="${escapeHtml(option)}" ${option === current ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
  };
  if (key === "preferredCommunity") return select(communities.map(([group]) => group), value);
  if (key === "department") return select(departments, value);
  if (key === "wouldYouLikeToLead") return select(["Yes", "No"], value);
  if (/date$|^dateOf/i.test(key) && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `<input type="date" name="${name}" value="${safe}" />`;
  if (/message|notes?|experience|description/i.test(key) || String(value).length > 70) return `<textarea name="${name}" rows="3">${safe}</textarea>`;
  return `<input name="${name}" value="${safe}" />`;
}

function showSubmissionEditor(record) {
  const entries = Object.entries(record.fields).filter(([key, value]) => !NON_EDITABLE_FIELDS.includes(key) && (typeof value === "string" || typeof value === "number"));
  const { modal, close } = openDialog(`
    <form class="form submission-editor" data-submission-editor>
      <h3>Edit ${escapeHtml(SUBMISSION_LABELS[record.type] || record.type)} &middot; ${escapeHtml(recordCode(record))}</h3>
      ${entries.map(([key, value]) => `<label><span>${escapeHtml(fieldLabel(key))}</span>${editorInput(key, String(value))}</label>`).join("")}
      <label><span>Status</span><input name="status" value="${escapeHtml(record.status || "")}" /></label>
      <div class="inline-actions">
        <button class="btn primary" type="submit">Save Changes</button>
        <button class="btn ghost-dark" type="button" data-close>Cancel</button>
      </div>
      <p class="form-note"></p>
    </form>
  `, "editor-panel");
  const form = modal.querySelector("form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(form);
    const fields = {};
    for (const [key, value] of data.entries()) {
      if (key.startsWith("field:")) fields[key.slice(6)] = String(value).trim();
    }
    // Some records keep a copy of the name in "name"; keep it in step.
    if ("fullName" in fields && "name" in record.fields) fields.name = fields.fullName;
    const note = form.querySelector(".form-note");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    note.className = "form-note";
    note.textContent = "Saving...";
    try {
      const response = await fetch(`/api/admin/submissions/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: String(data.get("status") || ""), fields })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not save these changes.");
      dashboardData = result.dashboard;
      close();
      toast("Changes saved.", "success");
      render();
    } catch (error) {
      note.className = "form-note error";
      note.textContent = error.message;
      button.disabled = false;
    }
  });
}

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

async function installApp() {
  closeMenuIfOpen();
  hideInstallBanner();
  if (!deferredInstall) {
    showInstallSteps();
    return;
  }
  deferredInstall.prompt();
  const choice = await deferredInstall.userChoice.catch(() => null);
  deferredInstall = null;
  if (choice?.outcome === "dismissed") rememberInstallDismissed();
}

function updateInstallButtons() {
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

function hideInstallBanner() {
  document.querySelector(".install-banner")?.remove();
}

function showInstallBanner() {
  if (isStandalone() || installRecentlyDismissed() || activeView === "dashboard" || document.querySelector(".install-banner")) return;
  const direct = Boolean(deferredInstall);
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

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstall = event;
  updateInstallButtons();
  setTimeout(showInstallBanner, 2500);
});

// Browsers that never send beforeinstallprompt (iPhone, in-app browsers)
// still get the pop-up, offering the written steps instead.
if (!isStandalone() && (isAppleMobile() || isInAppBrowser())) {
  setTimeout(showInstallBanner, 4000);
}

window.addEventListener("appinstalled", () => {
  deferredInstall = null;
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
if (memberProfile === undefined) loadMemberProfile();
