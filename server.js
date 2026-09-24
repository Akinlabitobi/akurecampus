import { createServer } from "node:http";
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const dataDir = join(root, "data");
const dbPath = join(dataDir, "database.json");
const distDir = join(root, "dist");
const port = Number(process.env.PORT || 5174);
const googleAppsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL || "";
const googleAppsScriptToken = process.env.GOOGLE_APPS_SCRIPT_TOKEN || "";
const termiiApiKey = process.env.TERMII_API_KEY || "";
const termiiBaseUrl = (process.env.TERMII_BASE_URL || "").replace(/\/$/, "");
const termiiSenderId = process.env.TERMII_SENDER_ID || "";
const termiiChannel = process.env.TERMII_SMS_CHANNEL || "generic";
const termiiEmailConfigurationId = process.env.TERMII_EMAIL_CONFIGURATION_ID || "";
const termiiEmailTemplateId = process.env.TERMII_EMAIL_TEMPLATE_ID || "";
const adminBroadcastToken = process.env.ADMIN_BROADCAST_TOKEN || "";

const ALL_PERMISSIONS = [
  "view_dashboard",
  "edit_submissions",
  "delete_submissions",
  "manage_content",
  "send_broadcasts",
  "manage_admins",
  "export_data"
];
const ROLES = ["superadmin", "manager", "viewer"];
const ROLE_DEFAULTS = {
  superadmin: ALL_PERMISSIONS.slice(),
  manager: ["view_dashboard", "edit_submissions", "manage_content", "export_data", "send_broadcasts"],
  viewer: ["view_dashboard"]
};
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const loginAttempts = new Map();

const defaultDb = {
  submissions: [],
  admins: [],
  sessions: [],
  auditLog: [],
  seed: {
    readiness: 72,
    fundsTarget: 12000000,
    launchItems: [
      { id: randomUUID(), item: "Launch Sunday", type: "Event", status: "Published", due: "Aug 30" },
      { id: randomUUID(), item: "Akure Workforce Form", type: "Form", status: "Live", due: "Aug 21" },
      { id: randomUUID(), item: "First-Time Guest Flow", type: "Automation", status: "Ready", due: "Aug 18" },
      { id: randomUUID(), item: "Giving Campaign", type: "Finance", status: "Review", due: "Aug 24" }
    ]
  }
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

function ensureDb() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(dbPath)) writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2));
}

function randomPassword() {
  return randomBytes(10).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 14) || "ChangeMe1234";
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(String(password || ""), salt, 64);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

function createSeedAdmin() {
  const email = (process.env.ADMIN_EMAIL || "admin@harvestersng.org").toLowerCase();
  const generatedPassword = process.env.ADMIN_PASSWORD ? null : randomPassword();
  const password = process.env.ADMIN_PASSWORD || generatedPassword;
  const admin = {
    id: randomUUID(),
    name: process.env.ADMIN_NAME || "Launch Admin",
    email,
    passwordHash: hashPassword(password),
    role: "superadmin",
    permissions: ALL_PERMISSIONS.slice(),
    active: true,
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
    lastLoginAt: null
  };
  return { admin, generatedPassword };
}

function migrateDb(db) {
  let changed = false;
  if (!Array.isArray(db.submissions)) { db.submissions = []; changed = true; }
  if (!Array.isArray(db.admins)) { db.admins = []; changed = true; }
  if (!Array.isArray(db.sessions)) { db.sessions = []; changed = true; }
  if (!Array.isArray(db.auditLog)) { db.auditLog = []; changed = true; }
  if (!db.seed) { db.seed = { readiness: 72, fundsTarget: 12000000, launchItems: [] }; changed = true; }
  if (!Array.isArray(db.seed.launchItems)) { db.seed.launchItems = []; changed = true; }
  db.seed.launchItems.forEach(item => {
    if (!item.id) { item.id = randomUUID(); changed = true; }
  });
  if (!db.admins.length) {
    const { admin, generatedPassword } = createSeedAdmin();
    db.admins.push(admin);
    changed = true;
    console.log("-".repeat(60));
    console.log("Created the initial Harvesters Akure admin account:");
    console.log(`  Email:    ${admin.email}`);
    if (generatedPassword) {
      console.log(`  Password: ${generatedPassword}`);
      console.log("  (Randomly generated because ADMIN_PASSWORD was not set.");
      console.log("  Save this now, then change it after signing in. It will not be shown again.)");
    } else {
      console.log("  Password: (value of ADMIN_PASSWORD in your environment)");
    }
    console.log("-".repeat(60));
  }
  const activeSessionCount = db.sessions.length;
  db.sessions = db.sessions.filter(session => new Date(session.expiresAt) > new Date());
  if (db.sessions.length !== activeSessionCount) changed = true;
  return changed;
}

