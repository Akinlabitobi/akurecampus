import * as THREE from "three";
import { externalLinks } from "./config.js";

const navItems = [
  ["home", "Home"],
  ["about", "About"],
  ["communities", "Communities"],
  ["nlp", "NLP"],
  ["giving", "Giving"],
  ["counselling", "Counselling"],
  ["workforce", "Workforce"],
  ["partnership", "Partnership"],
  ["attendance", "Attendance"],
  ["gallery", "Gallery"],
  ["contact", "Contact"]
];

// Deep-linkable views, via a URL hash (e.g. #admin) rather than a real path
// -- the hash never reaches the server, so it works identically in dev and
// production with no CDN/routing configuration needed. "admin" is the
// friendly public name for the "dashboard" view.
const HASH_ALIASES = { admin: "dashboard" };
const VALID_VIEWS = [...navItems.map(([id]) => id), "dashboard"];

function viewFromHash() {
  const raw = window.location.hash.replace(/^#/, "");
  const view = HASH_ALIASES[raw] || raw;
  return VALID_VIEWS.includes(view) ? view : "home";
}

function hashForView(view) {
  return view === "dashboard" ? "admin" : view;
}

const stats = [
  ["12+", "Communities"],
  ["18", "Departments"],
  ["7", "Partnership Types"],
  ["1", "Akure Campus"]
];

const communities = [
  ["Young Adults", "Career builders, students, creatives, and entrepreneurs growing together."],
  ["Married Couples", "A warm circle for couples building faith, family, and friendship."],
  ["Men of Purpose", "Men sharpening one another through prayer, service, and accountability."],
  ["Women of Grace", "Women walking in wisdom, strength, leadership, and devotion."],
  ["Teens", "A safe, energetic space for teenagers to encounter God and grow boldly."],
  ["Prayer Circle", "Intercessors covering the campus, city, leaders, and launch team."]
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
  viewer: ["view_dashboard"]
};
const PERMISSION_LABELS = {
  view_dashboard: "View dashboard",
  edit_submissions: "Edit submissions",
  delete_submissions: "Delete submissions",
  manage_content: "Manage launch items",
  send_broadcasts: "Send SMS/email broadcasts",
  manage_admins: "Manage admin accounts",
  export_data: "Export data (CSV)"
};

const app = document.querySelector("#app");
let activeView = viewFromHash();
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

function icon(name) {
  const paths = {
    arrow: '<path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>',
    heart: '<path d="M2 9.5a5.5 5.5 0 0 1 9.6-3.7.6.6 0 0 0 .8 0A5.5 5.5 0 0 1 22 9.5c0 2.3-1.5 4-3 5.5l-5.5 5.3a2 2 0 0 1-3 0L5 15c-1.5-1.5-3-3.2-3-5.5"></path>',
    briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path><rect x="2" y="6" width="20" height="14" rx="2"></rect>',
    menu: '<path d="M4 5h16"></path><path d="M4 12h16"></path><path d="M4 19h16"></path>',
    map: '<path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m22 7-9 5.7a2 2 0 0 1-2 0L2 7"></path>',
    phone: '<path d="M13.8 16.6a1 1 0 0 0 1.2-.3l.4-.5A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.5.4a1 1 0 0 0-.3 1.2 14 14 0 0 0 6.4 6.4"></path>',
    chart: '<path d="M3 3v18h18"></path><path d="m7 15 4-4 3 3 5-7"></path>',
    calendar: '<path d="M8 2v4"></path><path d="M16 2v4"></path><rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M3 10h18"></path>',
    check: '<path d="M20 6 9 17l-5-5"></path>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
}

function navigate(view, options = {}) {
  activeView = view;
  menuOpen = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (!options.skipHash) {
    const hash = hashForView(view);
    if ((window.location.hash.replace(/^#/, "") || "") !== hash) {
      window.location.hash = hash === "home" ? "" : hash;
    }
  }
  render();
}

window.addEventListener("hashchange", () => {
  navigate(viewFromHash(), { skipHash: true });
});

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
  try {
    const response = await fetch(`/api/admin/submissions/${id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not delete this record.");
    dashboardData = result.dashboard;
    render();
  } catch (error) {
    alert(error.message);
  }
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

function shell(content) {
  return `
    <nav class="topbar">
      <a class="brand" href="#" data-nav="home" aria-label="Harvesters Akure home">
        <img src="/logo-black.png" alt="Harvesters Akure" />
        <span>Akure</span>
      </a>
      <div class="navlinks ${menuOpen ? "open" : ""}">
        ${navItems.map(([id, label]) => `<button class="${activeView === id ? "active" : ""}" data-nav="${id}">${label}</button>`).join("")}
      </div>
      <div class="actions">
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
          <h1>Come home to worship in Akure.</h1>
          <p>A Harvesters family is gathering in the city for prayer, worship, friendship, service, and spiritual growth.</p>
          <div class="hero-actions">
            <button class="btn primary xl" data-nav="communities">Join Community ${icon("arrow")}</button>
            <button class="btn ghost xl" data-nav="attendance">Mark Attendance</button>
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
    ["Build", "Help prepare the people, systems, and service teams before launch."],
    ["Belong", "Find a community for prayer, friendship, and steady spiritual growth."],
    ["Serve", "Join a department and bring your gifts into the room."]
  ];
  return `
    <section class="home-intro">
      <div class="container intro-grid">
        <div>
          <span class="label">A Real Home Base</span>
          <h2>Simple next steps for a city-wide launch.</h2>
        </div>
        ${items.map(([title, text]) => `
          <article>
            <strong>${title}</strong>
            <p>${text}</p>
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
    gallery: ["Gallery", "A growing archive of launch, worship, outreach, and community moments.", gallerySection() + formPage("Gallery Upload or Content Idea", ["Full name", "Email address", "Subject", "Message"], "content")],
    contact: ["Contact Us", "Reach the Akure launch team and stay updated.", contactPage()]
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

function communityPage() {
  return `
    <section class="section">
      <div class="container card-grid two">
        ${communities.map(([title, text]) => `<article class="card compact"><h3>${title}</h3><p>${text}</p><button class="btn secondary block" data-focus-form>Register Interest</button></article>`).join("")}
      </div>
    </section>
    ${formPage("Community Signup", ["Full name", "Phone number", "Email address", "Preferred community", "Area in Akure", "Date of Birth", "Would you like to lead?"], "community")}
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
        <div class="pill-grid">${departments.map(item => `<button>${item}</button>`).join("")}</div>
      </div>
    </section>
    ${formPage("Workforce Application", ["Full name", "Phone number", "Email address", "Department", "Relevant experience", "Would you like to lead?"], "workforce")}
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
          <label><span>Today's code</span><input name="attendanceCode" placeholder="Example: HA0123" autocomplete="off" /></label>
          <label><span>Full name</span><input name="name" placeholder="Attendee name" /></label>
          <label><span>Phone number</span><input name="phone" placeholder="Phone number" /></label>
          <label><span>Department or group</span><input name="department" placeholder="Optional" /></label>
          <label><span>Service</span><input name="service" value="Sunday Service" /></label>
          <label><span>Note</span><input name="note" data-tall placeholder="Optional note" /></label>
          <button class="btn primary block" type="submit">Save Attendance ${icon("arrow")}</button>
          <p class="form-note">Use the daily code shown on this page or in the dashboard.</p>
        </form>
      </div>
    </section>
  `;
}

function contactPage() {
  return `
    <section class="section">
      <div class="container split">
        <div class="contact-list">
          <div>${icon("map")}<span>Akure, Ondo State, Nigeria</span></div>
          <div>${icon("phone")}<span>+234 000 000 0000</span></div>
          <div>${icon("mail")}<span>akure@harvestersng.org</span></div>
        </div>
        ${formMarkup("Send a Message", ["Full name", "Email address", "Subject", "Message"], "contact")}
      </div>
    </section>
  `;
}

function formPage(title, fields, type) {
  return `<section class="section" id="form"><div class="container narrow">${formMarkup(title, fields, type)}</div></section>`;
}

function formMarkup(title, fields, type) {
  return `
    <form class="form" data-api-form data-form-type="${type}">
      <h3>${title}</h3>
      ${fields.map(field => formField(field, type)).join("")}
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
  const required = dateOfBirth || (["community", "counselling"].includes(type) && ["Full name", "Phone number", "Preferred community", "Area in Akure", "Care area", "Preferred time"].includes(field));
  const tall = field === "Message" || field === "Relevant experience";
  if (leadershipInterest) {
    return `<label><span>${field}</span><select name="${name}"><option value="">Select an option</option><option value="Yes">Yes</option><option value="No">No</option></select></label>`;
  }
  return `<label><span>${field}</span><input name="${name}" type="${dateOfBirth ? "date" : email ? "email" : "text"}" ${tall ? "data-tall" : ""} ${required ? "required" : ""} placeholder="${dateOfBirth ? "" : field}" /></label>`;
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
  const tabs = [
    ["overview", "Overview", true],
    ["communities", "Communities", true],
    ["workforce", "Workforce", true],
    ["attendance", "Attendance", true],
    ["giving", "Giving", true],
    ["care", "Care", true],
    ["newsletter", "Newsletter", true],
    ["content", "Content", true],
    ["broadcast", "Broadcast", can("send_broadcasts")],
    ["admins", "Admins", can("manage_admins")]
  ].filter(([, , visible]) => visible);
  if (!tabs.some(([id]) => id === activeDashboard)) activeDashboard = "overview";
  return `
    <section class="dashboard-shell">
      <aside>
        <img src="/logo-white.png" alt="Harvesters Akure" />
        <span>Launch Command</span>
        ${tabs.map(([id, label]) => `<button class="${activeDashboard === id ? "active" : ""}" data-dash="${id}">${label}</button>`).join("")}
        <div class="admin-identity">
          <strong>${adminSession.name}</strong>
          <small>${adminSession.role}</small>
          <button class="btn ghost small" data-logout type="button">Sign Out</button>
        </div>
      </aside>
      <section class="dashboard-main">
        <header>
          <div>
            <span class="label">Dashboard</span>
            <h1>${tabs.find(([id]) => id === activeDashboard)?.[1] || "Overview"}</h1>
          </div>
          ${can("export_data") ? `<button class="btn primary" data-export>Export CSV</button>` : ""}
        </header>
        ${adminSession.mustChangePassword ? passwordNudge() : ""}
        ${dashboardContent()}
      </section>
    </section>
  `;
}

function dashboardContent() {
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
    const records = submissions.filter(row => row.type === "community");
    const rows = records.map(row => [recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || "-", row.fields.emailAddress || "-", row.fields.preferredCommunity || "-", row.fields.areaInAkure || "-", row.fields.wouldYouLikeToLead || "-", new Date(row.createdAt).toLocaleDateString()]);
    return `<div class="table">${editableTable(["Code", "Name", "Phone", "Email", "Community", "Area", "Wants to Lead", "Date"], rows, records)}</div>`;
  }
  if (activeDashboard === "workforce") {
    const records = submissions.filter(row => row.type === "workforce");
    const rows = records.map(row => [recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || "-", row.fields.emailAddress || "-", row.fields.department || "-", row.fields.relevantExperience || "-", row.fields.wouldYouLikeToLead || "-", row.status]);
    return `<div class="table">${editableTable(["Code", "Name", "Phone", "Email", "Department", "Experience", "Wants to Lead", "Status"], rows, records)}</div>`;
  }
  if (activeDashboard === "attendance") {
    const records = submissions.filter(row => row.type === "attendance");
    const rows = records.map(row => [row.fields.name || "-", row.fields.attendanceCode || row.fields.shortCode || "-", row.fields.phone || "-", row.fields.department || "-", row.fields.service || "-", new Date(row.createdAt).toLocaleString()]);
    return `<div class="metric-grid"><article class="metric large"><span>Today's Code</span><strong>${dashboardData.dailyAttendance?.code || "-"}</strong><small>${dashboardData.dailyAttendance?.date || ""}</small></article><article class="metric large"><span>Total Check-Ins</span><strong>${metrics.attendance}</strong><small>attendance records</small></article></div><div class="table">${editableTable(["Name", "Code", "Phone", "Department", "Service", "Time"], rows, records)}</div>`;
  }
  if (activeDashboard === "giving") {
    const records = submissions.filter(row => ["giving", "partnership"].includes(row.type));
    const rows = records.map(row => [row.type, recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || "-", row.fields.fund || row.fields.partnershipType || "-", row.fields.amount ? money(row.fields.amount) : "-", new Date(row.createdAt).toLocaleDateString()]);
    return `<div class="metric-grid"><article class="metric large"><span>Total Giving</span><strong>${money(metrics.giving)}</strong><small>${metrics.fundsPercent}% funded</small></article><article class="metric large"><span>Partners</span><strong>${metrics.partnership}</strong><small>active interest</small></article></div><div class="table">${editableTable(["Type", "Code", "Name", "Phone", "Category", "Amount", "Date"], rows, records)}</div>`;
  }
  if (activeDashboard === "care") {
    const records = submissions.filter(row => ["counselling", "nlp", "contact"].includes(row.type));
    const rows = records.map(row => [row.type, recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || row.fields.emailAddress || "-", row.fields.careArea || row.fields.prayerFocus || row.fields.subject || "-", row.status]);
    return `<div class="table">${editableTable(["Type", "Code", "Name", "Contact", "Category", "Status"], rows, records)}</div>`;
  }
  if (activeDashboard === "newsletter") {
    const records = submissions.filter(row => row.type === "newsletter");
    const rows = records.map(row => [recordCode(row), row.fields.emailAddress || row.fields.email || "-", new Date(row.createdAt).toLocaleString()]);
    return `<div class="metric-grid"><article class="metric large"><span>Newsletter Signups</span><strong>${metrics.newsletter}</strong><small>footer email opt-ins</small></article></div><div class="table">${editableTable(["Code", "Email", "Date"], rows, records)}</div>`;
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
              ${canEdit ? `<span class="status-editor"><input data-status-input data-id="${record.id}" value="${record.status || ""}" /><button class="btn outline small" type="button" data-save-status="${record.id}">Save</button></span>` : ""}
              ${canDelete ? `<button class="btn danger small" type="button" data-delete-submission="${record.id}">Delete</button>` : ""}
            </td>`
          : "";
        return `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}${actionsCell}</tr>`;
      }).join("")
    : `<tr><td colspan="${head.length}">No records yet.</td></tr>`;
  return `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
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
      <td><span class="badge role-${admin.role}">${admin.role}</span></td>
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
            ${["viewer", "manager", "superadmin"].map(role => `<option value="${role}" ${(editing?.role || "viewer") === role ? "selected" : ""}>${role}</option>`).join("")}
          </select>
        </label>
        <fieldset class="permission-grid">
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
        <form data-api-form data-form-type="newsletter"><input name="emailAddress" type="email" placeholder="Enter your email" /><button class="btn primary">Stay Connected ${icon("arrow")}</button></form>
      </div>
      <div class="footer-main">
        <div><img src="/logo-white.png" alt="Harvesters Akure" /><p>A campus of Harvesters International Christian Centre, coming to Akure.</p></div>
        <div><h4>The Church</h4><button data-nav="about">About Harvesters Akure</button><button data-nav="nlp">Next Level Prayers</button><button data-nav="gallery">Gallery</button></div>
        <div><h4>Get Involved</h4><button data-nav="communities">Join a Community</button><button data-nav="workforce">Join the Workforce</button><button data-nav="partnership">Partner With Us</button></div>
        <div><h4>Contact</h4><p>Akure, Ondo State</p><p>+234 000 000 0000</p><p>akure@harvestersng.org</p><button data-nav="dashboard">Team Dashboard</button><a href="/callcentre/">Outreach Call Centre</a></div>
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
  document.querySelector("[data-export]")?.addEventListener("click", () => {
    window.location.href = "/api/export";
  });
  const menu = document.querySelector("[data-menu]");
  if (menu) menu.addEventListener("click", () => {
    menuOpen = !menuOpen;
    render();
  });
  document.querySelectorAll("[data-api-form]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const note = form.querySelector(".form-note") || document.createElement("p");
    const button = form.querySelector("button[type='submit'], button");
    const fields = Object.fromEntries(new FormData(form).entries());
    if (!fields.name && fields.fullName) fields.name = fields.fullName;
    const submissionId = form.dataset.submissionId || crypto.randomUUID();
    form.dataset.submissionId = submissionId;
    note.className = "form-note";
    note.textContent = "Saving...";
    form.appendChild(note);
    if (button) button.disabled = true;
    try {
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: form.dataset.formType, fields, submissionId })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save submission");
      dashboardData = result.dashboard;
      form.reset();
      delete form.dataset.submissionId;
      note.className = "form-note success";
      note.textContent = result.googleSheet?.synced
        ? `Saved and sent to the team. Short code: ${result.record.shortCode || recordCode(result.record)}.`
        : `Saved. Short code: ${result.record.shortCode || recordCode(result.record)}.`;
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
      permissions: formData.getAll("permissions")
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
  if (activeView === "dashboard") {
    if (adminSession === undefined) loadAdminSession();
    else if (adminSession) {
      loadDashboard();
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

async function saveAttendance(form) {
  const note = form.querySelector(".form-note");
  const button = form.querySelector("button[type='submit']");
  const fields = Object.fromEntries(new FormData(form).entries());
  note.className = "form-note";
  note.textContent = "Saving attendance...";
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save attendance");
    dashboardData = result.dashboard;
    form.reset();
    if (dailyAttendance?.code) form.attendanceCode.value = dailyAttendance.code;
    note.className = "form-note success";
    note.textContent = "Attendance saved to the dashboard.";
  } catch (error) {
    note.className = "form-note error";
    note.textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
}

render();
