import { icon } from "../../components/icon.js";
import { communityOf, departmentOf } from "../../lib/communities.js";
import { birthdayLabel, escapeHtml, initials, recordCode } from "../../lib/format.js";
import { can } from "../../lib/permissions.js";
import { state } from "../../lib/state.js";
import { table } from "./index.js";

// The record "Edit" opens from the member list: their My Profile record if
// they have one, otherwise the most recent thing they submitted.
function primaryRecord(person) {
  return person.records.find(row => row.type === "member") || person.records[person.records.length - 1];
}

export const SUBMISSION_LABELS = {
  community: "Community", workforce: "Workforce", cell_lead: "Cell leader application", birthday: "Birthday", attendance: "Attendance", member: "Profile",
  counselling: "Care request", partnership: "Partnership", giving: "Giving", nlp: "Prayer updates",
  contact: "Message", content: "Content idea", newsletter: "Newsletter"
};
const CONTACT_FIELDS = ["fullName", "name", "phoneNumber", "phone", "emailAddress", "email", "photoPath", "photoType", "photoConsent", "communicationsConsent", "lastSignInAt"];

export function adminPhotoUrl(record) {
  return `/api/admin/birthday-photo/${encodeURIComponent(record.id)}?v=${Date.parse(record.updatedAt || record.createdAt)}`;
}

// One entry per person. Records are joined when they share a phone number
// (last 10 digits) or an email address, transitively -- so someone who gave
// phone + email on the community form and only their phone on the birthday
// form still comes out as one person. This is for the team only; members
// themselves only ever see records under their own verified email.
export function memberDirectory(submissions) {
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
    communities: [...new Set(sorted.map(communityOf).filter(Boolean))],
    departments: [...new Set(sorted.map(departmentOf).filter(Boolean))],
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

export function membersTab(submissions) {
  const people = memberDirectory(submissions);
  const person = state.selectedMemberKey && people.find(item => item.key === state.selectedMemberKey);
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
  state.selectedMemberKey = "";
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
