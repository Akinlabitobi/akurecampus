import { communityOf, departmentOf } from "../../lib/communities.js";
import { pipeline } from "../../lib/constants.js";
import { money, recordCode, sortByFields } from "../../lib/format.js";
import { ROLE_LABELS, can } from "../../lib/permissions.js";
import { state } from "../../lib/state.js";
import { adminsTab } from "./admins.js";
import { birthdaysTab } from "./birthdays.js";
import { broadcastTab } from "./broadcast.js";
import { cellAttendanceTab, cellReportsTab } from "./cells.js";
import { membersTab } from "./members.js";

export function adminArea() {
  if (state.adminSession === undefined) return `<section class="dashboard-shell single"><div class="panel"><h3>Checking session...</h3></div></section>`;
  if (!state.adminSession) return loginView();
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
          ${state.loginError ? `<p class="form-note error">${state.loginError}</p>` : ""}
          <button class="btn primary block" type="submit" ${state.loginSubmitting ? "disabled" : ""}>${state.loginSubmitting ? "Signing in..." : "Sign In"}</button>
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
  const cellTabs = full || state.adminSession.role === "cell_leader";
  const tabs = [
    ["overview", "Overview", full],
    ["members", "Members", full],
    ["communities", "Communities", full],
    ["cell-attendance", "Cell Attendance", cellTabs],
    ["cell-reports", "Cell Reports", cellTabs],
    ["cell-leaders", "Cell Leaders", full],
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
  if (!tabs.some(([id]) => id === state.activeDashboard)) state.activeDashboard = tabs[0]?.[0] || "overview";
  return `
    <section class="dashboard-shell">
      <aside>
        <img src="/logo-white.png" alt="Harvesters Akure" />
        <span>Launch Command</span>
        ${tabs.map(([id, label]) => `<button class="${state.activeDashboard === id ? "active" : ""}" data-dash="${id}">${label}</button>`).join("")}
        <div class="admin-identity">
          <strong>${state.adminSession.name}</strong>
          <small>${ROLE_LABELS[state.adminSession.role] || state.adminSession.role}</small>
          <button class="btn ghost small" data-logout type="button">Sign Out</button>
        </div>
      </aside>
      <section class="dashboard-main">
        <header>
          <div>
            <span class="label">Dashboard</span>
            <h1>${tabs.find(([id]) => id === state.activeDashboard)?.[1] || "Overview"}</h1>
          </div>
          ${can("export_data") && !state.activeDashboard.startsWith("cell-") ? `<button class="btn primary" data-export>${state.activeDashboard === "communities" ? "Export Communities CSV" : state.activeDashboard === "workforce" ? "Export Workforce CSV" : state.activeDashboard === "birthdays" ? "Export Birthdays CSV" : "Export CSV"}</button>` : ""}
        </header>
        ${state.adminSession.mustChangePassword ? passwordNudge() : ""}
        ${dashboardContent()}
      </section>
    </section>
  `;
}

function dashboardContent() {
  if (state.activeDashboard === "cell-attendance") return cellAttendanceTab();
  if (state.activeDashboard === "cell-reports") return cellReportsTab();
  if (state.activeDashboard === "broadcast") return broadcastTab();
  if (state.activeDashboard === "admins") return adminsTab();
  if (!state.dashboardData) {
    return `<div class="panel"><h3>Loading live dashboard...</h3><p class="muted">Reading submissions from the local database.</p></div>`;
  }
  if (state.dashboardData.error) {
    return `<div class="panel"><h3>Dashboard API unavailable</h3><p class="muted">${state.dashboardData.error}. Start the API with npm run api or run the production server with npm start.</p></div>`;
  }
  const { metrics, submissions, recent, launchItems } = state.dashboardData;
  if (state.activeDashboard === "overview") {
    const liveCards = [
      ["Community Signups", metrics.community, "live database", "People who have registered interest in a Harvesters Akure community."],
      ["Workforce Leads", metrics.workforce, "live database", "Launch team applicants by department and readiness."],
      ["Giving Pledges", money(metrics.giving), `${metrics.fundsPercent}% target`, "Giving pledges recorded through the giving form."],
      ["Attendance", metrics.attendance, "daily-code check-ins", `Today's attendance code: ${state.dashboardData.dailyAttendance?.code || "-"}.`]
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
  if (state.activeDashboard === "communities") {
    // Includes workforce signups who also picked a small group; their
    // community-form-only columns (area, wants to lead) are blank.
    const records = sortByFields(submissions.filter(row => communityOf(row)), [
      row => communityOf(row),
      row => row.fields.fullName
    ]);
    const own = (row, key) => (row.type === "community" && row.fields[key]) || "-";
    const rows = records.map(row => [recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || "-", row.fields.emailAddress || "-", communityOf(row), own(row, "areaInAkure"), own(row, "wouldYouLikeToLead"), departmentOf(row) || "-", row.type === "community" ? "Community form" : "Workforce form", new Date(row.createdAt).toLocaleDateString()]);
    return `${editableTable(["Code", "Name", "Phone", "Email", "Community", "Area", "Wants to Lead", "Workforce Team", "Signed Up Via", "Date"], rows, records)}`;
  }
  if (state.activeDashboard === "workforce") {
    // Includes community signups who also picked a workforce team.
    const records = sortByFields(submissions.filter(row => departmentOf(row)), [
      row => departmentOf(row),
      row => row.fields.fullName
    ]);
    const own = (row, key) => (row.type === "workforce" && row.fields[key]) || "-";
    const rows = records.map(row => [recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || "-", row.fields.emailAddress || "-", departmentOf(row), own(row, "relevantExperience"), own(row, "wouldYouLikeToLead"), communityOf(row) || "-", row.type === "workforce" ? "Workforce form" : "Community form", row.status]);
    return `${editableTable(["Code", "Name", "Phone", "Email", "Department", "Experience", "Wants to Lead", "Small Group", "Signed Up Via", "Status"], rows, records)}`;
  }
  if (state.activeDashboard === "cell-leaders") {
    const records = sortByFields(submissions.filter(row => row.type === "cell_lead"), [
      row => row.fields.preferredCell,
      row => row.fields.fullName
    ]);
    const rows = records.map(row => [recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || "-", row.fields.emailAddress || "-", row.fields.areaInAkure || "-", row.fields.preferredCell || "-", row.fields.preferredMeetingDay || "-", row.fields.leadershipExperience || "-", row.fields.whyDoYouWantToLead || "-", row.status, new Date(row.createdAt).toLocaleDateString()]);
    return `<div class="metric-grid"><article class="metric large"><span>Cell Leader Applications</span><strong>${records.length}</strong><small>from the Lead a Cell form</small></article></div>${editableTable(["Code", "Name", "Phone", "Email", "Area", "Cell", "Meeting Day", "Experience", "Why Lead", "Status", "Date"], rows, records)}`;
  }
  if (state.activeDashboard === "attendance") {
    const records = submissions.filter(row => row.type === "attendance");
    const rows = records.map(row => [row.fields.name || "-", row.fields.attendanceCode || row.fields.shortCode || "-", row.fields.phone || "-", row.fields.department || "-", row.fields.service || "-", new Date(row.createdAt).toLocaleString()]);
    return `<div class="metric-grid"><article class="metric large"><span>Today's Code</span><strong>${state.dashboardData.dailyAttendance?.code || "-"}</strong><small>${state.dashboardData.dailyAttendance?.date || ""}</small></article><article class="metric large"><span>Total Check-Ins</span><strong>${metrics.attendance}</strong><small>attendance records</small></article></div>${editableTable(["Name", "Code", "Phone", "Department", "Service", "Time"], rows, records)}`;
  }
  if (state.activeDashboard === "birthdays") return birthdaysTab(submissions);
  if (state.activeDashboard === "members") return membersTab(submissions);
  if (state.activeDashboard === "giving") {
    const records = submissions.filter(row => ["giving", "partnership"].includes(row.type));
    const rows = records.map(row => [row.type, recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || "-", row.fields.fund || row.fields.partnershipType || "-", row.fields.amount ? money(row.fields.amount) : "-", new Date(row.createdAt).toLocaleDateString()]);
    return `<div class="metric-grid"><article class="metric large"><span>Total Giving</span><strong>${money(metrics.giving)}</strong><small>${metrics.fundsPercent}% funded</small></article><article class="metric large"><span>Partners</span><strong>${metrics.partnership}</strong><small>active interest</small></article></div>${editableTable(["Type", "Code", "Name", "Phone", "Category", "Amount", "Date"], rows, records)}`;
  }
  if (state.activeDashboard === "care") {
    const records = submissions.filter(row => ["counselling", "nlp", "contact"].includes(row.type));
    const rows = records.map(row => [row.type, recordCode(row), row.fields.fullName || "-", row.fields.phoneNumber || row.fields.emailAddress || "-", row.fields.careArea || row.fields.prayerFocus || row.fields.subject || "-", row.status]);
    return `${editableTable(["Type", "Code", "Name", "Contact", "Category", "Status"], rows, records)}`;
  }
  if (state.activeDashboard === "newsletter") {
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
  const editingItem = state.editingLaunchItemId ? launchItems.find(item => item.id === state.editingLaunchItemId) : null;
  const rows = submissions.filter(row => row.type === "content").map(row => [row.fields.fullName || "-", row.fields.subject || "Content idea", row.fields.message || "-", new Date(row.createdAt).toLocaleDateString()]);
  return `
    <div class="table"><table><thead><tr>${launchHeaders.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${launchRows}</tbody></table></div>
    ${canManageContent ? launchItemForm(editingItem) : ""}
    <div class="table section-table">${table(["Name", "Title", "Note", "Date"], rows)}</div>
  `;
}

export function editableTable(headers, rows, records) {
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

export function table(headers, rows) {
  const body = rows.length
    ? rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}">No records yet.</td></tr>`;
  return `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}
