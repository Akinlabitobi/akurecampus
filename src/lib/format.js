export function fieldName(label) {
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

export function money(value) {
  return `₦${Number(value || 0).toLocaleString("en-NG")}`;
}

export function recordCode(record) {
  return record.shortCode || String(record.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 6).toUpperCase();
}

// Groups a table by one or more fields (e.g. community, then name within
// each community) rather than the default created-at order, so an admin
// scanning the list sees everyone in the same community/department
// together instead of interleaved by signup time.
export function sortByFields(records, getters) {
  return [...records].sort((a, b) => {
    for (const get of getters) {
      const diff = String(get(a) || "").localeCompare(String(get(b) || ""));
      if (diff) return diff;
    }
    return 0;
  });
}

export function formatDate(value) {
  if (!value) return "-";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function initials(name) {
  return escapeHtml(String(name || "?").trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?");
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function birthdayLabel(dateOfBirth) {
  const [, month, day] = String(dateOfBirth || "").split("-").map(Number);
  return month && day ? `${day} ${MONTHS[month - 1]}` : "-";
}

// Days from today until the next birthday (0 = today) and the age being
// turned. 29 February birthdays are celebrated on 28 February in non-leap
// years rather than rolling over to 1 March.
export function nextBirthday(dateOfBirth, today = new Date()) {
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

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, chr => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[chr]);
}