function readDb() {
  ensureDb();
  const db = JSON.parse(readFileSync(dbPath, "utf8"));
  if (migrateDb(db)) writeDb(db);
  return db;
}

function writeDb(db) {
  ensureDb();
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function sanitizeAdmin(admin) {
  const { passwordHash, ...rest } = admin;
  return rest;
}

function parseCookies(header) {
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

function setSessionCookie(res, token) {
  const parts = [`ha_session=${token}`, "HttpOnly", "Path=/", `Max-Age=${SESSION_TTL_MS / 1000}`, "SameSite=Lax"];
  if (process.env.VERCEL) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "ha_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
}

function createSession(db, adminId) {
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

function getSessionContext(req, db) {
  const token = parseCookies(req.headers.cookie).ha_session;
  if (!token) return null;
  const session = db.sessions.find(item => item.token === token);
  if (!session || new Date(session.expiresAt) <= new Date()) return null;
  const admin = db.admins.find(item => item.id === session.adminId);
  if (!admin || admin.active === false) return null;
  return { admin, session };
}

function hasPermission(admin, permission) {
  if (!permission) return true;
  if (admin.role === "superadmin") return true;
  return Array.isArray(admin.permissions) && admin.permissions.includes(permission);
}

function requireAdminSession(req, res, db, permission) {
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

function requireBroadcastAccess(req, res, db) {
  const ctx = getSessionContext(req, db);
  if (ctx && hasPermission(ctx.admin, "send_broadcasts")) return ctx;
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  if (adminBroadcastToken && token === adminBroadcastToken) return { admin: null };
  send(res, 401, { error: "Admin access is required for bulk messaging." });
  return null;
}

function addAuditLog(db, admin, action, detail = "") {
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

function loginAttemptKey(req, email) {
  return `${req.socket?.remoteAddress || "unknown"}:${email}`;
}

function isLoginLocked(key) {
  const entry = loginAttempts.get(key);
  return Boolean(entry?.lockedUntil && entry.lockedUntil > Date.now());
}

function registerFailedLogin(key) {
  const entry = loginAttempts.get(key) || { count: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.lockedUntil = Date.now() + 15 * 60 * 1000;
    entry.count = 0;
  }
  loginAttempts.set(key, entry);
}

function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
  if (Buffer.isBuffer(body) || typeof body === "string") {
    res.end(body);
    return;
  }
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function cleanText(value) {
  return String(value ?? "").trim().slice(0, 500);
}

function cleanCode(value) {
  return cleanText(value).replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10);
}

function makeShortCode(id) {
  return cleanCode(id).slice(0, 6);
}

function createShortCode(db) {
  let code = "";
  do {
    code = makeShortCode(randomUUID());
  } while (db.submissions.some(record => (record.shortCode || makeShortCode(record.id)) === code));
  return code;
}

function displayName(fields) {
  return fields.fullName || fields.name || "";
}

function phoneNumber(fields) {
  return fields.phoneNumber || fields.phone || "";
}

function emailAddress(fields) {
  return fields.emailAddress || fields.email || "";
}

function attendeeFromRecord(record) {
  const fields = record.fields || {};
  return {
    id: record.id,
    shortCode: record.shortCode || makeShortCode(record.id),
    sourceType: record.type,
    name: displayName(fields),
    phone: phoneNumber(fields),
    email: emailAddress(fields),
    department: fields.department || fields.preferredCommunity || fields.partnershipType || ""
  };
}

function findByShortCode(db, code) {
  const normalized = cleanCode(code);
  return db.submissions.find(record => (record.shortCode || makeShortCode(record.id)) === normalized);
}

function lagosDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function dailyAttendanceCode(dateKey = lagosDateKey()) {
  const compact = dateKey.replaceAll("-", "");
  let total = 0;
  for (let index = 0; index < compact.length; index++) {
    total += Number(compact[index]) * (index + 3);
  }
  return `HA${String(total % 10000).padStart(4, "0")}`;
}

function dashboard(db) {
  const submissions = db.submissions;
  const byType = type => submissions.filter(item => item.type === type);
  const totalGiving = byType("giving").reduce((sum, item) => sum + Number(item.fields.amount || 0), 0);
  const recent = [...submissions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10);
  const fundsPercent = Math.min(100, Math.round((totalGiving / db.seed.fundsTarget) * 100));

  return {
    metrics: {
      community: byType("community").length,
      workforce: byType("workforce").length,
      giving: totalGiving,
      partnership: byType("partnership").length,
      counselling: byType("counselling").length,
      newsletter: byType("newsletter").length,
      contact: byType("contact").length,
      attendance: byType("attendance").length,
      nlp: byType("nlp").length,
      content: byType("content").length,
      total: submissions.length,
      fundsPercent,
      readiness: db.seed.readiness
    },
    dailyAttendance: {
      date: lagosDateKey(),
      code: dailyAttendanceCode()
    },
    submissions,
    recent,
    launchItems: db.seed.launchItems
  };
}

function csv(items) {
  const headers = ["id", "shortCode", "type", "createdAt", "name", "phone", "email", "service", "category", "amount", "message"];
  const rows = items.map(item => headers.map(key => {
    const value = key === "shortCode"
      ? item.shortCode || item.fields.shortCode || makeShortCode(item.id)
      : item[key] ?? item.fields[key] ?? item.fields[key.replace("category", "preferredCommunity")] ?? "";
    return `"${String(value).replaceAll('"', '""')}"`;
  }).join(","));
  return [headers.join(","), ...rows].join("\n");
}

function hasCommunicationsConsent(record) {
  return record.fields?.communicationsConsent === "on";
}

function normalizeNigeriaPhone(value) {
  const digits = cleanText(value).replace(/\D/g, "");
  if (/^0\d{10}$/.test(digits)) return `234${digits.slice(1)}`;
  if (/^234\d{10}$/.test(digits)) return digits;
  return "";
}

function optedInPhones(db) {
  return [...new Set(db.submissions
    .filter(hasCommunicationsConsent)
    .map(record => normalizeNigeriaPhone(phoneNumber(record.fields)))
    .filter(Boolean))];
}

function optedInEmails(db) {
  return [...new Set(db.submissions
    .filter(record => record.type === "newsletter" || hasCommunicationsConsent(record))
    .map(record => emailAddress(record.fields).toLowerCase())
    .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}

async function sendTermiiBulkSms(recipients, message) {
  if (!termiiApiKey || !termiiBaseUrl || !termiiSenderId) {
    throw new Error("Termii is not fully configured on the server.");
  }
  if (!["generic", "dnd"].includes(termiiChannel)) {
    throw new Error("TERMII_SMS_CHANNEL must be either generic or dnd.");
  }
  if (recipients.length > 100) {
    throw new Error("For safety, send to no more than 100 opted-in recipients at a time.");
  }
  const response = await fetch(`${termiiBaseUrl}/api/sms/send/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: recipients,
      from: termiiSenderId,
      sms: message,
      type: "plain",
      channel: termiiChannel,
      api_key: termiiApiKey
    }),
    signal: AbortSignal.timeout(15_000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.code !== "ok") {
    throw new Error(result.message || "Termii could not send this message.");
  }
  return { messageId: result.message_id || result.message_id_str, balance: result.balance };
}

async function sendTermiiBulkEmail(recipients, subject, message) {
  if (!termiiApiKey || !termiiBaseUrl || !termiiEmailConfigurationId || !termiiEmailTemplateId) {
    throw new Error("Termii email is not fully configured on the server.");
  }
  if (recipients.length > 100) {
    throw new Error("For safety, send to no more than 100 opted-in email recipients at a time.");
  }
  let delivered = 0;
  for (const email of recipients) {
    const response = await fetch(`${termiiBaseUrl}/api/templates/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: termiiApiKey,
        email,
        subject,
        email_configuration_id: termiiEmailConfigurationId,
        template_id: termiiEmailTemplateId,
        variables: { message }
      }),
      signal: AbortSignal.timeout(15_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.code !== "ok") {
      throw new Error(result.message || "Termii could not send the email message.");
    }
    delivered += 1;
  }
  return { delivered };
}

function validateSubmission(type, fields) {
  if (!["community", "counselling"].includes(type)) return;
  const required = type === "community"
    ? ["fullName", "phoneNumber", "preferredCommunity", "areaInAkure", "dateOfBirth"]
    : ["fullName", "phoneNumber", "careArea", "preferredTime"];
  const missing = required.find(key => !fields[key]);
  if (missing) throw new Error(`Please complete the ${missing.replace(/([A-Z])/g, " $1").toLowerCase()} field.`);
  if (type === "community" && !/^\d{4}-\d{2}-\d{2}$/.test(fields.dateOfBirth)) throw new Error("Please enter a valid date of birth.");
  if (fields.emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.emailAddress)) throw new Error("Please enter a valid email address.");
}

async function syncToGoogleSheet(record) {
  if (!["community", "counselling"].includes(record.type)) return { synced: false };
  if (!googleAppsScriptUrl || !googleAppsScriptToken) throw new Error("The secure Google Sheet connection has not been configured. Your details were saved locally; please contact the team before trying again.");
  let response;
  try {
    response = await fetch(googleAppsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        formType: record.type === "community" ? "registration" : "counselling",
        submissionId: record.id,
        fields: record.fields,
        token: googleAppsScriptToken
      }),
      signal: AbortSignal.timeout(12_000)
    });
  } catch {
    throw new Error("Your details were saved locally, but the Google Sheet could not be reached. Please try again shortly.");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Your details were saved locally, but the Google Sheet returned an unexpected response. Please try again shortly.");
  }
  if (!response.ok || !result.ok) throw new Error(result.error || "Your details were saved locally, but could not be sent to the Google Sheet.");
  return { synced: true, duplicate: Boolean(result.duplicate) };
}

