import { communityOf, departmentOf } from "../src/lib/communities.js";
import { makeShortCode } from "./records.js";

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function toCsv(headers, rows) {
  return [headers.map(csvCell).join(","), ...rows.map(row => row.map(csvCell).join(","))].join("\n");
}

function sortByFields(records, getters) {
  return [...records].sort((a, b) => {
    for (const get of getters) {
      const diff = String(get(a) || "").localeCompare(String(get(b) || ""));
      if (diff) return diff;
    }
    return 0;
  });
}

export function csv(items) {
  const headers = ["id", "shortCode", "type", "createdAt", "name", "phone", "email", "service", "category", "amount", "message"];
  const rows = items.map(item => headers.map(key => {
    if (key === "shortCode") return item.shortCode || item.fields.shortCode || makeShortCode(item.id);
    if (key === "name") return item[key] ?? item.fields.fullName ?? item.fields.name ?? "";
    if (key === "phone") return item[key] ?? item.fields.phoneNumber ?? item.fields.phone ?? "";
    if (key === "email") return item[key] ?? item.fields.emailAddress ?? item.fields.email ?? "";
    return item[key] ?? item.fields[key] ?? item.fields[key.replace("category", "preferredCommunity")] ?? "";
  }));
  return toCsv(headers, rows);
}

// Category-specific exports mirror the columns shown in that dashboard tab
// exactly (including the fix above generically applied) and are sorted the
// same way the tab is -- grouped by community/department, not signup time.
export function csvCommunity(items) {
  const sorted = sortByFields(items, [communityOf, record => record.fields.fullName]);
  const own = (record, key) => (record.type === "community" && record.fields[key]) || "";
  const headers = ["Code", "Name", "Phone", "Email", "Community", "Area", "Wants to Lead", "Workforce Team", "Signed Up Via", "Status", "Date"];
  const rows = sorted.map(record => [
    record.shortCode || makeShortCode(record.id),
    record.fields.fullName || "",
    record.fields.phoneNumber || "",
    record.fields.emailAddress || "",
    communityOf(record),
    own(record, "areaInAkure"),
    own(record, "wouldYouLikeToLead"),
    departmentOf(record),
    record.type === "community" ? "Community form" : "Workforce form",
    record.status || "",
    record.createdAt
  ]);
  return toCsv(headers, rows);
}

export function csvWorkforce(items) {
  const sorted = sortByFields(items, [departmentOf, record => record.fields.fullName]);
  const own = (record, key) => (record.type === "workforce" && record.fields[key]) || "";
  const headers = ["Code", "Name", "Phone", "Email", "Department", "Experience", "Wants to Lead", "Small Group", "Signed Up Via", "Status", "Date"];
  const rows = sorted.map(record => [
    record.shortCode || makeShortCode(record.id),
    record.fields.fullName || "",
    record.fields.phoneNumber || "",
    record.fields.emailAddress || "",
    departmentOf(record),
    own(record, "relevantExperience"),
    own(record, "wouldYouLikeToLead"),
    communityOf(record),
    record.type === "workforce" ? "Workforce form" : "Community form",
    record.status || "",
    record.createdAt
  ]);
  return toCsv(headers, rows);
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function birthdayLabel(dateOfBirth) {
  const [, month, day] = String(dateOfBirth || "").split("-").map(Number);
  return month && day ? `${day} ${MONTH_NAMES[month - 1]}` : "";
}

export function csvBirthdays(items, origin) {
  // Grouped by calendar birthday (month, then day), not by birth year, so the
  // export reads as a celebration calendar from January to December.
  const sorted = sortByFields(items, [record => String(record.fields.dateOfBirth || "").slice(5), record => record.fields.fullName]);
  const headers = ["Code", "Name", "Phone", "Birthday", "Date of Birth", "Photo", "Date Added"];
  const rows = sorted.map(record => [
    record.shortCode || makeShortCode(record.id),
    record.fields.fullName || "",
    record.fields.phoneNumber || "",
    birthdayLabel(record.fields.dateOfBirth),
    record.fields.dateOfBirth || "",
    record.fields.photoPath ? `${origin}/api/admin/birthday-photo/${record.id}` : "",
    record.createdAt
  ]);
  return toCsv(headers, rows);
}
