import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { CELL_PREFIX, COMMUNITY_NAMES } from "./cells.js";
import { adminBroadcastToken } from "./config.js";
import { send } from "./http.js";

export const ALL_PERMISSIONS = [
  "view_dashboard",
  "edit_submissions",
  "delete_submissions",
  "manage_content",
  "send_broadcasts",
  "manage_admins",
  "export_data"
];
export const ROLES = ["superadmin", "manager", "viewer", "cell_leader"];
export const ROLE_DEFAULTS = {
  superadmin: ALL_PERMISSIONS.slice(),
  manager: ["view_dashboard", "edit_submissions", "manage_content", "export_data", "send_broadcasts"],
  viewer: ["view_dashboard"],
  cell_leader: ["cell_reports"]
};

// Checks and normalises the permissions sent for an admin account. Cell
// leaders get only cell access, for at least one real cell; other roles get
// only the standard permissions.
export function cleanPermissions(role, permissions) {
  const list = Array.isArray(permissions) ? permissions.map(String) : [];
  if (role !== "cell_leader") return list.filter(permission => ALL_PERMISSIONS.includes(permission));
  const cells = [...new Set(list
    .filter(permission => permission.startsWith(CELL_PREFIX))
    .map(permission => permission.slice(CELL_PREFIX.length))
    .filter(name => COMMUNITY_NAMES.includes(name)))];
  if (!cells.length) throw new Error("Choose at least one cell for this cell leader.");
  return ["cell_reports", ...cells.map(name => CELL_PREFIX + name)];
}
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const loginAttempts = new Map();

export function randomPassword() {
  return randomBytes(10).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 14) || "ChangeMe1234";
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(String(password || ""), salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function sanitizeAdmin(admin) {
  const { passwordHash, ...rest } = admin;
  return rest;
}

export function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach(pair => {
    const index = pair.indexOf("=");
    if (index < 0) return;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

export function setSessionCookie(res, token) {
  const parts = [`ha_session=${token}`, "HttpOnly", "Path=/", `Max-Age=${SESSION_TTL_MS / 1000}`, "SameSite=Lax"];
  if (process.env.VERCEL) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "ha_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
}

export function createSession(db, adminId) {
  const token = `${randomUUID()}${randomUUID()}`.replace(/-/g, "");
  const session = {
    token,
    adminId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };
  db.sessions.push(session);
  return session;
}

export function getSessionContext(req, db) {
  const token = parseCookies(req.headers.cookie).ha_session;
  if (!token) return null;
  const session = db.sessions.find(item => item.token === token);
  if (!session || new Date(session.expiresAt) <= new Date()) return null;
  const admin = db.admins.find(item => item.id === session.adminId);
  if (!admin || admin.active === false) return null;
  return { admin, session };
}

export function hasPermission(admin, permission) {
  if (!permission) return true;
  if (admin.role === "superadmin") return true;
  return Array.isArray(admin.permissions) && admin.permissions.includes(permission);
}

export function requireAdminSession(req, res, db, permission) {
  const ctx = getSessionContext(req, db);
  if (!ctx) {
    send(res, 401, { error: "Please sign in to continue." });
    return null;
  }
  if (!hasPermission(ctx.admin, permission)) {
    send(res, 403, { error: "Your account does not have permission to do this." });
    return null;
  }
  return ctx;
}

export function requireBroadcastAccess(req, res, db) {
  const ctx = getSessionContext(req, db);
  if (ctx && hasPermission(ctx.admin, "send_broadcasts")) return ctx;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  if (adminBroadcastToken && token === adminBroadcastToken) return { admin: null };
  send(res, 401, { error: "Admin access is required for bulk messaging." });
  return null;
}

export function addAuditLog(db, admin, action, detail = "") {
  db.auditLog.unshift({
    id: randomUUID(),
    adminId: admin?.id || null,
    adminName: admin?.name || "Automation token",
    action,
    detail,
    createdAt: new Date().toISOString()
  });
  db.auditLog = db.auditLog.slice(0, 200);
}

// On Vercel every request reaches the function through Vercel's proxy, so
// the socket address is the proxy's, shared by everyone -- five wrong
// guesses from anywhere locked the account for all. Vercel sets
// x-forwarded-for to the visitor's real address (and overwrites any value a
// visitor sends), so lock per visitor instead.
export function loginAttemptKey(req, email) {
  const visitor = process.env.VERCEL && req.headers["x-forwarded-for"]
    ? String(req.headers["x-forwarded-for"]).split(",")[0].trim()
    : req.socket?.remoteAddress;
  return `${visitor || "unknown"}:${email}`;
}

export function isLoginLocked(key) {
  const entry = loginAttempts.get(key);
  return Boolean(entry?.lockedUntil && entry.lockedUntil > Date.now());
}

export function registerFailedLogin(key) {
  const entry = loginAttempts.get(key) || { count: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.lockedUntil = Date.now() + 15 * 60 * 1000;
    entry.count = 0;
  }
  loginAttempts.set(key, entry);
}

export function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}
