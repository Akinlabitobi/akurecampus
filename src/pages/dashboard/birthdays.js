import { icon } from "../../components/icon.js";
import { MONTHS, birthdayLabel, escapeHtml, localDateKey, nextBirthday } from "../../lib/format.js";
import { editableTable } from "./index.js";
import { adminPhotoUrl } from "./members.js";

// Sorted by how soon each birthday comes round, so the people to celebrate
// next are always at the top.
export function birthdaysTab(submissions) {
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