// The submission is already saved to the local database by the time this
// runs (see both call sites below) -- a Google Sheet problem is a secondary,
// best-effort integration failing, never a reason to tell the person who
// just submitted the form that their submission failed. Wrapping the call
// here keeps that guarantee in one place instead of relying on every caller
// to remember it.
async function trySyncToGoogleSheet(record) {
  try {
    return await syncToGoogleSheet(record);
  } catch (error) {
    return { synced: false, error: error.message };
  }
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return true;
  }

  if (url.pathname === "/api/health" && req.method === "GET") {
    send(res, 200, {
      ok: true,
      runtime: process.env.VERCEL ? "vercel" : "local",
      integrations: {
        googleSheets: Boolean(googleAppsScriptUrl && googleAppsScriptToken),
        termiiSms: Boolean(termiiApiKey && termiiBaseUrl && termiiSenderId),
        termiiEmail: Boolean(termiiApiKey && termiiBaseUrl && termiiEmailConfigurationId && termiiEmailTemplateId)
      }
    });
    return true;
  }

  if (url.pathname === "/api/submissions" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const type = cleanText(body.type || "contact").toLowerCase();
      const fields = Object.fromEntries(
        Object.entries(body.fields || {}).map(([key, value]) => [cleanText(key), cleanText(value)])
      );
      if (!fields.name && !fields.fullName && !fields.email && !fields.emailAddress && !fields.phone && !fields.phoneNumber) {
        send(res, 400, { error: "Please include at least a name, email, or phone number." });
        return true;
      }
      validateSubmission(type, fields);
      const db = readDb();
      const submissionId = cleanText(body.submissionId || "");
      const existing = submissionId && db.submissions.find(record => record.id === submissionId);
      if (existing) {
        const googleSheet = await trySyncToGoogleSheet(existing);
        send(res, 200, { record: existing, dashboard: dashboard(db), googleSheet });
        return true;
      }
      const record = {
        id: submissionId || randomUUID(),
        type,
        fields,
        shortCode: createShortCode(db),
        status: type === "counselling" ? "New care request" : "New",
        createdAt: new Date().toISOString()
      };
      db.submissions.push(record);
      writeDb(db);
      const googleSheet = await trySyncToGoogleSheet(record);
      send(res, 201, { record, dashboard: dashboard(db), googleSheet });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/admin/login" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const email = cleanText(body.email).toLowerCase();
      const password = String(body.password || "");
      if (!email || !password) throw new Error("Please enter your email and password.");
      const attemptKey = loginAttemptKey(req, email);
      if (isLoginLocked(attemptKey)) throw new Error("Too many attempts. Please try again in a few minutes.");
      const db = readDb();
      const admin = db.admins.find(item => item.email === email);
      if (!admin || admin.active === false || !verifyPassword(password, admin.passwordHash)) {
        registerFailedLogin(attemptKey);
        throw new Error("Incorrect email or password.");
      }
      clearLoginAttempts(attemptKey);
      admin.lastLoginAt = new Date().toISOString();
      const session = createSession(db, admin.id);
      addAuditLog(db, admin, "Signed in");
      writeDb(db);
      setSessionCookie(res, session.token);
      send(res, 200, { admin: sanitizeAdmin(admin) });
    } catch (error) {
      send(res, 401, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/admin/logout" && req.method === "POST") {
    const db = readDb();
    const token = parseCookies(req.headers.cookie).ha_session;
    if (token) {
      const before = db.sessions.length;
      db.sessions = db.sessions.filter(item => item.token !== token);
      if (db.sessions.length !== before) writeDb(db);
    }
    clearSessionCookie(res);
    send(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/api/admin/me" && req.method === "GET") {
    const db = readDb();
    const ctx = getSessionContext(req, db);
    send(res, 200, { admin: ctx ? sanitizeAdmin(ctx.admin) : null });
    return true;
  }

  if (url.pathname === "/api/admin/change-password" && req.method === "POST") {
    const db = readDb();
    const ctx = requireAdminSession(req, res, db, null);
    if (!ctx) return true;
    try {
      const body = await parseBody(req);
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || "");
      if (newPassword.length < 8) throw new Error("New password must be at least 8 characters.");
      if (!verifyPassword(currentPassword, ctx.admin.passwordHash)) throw new Error("Current password is incorrect.");
      ctx.admin.passwordHash = hashPassword(newPassword);
      ctx.admin.mustChangePassword = false;
      addAuditLog(db, ctx.admin, "Changed password");
      writeDb(db);
      send(res, 200, { admin: sanitizeAdmin(ctx.admin) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  const submissionMatch = url.pathname.match(/^\/api\/admin\/submissions\/([^/]+)$/);
  if (submissionMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    const db = readDb();
    if (req.method === "DELETE") {
      const ctx = requireAdminSession(req, res, db, "delete_submissions");
      if (!ctx) return true;
      const index = db.submissions.findIndex(record => record.id === submissionMatch[1]);
      if (index === -1) { send(res, 404, { error: "Submission not found." }); return true; }
      const [removed] = db.submissions.splice(index, 1);
      addAuditLog(db, ctx.admin, "Deleted submission", `${removed.type} - ${removed.shortCode || removed.id}`);
      writeDb(db);
      send(res, 200, { ok: true, dashboard: dashboard(db) });
      return true;
    }
    const ctx = requireAdminSession(req, res, db, "edit_submissions");
    if (!ctx) return true;
    try {
      const record = db.submissions.find(item => item.id === submissionMatch[1]);
      if (!record) throw new Error("Submission not found.");
      const body = await parseBody(req);
      if (typeof body.status === "string") record.status = cleanText(body.status).slice(0, 60);
      if (body.fields && typeof body.fields === "object") {
        for (const [key, value] of Object.entries(body.fields)) {
          record.fields[cleanText(key)] = cleanText(value);
        }
      }
      record.updatedAt = new Date().toISOString();
      addAuditLog(db, ctx.admin, "Updated submission", `${record.type} - ${record.shortCode || record.id}`);
      writeDb(db);
      send(res, 200, { record, dashboard: dashboard(db) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/admin/launch-items" && req.method === "POST") {
    const db = readDb();
    const ctx = requireAdminSession(req, res, db, "manage_content");
    if (!ctx) return true;
    try {
      const body = await parseBody(req);
      const item = {
        id: randomUUID(),
        item: cleanText(body.item),
        type: cleanText(body.type) || "General",
        status: cleanText(body.status) || "Draft",
        due: cleanText(body.due)
      };
      if (!item.item) throw new Error("Please enter an item name.");
      db.seed.launchItems.push(item);
      addAuditLog(db, ctx.admin, "Added launch item", item.item);
      writeDb(db);
      send(res, 201, { item, dashboard: dashboard(db) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  const launchItemMatch = url.pathname.match(/^\/api\/admin\/launch-items\/([^/]+)$/);
  if (launchItemMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    const db = readDb();
    const ctx = requireAdminSession(req, res, db, "manage_content");
    if (!ctx) return true;
    const index = db.seed.launchItems.findIndex(entry => entry.id === launchItemMatch[1]);
    if (index === -1) { send(res, 404, { error: "Launch item not found." }); return true; }
    if (req.method === "DELETE") {
      const [removed] = db.seed.launchItems.splice(index, 1);
      addAuditLog(db, ctx.admin, "Removed launch item", removed.item);
      writeDb(db);
      send(res, 200, { ok: true, dashboard: dashboard(db) });
      return true;
    }
    try {
      const body = await parseBody(req);
      const item = db.seed.launchItems[index];
      if (body.item !== undefined) item.item = cleanText(body.item);
      if (body.type !== undefined) item.type = cleanText(body.type);
      if (body.status !== undefined) item.status = cleanText(body.status);
      if (body.due !== undefined) item.due = cleanText(body.due);
      addAuditLog(db, ctx.admin, "Updated launch item", item.item);
      writeDb(db);
      send(res, 200, { item, dashboard: dashboard(db) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/admin/admins" && req.method === "GET") {
    const db = readDb();
    const ctx = requireAdminSession(req, res, db, "manage_admins");
    if (!ctx) return true;
    send(res, 200, { admins: db.admins.map(sanitizeAdmin), permissions: ALL_PERMISSIONS, roles: ROLES });
    return true;
  }

  if (url.pathname === "/api/admin/admins" && req.method === "POST") {
    const db = readDb();
    const ctx = requireAdminSession(req, res, db, "manage_admins");
    if (!ctx) return true;
    try {
      const body = await parseBody(req);
      const name = cleanText(body.name);
      const email = cleanText(body.email).toLowerCase();
      const password = String(body.password || "");
      const role = ROLES.includes(body.role) ? body.role : "viewer";
      if (!name || !email) throw new Error("Please enter a name and email.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Please enter a valid email address.");
      if (password.length < 8) throw new Error("Password must be at least 8 characters.");
      if (db.admins.some(item => item.email === email)) throw new Error("An admin with that email already exists.");
      const permissions = Array.isArray(body.permissions)
        ? body.permissions.filter(permission => ALL_PERMISSIONS.includes(permission))
        : ROLE_DEFAULTS[role].slice();
      if (ctx.admin.role !== "superadmin" && (role === "superadmin" || permissions.includes("manage_admins"))) {
        throw new Error("Only a superadmin can grant superadmin access or the manage-admins permission.");
      }
      const admin = {
        id: randomUUID(),
        name,
        email,
        passwordHash: hashPassword(password),
        role,
        permissions,
        active: true,
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: null
      };
      db.admins.push(admin);
      addAuditLog(db, ctx.admin, "Created admin account", `${admin.name} (${admin.email})`);
      writeDb(db);
      send(res, 201, { admin: sanitizeAdmin(admin) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  const adminMatch = url.pathname.match(/^\/api\/admin\/admins\/([^/]+)$/);
  if (adminMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    const db = readDb();
    const ctx = requireAdminSession(req, res, db, "manage_admins");
    if (!ctx) return true;
    const target = db.admins.find(item => item.id === adminMatch[1]);
    if (!target) { send(res, 404, { error: "Admin not found." }); return true; }
    if (req.method === "DELETE") {
      if (target.id === ctx.admin.id) { send(res, 400, { error: "You cannot remove your own account." }); return true; }
      const otherActiveSuperadmins = db.admins.filter(item => item.id !== target.id && item.role === "superadmin" && item.active);
      if (target.role === "superadmin" && target.active && !otherActiveSuperadmins.length) {
        send(res, 400, { error: "At least one active superadmin must remain." });
        return true;
      }
      db.admins = db.admins.filter(item => item.id !== target.id);
      db.sessions = db.sessions.filter(item => item.adminId !== target.id);
      addAuditLog(db, ctx.admin, "Removed admin account", `${target.name} (${target.email})`);
      writeDb(db);
      send(res, 200, { ok: true });
      return true;
    }
    try {
      const body = await parseBody(req);
      if (ctx.admin.role !== "superadmin" && (body.role === "superadmin" || (Array.isArray(body.permissions) && body.permissions.includes("manage_admins")))) {
        throw new Error("Only a superadmin can grant superadmin access or the manage-admins permission.");
      }
      const losingSuperadminStatus = target.role === "superadmin" && target.active
        && (body.active === false || (body.role && body.role !== "superadmin"));
      if (losingSuperadminStatus) {
        const otherActiveSuperadmins = db.admins.filter(item => item.id !== target.id && item.role === "superadmin" && item.active);
        if (!otherActiveSuperadmins.length) throw new Error("At least one active superadmin must remain.");
      }
      if (body.name !== undefined) target.name = cleanText(body.name);
      if (body.role !== undefined && ROLES.includes(body.role)) target.role = body.role;
      if (Array.isArray(body.permissions)) {
        target.permissions = body.permissions.filter(permission => ALL_PERMISSIONS.includes(permission));
      } else if (body.role !== undefined) {
        target.permissions = ROLE_DEFAULTS[target.role].slice();
      }
      if (body.active !== undefined) target.active = Boolean(body.active);
      if (body.newPassword) {
        if (String(body.newPassword).length < 8) throw new Error("Password must be at least 8 characters.");
        target.passwordHash = hashPassword(body.newPassword);
        target.mustChangePassword = true;
        db.sessions = db.sessions.filter(item => item.adminId !== target.id);
      }
      addAuditLog(db, ctx.admin, "Updated admin account", `${target.name} (${target.email})`);
      writeDb(db);
      send(res, 200, { admin: sanitizeAdmin(target) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/admin/audit-log" && req.method === "GET") {
    const db = readDb();
    const ctx = requireAdminSession(req, res, db, null);
    if (!ctx) return true;
    send(res, 200, { entries: db.auditLog.slice(0, 100) });
    return true;
  }

  if (url.pathname === "/api/admin/sms-audience" && req.method === "GET") {
    const db = readDb();
    if (!requireBroadcastAccess(req, res, db)) return true;
    const recipients = optedInPhones(db);
    send(res, 200, {
      sms: { audience: "opted-in", recipients: recipients.length, maximumPerSend: 100 },
      email: { audience: "newsletter and opted-in", recipients: optedInEmails(db).length, maximumPerSend: 100 }
    });
    return true;
  }

  if (url.pathname === "/api/admin/bulk-sms" && req.method === "POST") {
    const db = readDb();
    const ctx = requireBroadcastAccess(req, res, db);
    if (!ctx) return true;
    try {
      const body = await parseBody(req);
      const message = cleanText(body.message);
      if (message.length < 2) throw new Error("Please enter an SMS message.");
      const recipients = optedInPhones(db);
      if (!recipients.length) throw new Error("There are no opted-in SMS recipients yet.");
      const delivery = await sendTermiiBulkSms(recipients, message);
      if (ctx.admin) {
        addAuditLog(db, ctx.admin, "Sent bulk SMS", `${recipients.length} recipients`);
        writeDb(db);
      }
      send(res, 200, { ok: true, recipients: recipients.length, delivery });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/admin/bulk-email" && req.method === "POST") {
    const db = readDb();
    const ctx = requireBroadcastAccess(req, res, db);
    if (!ctx) return true;
    try {
      const body = await parseBody(req);
      const subject = cleanText(body.subject).slice(0, 120);
      const message = cleanText(body.message);
      if (subject.length < 2 || message.length < 2) throw new Error("Please enter an email subject and message.");
      const recipients = optedInEmails(db);
      if (!recipients.length) throw new Error("There are no opted-in email recipients yet.");
      const delivery = await sendTermiiBulkEmail(recipients, subject, message);
      if (ctx.admin) {
        addAuditLog(db, ctx.admin, "Sent bulk email", `${recipients.length} recipients`);
        writeDb(db);
      }
      send(res, 200, { ok: true, recipients: recipients.length, delivery });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname.startsWith("/api/short-code/") && req.method === "GET") {
    const code = url.pathname.split("/").pop();
    const record = findByShortCode(readDb(), code);
    if (!record) {
      send(res, 404, { error: "No saved attendee was found for that short code." });
      return true;
    }
    send(res, 200, { attendee: attendeeFromRecord(record) });
    return true;
  }

  if (url.pathname === "/api/attendance" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const submittedCode = cleanCode(body.attendanceCode || body.shortCode);
      const todayCode = dailyAttendanceCode();
      if (submittedCode !== todayCode) {
        send(res, 400, { error: "That attendance code is not valid for today." });
        return true;
      }
      const db = readDb();
      const name = cleanText(body.name || body.fullName);
      const phone = cleanText(body.phone || body.phoneNumber);
      if (!name && !phone) {
        send(res, 400, { error: "Please enter at least a name or phone number." });
        return true;
      }
      const fields = {
        attendanceCode: todayCode,
        attendanceDate: lagosDateKey(),
        name,
        phone,
        department: cleanText(body.department || ""),
        service: cleanText(body.service || "Sunday Service"),
        note: cleanText(body.note || "")
      };
      const record = {
        id: randomUUID(),
        type: "attendance",
        fields,
        status: "Checked in",
        createdAt: new Date().toISOString()
      };
      db.submissions.push(record);
      writeDb(db);
      send(res, 201, { record, dashboard: dashboard(db) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/daily-attendance-code" && req.method === "GET") {
    send(res, 200, { date: lagosDateKey(), code: dailyAttendanceCode() });
    return true;
  }

  if (url.pathname === "/api/dashboard" && req.method === "GET") {
    const db = readDb();
    const ctx = requireAdminSession(req, res, db, "view_dashboard");
    if (!ctx) return true;
    send(res, 200, dashboard(db));
    return true;
  }

  if (url.pathname === "/api/export" && req.method === "GET") {
    const db = readDb();
    const ctx = requireAdminSession(req, res, db, "export_data");
    if (!ctx) return true;
    send(res, 200, csv(db.submissions), "text/csv; charset=utf-8");
    return true;
  }

  return false;
}

function serveStatic(req, res, url) {
  let filePath = join(distDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(distDir)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  // A request for a nested route directory (e.g. /callcentre or /callcentre/)
  // resolves to that directory's own index.html, not the site's root one.
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  if (!existsSync(filePath)) filePath = join(distDir, "index.html");
  if (!existsSync(filePath)) {
    send(res, 404, "Run npm run build first.", "text/plain; charset=utf-8");
    return;
  }
  send(res, 200, readFileSync(filePath), mimeTypes[extname(filePath)] || "application/octet-stream");
}

export async function requestHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api") && await handleApi(req, res, url)) return;
  serveStatic(req, res, url);
}

if (!process.env.VERCEL) {
  createServer(requestHandler).listen(port, "127.0.0.1", () => {
    ensureDb();
    console.log(`Harvesters Akure server running at http://127.0.0.1:${port}`);
  });
}
