import { toast } from "../../components/dialogs.js";
import { icon } from "../../components/icon.js";
import { QUEUED_NOTE } from "../../lib/constants.js";
import { MONTHS, escapeHtml, formatDate, localDateKey, money } from "../../lib/format.js";
import { postOrQueue } from "../../lib/offline-queue.js";
import { can } from "../../lib/permissions.js";
import { state } from "../../lib/state.js";
import { render } from "../../render.js";
import { profileCard } from "../profile.js";
import { table } from "./index.js";

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
  return (state.cellData?.reports || []).filter(report => sameCell(report.cell, cell));
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
  return cells.flatMap(cell => (state.cellData.members[cell] || [])
    .map(member => ({ ...member, cell, missed: memberHistory(cell, member.id).missed }))
    .filter(member => member.missed >= 3))
    .sort((a, b) => b.missed - a.missed);
}

function historyDots(marks) {
  if (!marks.length) return `<span class="history-dots muted">No meetings yet</span>`;
  const labels = { P: "Present", A: "Absent", "-": "Not yet a member" };
  return `<span class="history-dots" title="Last ${marks.length} meetings, newest first">${marks.map(mark => `<i class="dot-${mark === "-" ? "none" : mark}" title="${labels[mark]}"></i>`).join("")}</span>`;
}

export function visitorRow(visitor = {}) {
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
  if (!state.cellData) return `<div class="panel"><h3>Loading cells...</h3></div>`;
  if (state.cellData.error) return `<div class="panel"><h3>Couldn't load cell data</h3><p class="muted">${escapeHtml(state.cellData.error)}</p></div>`;
  return "";
}

export function cellAttendanceTab() {
  const notice = cellDataNotice();
  if (notice) return notice;
  const { cells, members } = state.cellData;
  if (cells.length === 1) state.cellChoice = cells[0];
  if (state.cellChoice && !cells.some(cell => sameCell(cell, state.cellChoice))) state.cellChoice = "";
  if (!state.cellDate) state.cellDate = localDateKey(new Date());
  const picker = `
    <div class="panel cell-picker">
      ${cells.length > 1 ? `
        <label><span>Cell</span>
          <select data-cell-select>
            <option value="">Choose a cell...</option>
            ${cells.map(cell => `<option value="${escapeHtml(cell)}" ${sameCell(cell, state.cellChoice) ? "selected" : ""}>${escapeHtml(cell)} (${(members[cell] || []).length})</option>`).join("")}
          </select>
        </label>` : `<div><span class="label">Your cell</span><h3>${escapeHtml(state.cellChoice)}</h3></div>`}
      <label><span>Meeting date</span><input type="date" data-cell-date value="${state.cellDate}" max="${localDateKey(new Date())}" /><small class="muted">Week of ${weekLabel(weekOf(state.cellDate))}</small></label>
    </div>
  `;
  if (!state.cellChoice) return `${picker}<div class="panel"><p class="muted">Choose a cell to take attendance.</p></div>`;

  const roster = members[state.cellChoice] || [];
  // One report per cell per week: picking any day of a reported week opens
  // that week's report for editing.
  const existing = cellReportsFor(state.cellChoice).find(report => report.week === weekOf(state.cellDate));
  const draftKey = `${state.cellChoice}|${weekOf(state.cellDate)}`;
  if (state.cellDraft?.key !== draftKey) {
    state.cellDraft = existing
      ? { key: draftKey, held: existing.held, present: new Set(existing.present), topic: existing.topic, notes: existing.notes, offering: existing.offering ? String(existing.offering) : "", visitors: existing.visitors.map(visitor => ({ ...visitor, addToCell: false })) }
      : { key: draftKey, held: "yes", present: new Set(), topic: "", notes: "", offering: "", visitors: [] };
  }
  const draft = state.cellDraft;
  const held = draft.held === "yes";
  const rows = roster.map(member => {
    const { marks, missed } = memberHistory(state.cellChoice, member.id);
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
    ${existing ? `<p class="form-note">This week's report was already sent${existing.leaderName ? ` by ${escapeHtml(existing.leaderName)}` : ""} (meeting on ${formatDate(existing.meetingDate)}). Saving again updates it${existing.meetingDate !== state.cellDate ? ` and changes the meeting date to ${formatDate(state.cellDate)}` : ""}.</p>` : ""}
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

export function cellReportsTab() {
  const notice = cellDataNotice();
  if (notice) return notice;
  const { cells, members } = state.cellData;
  const scope = state.cellReportFilter && cells.some(cell => sameCell(cell, state.cellReportFilter)) ? [state.cellReportFilter] : cells;
  const reports = state.cellData.reports.filter(report => scope.some(cell => sameCell(cell, report.cell)));
  const report = state.cellReportView && reports.find(item => item.id === state.cellReportView);
  if (report) return cellReportDetail(report, members[report.cell] || []);
  state.cellReportView = "";

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
            ${cells.map(cell => `<option value="${escapeHtml(cell)}" ${sameCell(cell, state.cellReportFilter) ? "selected" : ""}>${escapeHtml(cell)}</option>`).join("")}
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
  const activeCells = scope.filter(cell => (state.cellData.members[cell] || []).length || cellReportsFor(cell).length).length;
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

export function downloadCellReportsCsv() {
  const { cells, members } = state.cellData;
  const scope = state.cellReportFilter ? [state.cellReportFilter] : cells;
  const reports = state.cellData.reports.filter(report => scope.some(cell => sameCell(cell, report.cell)));
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
  link.download = `cell-reports${state.cellReportFilter ? `-${state.cellReportFilter.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export async function submitCellReport(form) {
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
    cell: state.cellChoice,
    meetingDate: state.cellDate,
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
    const result = await postOrQueue("/api/cell/reports", body, `${state.cellChoice} report`);
    if (result.queued) {
      note.className = "form-note success";
      note.textContent = QUEUED_NOTE;
      return;
    }
    state.cellData = result.overview;
    state.cellDraft = null;
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
