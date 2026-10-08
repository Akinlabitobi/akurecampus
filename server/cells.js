import { COMMUNITIES, communityOf } from "../src/lib/communities.js";
import { hasPermission, requireAdminSession } from "./auth.js";
import { send } from "./http.js";
import { displayName, emailAddress, phoneNumber } from "./records.js";

// A cell leader's cells are stored in their permissions list as
// "cell:<name>" entries -- no extra database column needed.
export const CELL_PREFIX = "cell:";
export const COMMUNITY_NAMES = COMMUNITIES.map(([name]) => name);

// ---- Cell reports ------------------------------------------------------
//
// A cell's members are everyone who joined it, through the Communities page
// or as the small group picked on the workforce form (see communityOf). A cell report
// is one week's meeting: who was present or absent, visitors, topic,
// offering and notes. Cells meet weekly, so there is one report per cell per
// week (Monday to Sunday); saving any date in that week edits it.
//
// Cell leaders only ever reach their own cells' members and reports through
// these routes; they have no view_dashboard permission, so every other admin
// route (all submissions, exports, broadcasts...) refuses them.

export function sameCellName(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function cellsForAdmin(admin, db) {
  if (hasPermission(admin, "view_dashboard")) {
    const inUse = db.submissions.map(communityOf).filter(Boolean);
    return [...new Set([...COMMUNITY_NAMES, ...inUse])];
  }
  if (admin.role !== "cell_leader") return [];
  return (admin.permissions || []).filter(permission => permission.startsWith(CELL_PREFIX)).map(permission => permission.slice(CELL_PREFIX.length));
}

export function requireCellAccess(req, res, db) {
  const ctx = requireAdminSession(req, res, db, null);
  if (!ctx) return null;
  const cells = cellsForAdmin(ctx.admin, db);
  if (!cells.length) {
    send(res, 403, { error: "Your account does not have access to any cells." });
    return null;
  }
  return { ...ctx, cells, seesAll: hasPermission(ctx.admin, "view_dashboard") };
}

// One entry per person: someone who signed up twice keeps their latest record.
export function cellMembers(db, cell) {
  const byPerson = new Map();
  db.submissions
    .filter(record => sameCellName(communityOf(record), cell))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .forEach(record => {
      const phone = String(phoneNumber(record.fields)).replace(/\D/g, "");
      const key = phone.length >= 10 ? phone.slice(-10) : record.id;
      byPerson.set(key, {
        id: record.id,
        name: displayName(record.fields),
        phone: phoneNumber(record.fields),
        email: emailAddress(record.fields),
        joinedAt: record.createdAt
      });
    });
  return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function cellOverview(db, ctx) {
  const reports = db.submissions
    .filter(record => record.type === "cell_report" && ctx.cells.some(cell => sameCellName(cell, record.fields.cell)))
    .sort((a, b) => String(b.fields.meetingDate).localeCompare(String(a.fields.meetingDate)) || new Date(b.createdAt) - new Date(a.createdAt))
    .map(record => ({ id: record.id, createdAt: record.createdAt, updatedAt: record.updatedAt, ...record.fields, week: weekOf(record.fields.meetingDate) }));
  return {
    cells: ctx.cells,
    seesAll: ctx.seesAll,
    members: Object.fromEntries(ctx.cells.map(cell => [cell, cellMembers(db, cell)])),
    reports
  };
}

// The Monday (YYYY-MM-DD) of the week a date falls in.
export function weekOf(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function idList(value, allowed) {
  return Array.isArray(value) ? [...new Set(value.map(String).filter(id => allowed.has(id)))] : [];
}
