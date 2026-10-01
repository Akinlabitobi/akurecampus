import { createServer } from "node:http";
import { randomUUID, randomBytes, randomInt, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { COMMUNITIES } from "./src/communities.js";

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
// Local development only: print member sign-in codes to the server console
// instead of emailing them. Ignored on Vercel.
const memberOtpDevLog = process.env.MEMBER_OTP_DEV_LOG === "1" && !process.env.VERCEL;
// Resend (resend.com) sends member sign-in codes. The From address must be
// on a domain verified in the Resend dashboard.
const resendApiKey = process.env.RESEND_API_KEY || "";
const memberEmailFrom = process.env.MEMBER_EMAIL_FROM || "Harvesters Akure <noreply@harvestersng.org>";

// Site data (submissions, admins, sessions, audit log, launch items) lives
// in Supabase when these are set (see site-schema.sql) -- required on
// Vercel, since serverless functions there have a read-only filesystem and
// cannot write a local JSON file. Falls back to the local JSON file only
// when they're absent, so a plain `git clone` + `npm run dev` still works
// with zero setup for local-only contributors.
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const useSupabase = Boolean(supabaseUrl && supabaseServiceKey);
const supabase = useSupabase
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
  : null;

// Birthday photos are kept out of the submissions table on purpose: every
// write re-syncs that whole table and the dashboard ships every row to the
// browser, so a few hundred embedded images would make both crawl. Only the
// photo's path is stored on the record; the bytes live in a private Supabase
// Storage bucket (or data/birthday-photos locally) and are only ever served
// to signed-in admins.
const birthdayPhotoBucket = "birthday-photos";
const birthdayPhotoDir = join(dataDir, "birthday-photos");
const MAX_PHOTO_BYTES = 1_500_000;

const ALL_PERMISSIONS = [
  "view_dashboard",
  "edit_submissions",
  "delete_submissions",
  "manage_content",
  "send_broadcasts",
  "manage_admins",
  "export_data"
];
const ROLES = ["superadmin", "manager", "viewer", "cell_leader"];
const ROLE_DEFAULTS = {
  superadmin: ALL_PERMISSIONS.slice(),
  manager: ["view_dashboard", "edit_submissions", "manage_content", "export_data", "send_broadcasts"],
  viewer: ["view_dashboard"],
  cell_leader: ["cell_reports"]
};
// A cell leader's cells are stored in their permissions list as
// "cell:<name>" entries -- no extra database column needed.
const CELL_PREFIX = "cell:";
const COMMUNITY_NAMES = COMMUNITIES.map(([name]) => name);

// Checks and normalises the permissions sent for an admin account. Cell
// leaders get only cell access, for at least one real cell; other roles get
// only the standard permissions.
function cleanPermissions(role, permissions) {
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

const defaultLaunchItems = () => [
  { id: randomUUID(), item: "Launch Sunday", type: "Event", status: "Published", due: "Aug 30" },
  { id: randomUUID(), item: "Akure Workforce Form", type: "Form", status: "Live", due: "Aug 21" },
  { id: randomUUID(), item: "First-Time Guest Flow", type: "Automation", status: "Ready", due: "Aug 18" },
  { id: randomUUID(), item: "Giving Campaign", type: "Finance", status: "Review", due: "Aug 24" }
];

const defaultDb = {
  submissions: [],
  admins: [],
  sessions: [],
  auditLog: [],
  seed: {
    readiness: 72,
    fundsTarget: 12000000,
    launchItems: defaultLaunchItems()
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
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon",
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

function announceSeedAdmin(admin, generatedPassword) {
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

// ---- JSON-file persistence (local dev fallback) ----------------------

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
    announceSeedAdmin(admin, generatedPassword);
  }
  const activeSessionCount = db.sessions.length;
  db.sessions = db.sessions.filter(session => new Date(session.expiresAt) > new Date());
  if (db.sessions.length !== activeSessionCount) changed = true;
  return changed;
}

function readDbFromFile() {
  ensureDb();
  const db = JSON.parse(readFileSync(dbPath, "utf8"));
  const changed = migrateDb(db);
  if (changed) writeDbToFile(db);
  return db;
}

function writeDbToFile(db) {
  ensureDb();
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

// ---- Supabase persistence (required on Vercel) ------------------------

function assertNoError(error, context) {
  if (error) throw new Error(`Supabase ${context} failed: ${error.message}`);
}

// Brings a Supabase-backed array table in line with the in-memory array:
// deletes rows no longer present, upserts everything current. Simpler and
// far less bug-prone than hand-converting every individual mutation in
// every route handler into its own targeted insert/update/delete -- this
// app's traffic is small enough that a full sync on every write is cheap.
async function syncTable(table, idKey, rows) {
  const { data: existing, error: fetchError } = await supabase.from(table).select(idKey);
  assertNoError(fetchError, `read (${table})`);
  const existingIds = new Set((existing || []).map(row => row[idKey]));
  const currentIds = new Set(rows.map(row => row[idKey]));
  const toDelete = [...existingIds].filter(id => !currentIds.has(id));
  if (toDelete.length) {
    const { error } = await supabase.from(table).delete().in(idKey, toDelete);
    assertNoError(error, `delete (${table})`);
  }
  if (rows.length) {
    const { error } = await supabase.from(table).upsert(rows, { onConflict: idKey });
    assertNoError(error, `upsert (${table})`);
  }
}

async function readDbFromSupabase() {
  const seedRes = await supabase.from("harvesters_seed").select("*").eq("id", true).maybeSingle();
  assertNoError(seedRes.error, "read (harvesters_seed)");

  if (!seedRes.data) {
    // First run against this Supabase project: seed the settings row and
    // default launch items together, so a later read never mistakes "an
    // admin cleared every launch item" for "never seeded."
    const { error: seedInsertError } = await supabase
      .from("harvesters_seed")
      .insert({ id: true, readiness: 72, fundsTarget: 12000000 });
    assertNoError(seedInsertError, "seed insert (harvesters_seed)");
    const { error: launchInsertError } = await supabase
      .from("harvesters_launch_items")
      .insert(defaultLaunchItems());
    assertNoError(launchInsertError, "seed insert (harvesters_launch_items)");
  }

  const [submissionsRes, adminsRes, sessionsRes, auditRes, launchRes, freshSeedRes] = await Promise.all([
    supabase.from("harvesters_submissions").select("*").order("createdAt", { ascending: true }),
    supabase.from("harvesters_admins").select("*"),
    supabase.from("harvesters_sessions").select("*"),
    supabase.from("harvesters_audit_log").select("*").order("createdAt", { ascending: false }).limit(200),
    supabase.from("harvesters_launch_items").select("*"),
    supabase.from("harvesters_seed").select("*").eq("id", true).maybeSingle()
  ]);
  assertNoError(submissionsRes.error, "read (harvesters_submissions)");
  assertNoError(adminsRes.error, "read (harvesters_admins)");
  assertNoError(sessionsRes.error, "read (harvesters_sessions)");
  assertNoError(auditRes.error, "read (harvesters_audit_log)");
  assertNoError(launchRes.error, "read (harvesters_launch_items)");
  assertNoError(freshSeedRes.error, "read (harvesters_seed)");

  const db = {
    submissions: submissionsRes.data || [],
    admins: adminsRes.data || [],
    sessions: sessionsRes.data || [],
    auditLog: auditRes.data || [],
    seed: {
      readiness: freshSeedRes.data?.readiness ?? 72,
      fundsTarget: Number(freshSeedRes.data?.fundsTarget ?? 12000000),
      launchItems: launchRes.data || []
    }
  };

  if (!db.admins.length) {
    const { admin, generatedPassword } = createSeedAdmin();
    const { error } = await supabase.from("harvesters_admins").insert(admin);
    assertNoError(error, "seed insert (harvesters_admins)");
    db.admins.push(admin);
    announceSeedAdmin(admin, generatedPassword);
  }

  const expiredTokens = db.sessions.filter(session => new Date(session.expiresAt) <= new Date()).map(session => session.token);
  if (expiredTokens.length) {
    const { error } = await supabase.from("harvesters_sessions").delete().in("token", expiredTokens);
    assertNoError(error, "delete (harvesters_sessions)");
    db.sessions = db.sessions.filter(session => !expiredTokens.includes(session.token));
  }

  return db;
}

async function writeDbToSupabase(db) {
  await Promise.all([
    syncTable("harvesters_submissions", "id", db.submissions),
    syncTable("harvesters_admins", "id", db.admins),
    syncTable("harvesters_sessions", "token", db.sessions),
    syncTable("harvesters_audit_log", "id", db.auditLog),
    syncTable("harvesters_launch_items", "id", db.seed.launchItems)
  ]);
  const { error } = await supabase
    .from("harvesters_seed")
    .upsert({ id: true, readiness: db.seed.readiness, fundsTarget: db.seed.fundsTarget }, { onConflict: "id" });
  assertNoError(error, "upsert (harvesters_seed)");
}

// ---- Persistence dispatch ----------------------------------------------

async function readDb() {
  const db = useSupabase ? await readDbFromSupabase() : readDbFromFile();
  if (applyAdminRecovery(db)) await writeDb(db);
  return db;
}

// Account recovery for when nobody can sign in. Set ADMIN_RECOVERY_EMAIL
// and ADMIN_RECOVERY_PASSWORD (8+ characters) on the server and redeploy:
// on the next request that email becomes an active superadmin with that
// password (created if it doesn't exist), and must choose a new password
// after signing in. It runs once per email+password pair -- an audit-log
// entry records it -- so changing the password afterwards sticks. Remove
// both variables once you're back in.
function applyAdminRecovery(db) {
  const email = String(process.env.ADMIN_RECOVERY_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_RECOVERY_PASSWORD || "");
  if (!email || password.length < 8) return false;
  const marker = `recovery:${sha256(`${email}:${password}`).slice(0, 16)}`;
  if (db.auditLog.some(entry => entry.detail === marker)) return false;
  let admin = db.admins.find(item => String(item.email).trim().toLowerCase() === email);
  if (!admin) {
    admin = { id: randomUUID(), name: "Administrator", createdAt: new Date().toISOString(), lastLoginAt: null };
    db.admins.push(admin);
  }
  Object.assign(admin, {
    email,
    passwordHash: hashPassword(password),
    role: "superadmin",
    permissions: ALL_PERMISSIONS.slice(),
    active: true,
    mustChangePassword: true
  });
  db.sessions = db.sessions.filter(session => session.adminId !== admin.id);
  db.auditLog.unshift({
    id: randomUUID(),
    adminId: admin.id,
    adminName: "Account recovery",
    action: `Recovered admin account ${email}`,
    detail: marker,
    createdAt: new Date().toISOString()
  });
  console.log(`Admin account recovery applied for ${email}.`);
  return true;
}

async function writeDb(db) {
  return useSupabase ? writeDbToSupabase(db) : writeDbToFile(db);
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

// On Vercel every request reaches the function through Vercel's proxy, so
// the socket address is the proxy's, shared by everyone -- five wrong
// guesses from anywhere locked the account for all. Vercel sets
// x-forwarded-for to the visitor's real address (and overwrites any value a
// visitor sends), so lock per visitor instead.
function loginAttemptKey(req, email) {
  const visitor = process.env.VERCEL && req.headers["x-forwarded-for"]
    ? String(req.headers["x-forwarded-for"]).split(",")[0].trim()
    : req.socket?.remoteAddress;
  return `${visitor || "unknown"}:${email}`;
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

function parseBody(req, maxLength = 1_000_000) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > maxLength) reject(new Error("Request body too large"));
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
  const submissions = db.submissions.map(record => {
    if (!record.fields?.signInCode) return record;
    const { signInCode, ...fields } = record.fields;
    return { ...record, fields };
  });
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
      birthday: byType("birthday").length,
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

function csv(items) {
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
function csvCommunity(items) {
  const sorted = sortByFields(items, [record => record.fields.preferredCommunity, record => record.fields.fullName]);
  const headers = ["Code", "Name", "Phone", "Email", "Community", "Area", "Wants to Lead", "Status", "Date"];
  const rows = sorted.map(record => [
    record.shortCode || makeShortCode(record.id),
    record.fields.fullName || "",
    record.fields.phoneNumber || "",
    record.fields.emailAddress || "",
    record.fields.preferredCommunity || "",
    record.fields.areaInAkure || "",
    record.fields.wouldYouLikeToLead || "",
    record.status || "",
    record.createdAt
  ]);
  return toCsv(headers, rows);
}

function csvWorkforce(items) {
  const sorted = sortByFields(items, [record => record.fields.department, record => record.fields.fullName]);
  const headers = ["Code", "Name", "Phone", "Email", "Department", "Experience", "Wants to Lead", "Status", "Date"];
  const rows = sorted.map(record => [
    record.shortCode || makeShortCode(record.id),
    record.fields.fullName || "",
    record.fields.phoneNumber || "",
    record.fields.emailAddress || "",
    record.fields.department || "",
    record.fields.relevantExperience || "",
    record.fields.wouldYouLikeToLead || "",
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

function csvBirthdays(items, origin) {
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

// Accepts only a base64 data URL whose bytes really are a JPEG, PNG or WebP
// (checked by signature, not just the declared type), since these bytes are
// later served back to admins with an image content type.
function parsePhoto(value) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ""));
  if (!match) throw new Error("Please add a photo (JPEG, PNG or WebP).");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_PHOTO_BYTES) throw new Error("That photo is too large. Please choose a smaller one.");
  const signatures = {
    jpeg: buffer[0] === 0xff && buffer[1] === 0xd8,
    png: buffer.subarray(0, 4).toString("hex") === "89504e47",
    webp: buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP"
  };
  if (!signatures[match[1]]) throw new Error("That file does not look like a valid image.");
  return { buffer, contentType: `image/${match[1]}`, extension: match[1] === "jpeg" ? "jpg" : match[1] };
}

async function savePhoto(path, photo) {
  if (!useSupabase) {
    mkdirSync(birthdayPhotoDir, { recursive: true });
    writeFileSync(join(birthdayPhotoDir, path), photo.buffer);
    return;
  }
  const upload = () => supabase.storage.from(birthdayPhotoBucket).upload(path, photo.buffer, { contentType: photo.contentType, upsert: true });
  let { error } = await upload();
  if (error && /bucket not found/i.test(error.message)) {
    // First photo ever on this Supabase project: create the private bucket
    // instead of requiring a manual dashboard step before the form works.
    const created = await supabase.storage.createBucket(birthdayPhotoBucket, { public: false });
    if (created.error && !/already exists/i.test(created.error.message)) assertNoError(created.error, "create bucket (birthday-photos)");
    ({ error } = await upload());
  }
  assertNoError(error, "upload (birthday-photos)");
}

async function readPhoto(path) {
  if (!useSupabase) {
    const filePath = join(birthdayPhotoDir, path);
    return existsSync(filePath) ? readFileSync(filePath) : null;
  }
  const { data, error } = await supabase.storage.from(birthdayPhotoBucket).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

// Best-effort: a leftover file is harmless, a failed record deletion is not.
async function deletePhoto(path) {
  try {
    if (!useSupabase) {
      const filePath = join(birthdayPhotoDir, path);
      if (existsSync(filePath)) unlinkSync(filePath);
      return;
    }
    await supabase.storage.from(birthdayPhotoBucket).remove([path]);
  } catch {
    // ignore
  }
}

function validateBirthday(body) {
  const fields = {
    fullName: cleanText(body.fullName).slice(0, 120),
    phoneNumber: cleanText(body.phoneNumber).slice(0, 30),
    emailAddress: emailKeyOf(cleanText(body.emailAddress)),
    dateOfBirth: cleanText(body.dateOfBirth),
    photoConsent: body.photoConsent === "on" ? "on" : ""
  };
  if (!fields.fullName) throw new Error("Please enter the celebrant's full name.");
  if (fields.phoneNumber.replace(/\D/g, "").length < 7) throw new Error("Please enter a valid phone number.");
  if (fields.emailAddress && !EMAIL_PATTERN.test(fields.emailAddress)) throw new Error("Please enter a valid email address.");
  const date = new Date(`${fields.dateOfBirth}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dateOfBirth) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== fields.dateOfBirth) {
    throw new Error("Please enter a valid date of birth.");
  }
  if (fields.dateOfBirth < "1900-01-01" || fields.dateOfBirth > lagosDateKey()) throw new Error("Please enter a date of birth in the past.");
  if (!fields.photoConsent) throw new Error("Please confirm we may share the photo when celebrating the birthday.");
  return fields;
}

function sameCelebrant(record, fields) {
  return record.type === "birthday"
    && record.fields.phoneNumber.replace(/\D/g, "").slice(-10) === fields.phoneNumber.replace(/\D/g, "").slice(-10)
    && record.fields.fullName.toLowerCase().replace(/\s+/g, " ") === fields.fullName.toLowerCase().replace(/\s+/g, " ");
}

// ---- Cell reports ------------------------------------------------------
//
// A cell's members are everyone who joined it through the Communities page
// (community records whose preferredCommunity is that cell). A cell report
// is one week's meeting: who was present or absent, visitors, topic,
// offering and notes. Cells meet weekly, so there is one report per cell per
// week (Monday to Sunday); saving any date in that week edits it.
//
// Cell leaders only ever reach their own cells' members and reports through
// these routes; they have no view_dashboard permission, so every other admin
// route (all submissions, exports, broadcasts...) refuses them.

function sameCellName(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function cellsForAdmin(admin, db) {
  if (hasPermission(admin, "view_dashboard")) {
    const inUse = db.submissions.filter(record => record.type === "community").map(record => record.fields.preferredCommunity).filter(Boolean);
    return [...new Set([...COMMUNITY_NAMES, ...inUse])];
  }
  if (admin.role !== "cell_leader") return [];
  return (admin.permissions || []).filter(permission => permission.startsWith(CELL_PREFIX)).map(permission => permission.slice(CELL_PREFIX.length));
}

function requireCellAccess(req, res, db) {
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
function cellMembers(db, cell) {
  const byPerson = new Map();
  db.submissions
    .filter(record => record.type === "community" && sameCellName(record.fields.preferredCommunity, cell))
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

function cellOverview(db, ctx) {
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
function weekOf(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function idList(value, allowed) {
  return Array.isArray(value) ? [...new Set(value.map(String).filter(id => allowed.has(id)))] : [];
}


//
// Members sign in with a 6-digit code emailed to them; there is no separate
// sign-up -- anyone who has given an email address on a form can sign in.
// A signed-in member only ever sees records submitted with that same email.
// Records are deliberately NOT pulled in by phone number: phones on forms
// are unverified, so linking by phone would let someone type a stranger's
// number next to their own email and read that person's records.
//
// No extra tables are needed: a pending sign-in code (hashed) is kept on the
// member's own "member" record, and member sessions live in the same
// sessions table as admin sessions, keyed "member:<hash of token>" with the
// member record's id in adminId. Those keys can never match an admin cookie
// or an admin id, so the two kinds of session can't be confused.

const MEMBER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_SENDS_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const memberCodeRequests = new Map();
const MEMBER_SESSION_PREFIX = "member:";

function emailKeyOf(value) {
  return String(value || "").trim().toLowerCase();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function memberSessionKey(token) {
  return MEMBER_SESSION_PREFIX + sha256(token);
}

function ensureMemberRecord(db, email) {
  let record = memberRecord(db, email);
  if (!record) {
    record = {
      id: randomUUID(),
      type: "member",
      fields: { emailAddress: email },
      shortCode: createShortCode(db),
      status: "Member",
      createdAt: new Date().toISOString()
    };
    db.submissions.push(record);
  }
  return record;
}

function setMemberCookie(res, token) {
  const parts = [`ha_member=${token}`, "HttpOnly", "Path=/", `Max-Age=${MEMBER_SESSION_TTL_MS / 1000}`, "SameSite=Lax"];
  if (process.env.VERCEL) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearMemberCookie(res) {
  res.setHeader("Set-Cookie", "ha_member=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
}

// Only a hash of the session token is stored, so a leaked database row
// cannot be replayed as a cookie. Returns the database it read, for reuse.
async function getMemberContext(req) {
  const token = parseCookies(req.headers.cookie).ha_member;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const db = await readDb();
  const key = memberSessionKey(token);
  const session = db.sessions.find(item => item.token === key);
  if (!session || new Date(session.expiresAt) <= new Date()) return null;
  const member = db.submissions.find(record => record.id === session.adminId && record.type === "member");
  if (!member) return null;
  return { db, email: emailKeyOf(member.fields.emailAddress), sessionKey: key };
}

function recordsForEmail(db, email) {
  return db.submissions
    .filter(record => record.type !== "member" && emailKeyOf(emailAddress(record.fields)) === email)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function memberRecord(db, email) {
  return db.submissions.find(record => record.type === "member" && emailKeyOf(record.fields.emailAddress) === email);
}

function sameName(a, b) {
  const tidy = value => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  return Boolean(tidy(a)) && tidy(a) === tidy(b);
}

const ACTIVITY_LABELS = {
  counselling: ["Care request", fields => fields.careArea],
  partnership: ["Partnership interest", fields => fields.partnershipType],
  giving: ["Giving pledge", fields => [fields.fund, fields.amount && `₦${Number(fields.amount).toLocaleString("en-NG")}`].filter(Boolean).join(" · ")],
  nlp: ["Prayer updates", fields => fields.prayerFocus],
  contact: ["Message to the team", fields => fields.subject],
  content: ["Content idea", fields => fields.subject],
  newsletter: ["Newsletter signup", () => ""]
};

// What a signed-in member sees about themselves. Deliberately a curated
// summary, not the raw records: admin-only fields such as a care request's
// internal status never leave the server.
function buildMemberProfile(db, email) {
  const records = recordsForEmail(db, email);
  const member = memberRecord(db, email);
  const latest = getter => [...records].reverse().map(record => getter(record.fields)).find(Boolean) || "";
  const name = member?.fields.fullName || latest(displayName);
  const birthdays = records.filter(record => record.type === "birthday");
  const ownBirthday = birthdays.find(record => sameName(record.fields.fullName, name)) || (birthdays.length === 1 ? birthdays[0] : null);
  const photoUrl = record => `/api/member/photo/${record.id}?v=${Date.parse(record.updatedAt || record.createdAt)}`;
  return {
    email,
    name,
    phone: member?.fields.phoneNumber || latest(phoneNumber),
    dateOfBirth: ownBirthday?.fields.dateOfBirth || latest(fields => fields.dateOfBirth),
    photoUrl: member?.fields.photoPath ? photoUrl(member) : ownBirthday?.fields.photoPath ? photoUrl(ownBirthday) : "",
    memberSince: records[0]?.createdAt || member?.createdAt || "",
    communities: records.filter(record => record.type === "community").map(record => ({ name: record.fields.preferredCommunity, date: record.createdAt })),
    departments: records.filter(record => record.type === "workforce").map(record => ({ name: record.fields.department, date: record.createdAt })),
    birthdays: birthdays.map(record => ({
      name: record.fields.fullName,
      dateOfBirth: record.fields.dateOfBirth,
      photoUrl: record.fields.photoPath ? photoUrl(record) : ""
    })),
    activity: records
      .filter(record => ACTIVITY_LABELS[record.type])
      .reverse()
      .map(record => ({ label: ACTIVITY_LABELS[record.type][0], detail: ACTIVITY_LABELS[record.type][1](record.fields) || "", date: record.createdAt }))
  };
}

function termiiEmailReady() {
  return Boolean(termiiApiKey && termiiBaseUrl && termiiEmailConfigurationId && termiiEmailTemplateId);
}

function emailSignInReady() {
  return Boolean(resendApiKey) || termiiEmailReady() || memberOtpDevLog;
}

async function sendResendEmail(to, subject, text, html) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}` },
    body: JSON.stringify({ from: memberEmailFrom, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    // The real reason (e.g. an unverified domain) goes to the server log;
    // the visitor gets a plain message.
    console.error(`Resend could not send the sign-in email (${response.status}): ${result.message || "unknown error"}`);
    throw new Error("We couldn't send the sign-in email just now. Please try again in a few minutes.");
  }
}

async function sendSignInCode(email, code) {
  const subject = "Your Harvesters Akure sign-in code";
  const text = `Your Harvesters Akure sign-in code is ${code}. It expires in 10 minutes. If you didn't ask for this, you can ignore this email.`;
  if (memberOtpDevLog) {
    console.log(`[member sign-in] code for ${email}: ${code}`);
    return;
  }
  if (resendApiKey) {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#102033">
        <h2 style="color:#071e3d">Harvesters Akure</h2>
        <p>Use this code to sign in to your profile:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#d71920;margin:24px 0">${code}</p>
        <p>It expires in 10 minutes.</p>
        <p style="color:#5f6b7a;font-size:13px">If you didn't ask for this, you can safely ignore this email.</p>
      </div>`;
    await sendResendEmail(email, subject, text, html);
    return;
  }
  await sendTermiiBulkEmail([email], subject, text);
}

function memberCodeRateLimited(req) {
  const key = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (memberCodeRequests.get(key) || []).filter(time => now - time < 15 * 60 * 1000);
  recent.push(now);
  memberCodeRequests.set(key, recent);
  return recent.length > 10;
}

function codesMatch(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
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

// The submission is already saved to the database by the time this runs
// (see both call sites below) -- a Google Sheet problem is a secondary,
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
      database: useSupabase ? "supabase" : "local-file",
      integrations: {
        googleSheets: Boolean(googleAppsScriptUrl && googleAppsScriptToken),
        termiiSms: Boolean(termiiApiKey && termiiBaseUrl && termiiSenderId),
        termiiEmail: termiiEmailReady(),
        memberSignInEmail: Boolean(resendApiKey) || termiiEmailReady()
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
      const db = await readDb();
      const submissionId = cleanText(body.submissionId || "");
      const existing = submissionId && db.submissions.find(record => record.id === submissionId);
      if (existing) {
        const googleSheet = await trySyncToGoogleSheet(existing);
        send(res, 200, { record: existing, googleSheet });
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
      await writeDb(db);
      const googleSheet = await trySyncToGoogleSheet(record);
      send(res, 201, { record, googleSheet });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/birthdays" && req.method === "POST") {
    try {
      const body = await parseBody(req, 2_500_000);
      const fields = validateBirthday(body);
      const photo = parsePhoto(body.photo);
      const db = await readDb();
      const submissionId = cleanText(body.submissionId || "");
      // A retried request (same submissionId) or the same person sending
      // their details again updates the one record instead of duplicating
      // them, so people can come back any time to change their photo.
      const existing = db.submissions.find(record => record.type === "birthday" && (record.id === submissionId || sameCelebrant(record, fields)));
      const record = existing || {
        id: submissionId || randomUUID(),
        type: "birthday",
        fields: {},
        shortCode: createShortCode(db),
        status: "New",
        createdAt: new Date().toISOString()
      };
      const previousPhotoPath = record.fields.photoPath;
      const photoPath = `${record.id}.${photo.extension}`;
      await savePhoto(photoPath, photo);
      if (!fields.emailAddress) delete fields.emailAddress;
      record.fields = { ...record.fields, ...fields, name: fields.fullName, photoPath, photoType: photo.contentType };
      if (existing) record.updatedAt = new Date().toISOString();
      else db.submissions.push(record);
      await writeDb(db);
      if (previousPhotoPath && previousPhotoPath !== photoPath) await deletePhoto(previousPhotoPath);
      send(res, existing ? 200 : 201, { record, updated: Boolean(existing) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  const birthdayPhotoMatch = url.pathname.match(/^\/api\/admin\/birthday-photo\/([^/]+)$/);
  if (birthdayPhotoMatch && req.method === "GET") {
    const db = await readDb();
    if (!requireAdminSession(req, res, db, "view_dashboard")) return true;
    const record = db.submissions.find(item => item.id === birthdayPhotoMatch[1]);
    const bytes = record?.fields.photoPath ? await readPhoto(record.fields.photoPath) : null;
    if (!bytes) {
      send(res, 404, { error: "Photo not found." });
      return true;
    }
    res.writeHead(200, {
      "Content-Type": record.fields.photoType || "image/jpeg",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      ...(url.searchParams.has("download") ? { "Content-Disposition": `attachment; filename="${record.fields.photoPath}"` } : {})
    });
    res.end(bytes);
    return true;
  }

  if (url.pathname === "/api/member/request-code" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const email = emailKeyOf(cleanText(body.email));
      if (!EMAIL_PATTERN.test(email)) throw new Error("Please enter a valid email address.");
      if (!emailSignInReady()) throw new Error("Member sign-in by email hasn't been set up yet. Please try again later.");
      if (memberCodeRateLimited(req)) {
        send(res, 429, { error: "Too many sign-in attempts. Please wait a few minutes and try again." });
        return true;
      }
      const db = await readDb();
      const previous = memberRecord(db, email)?.fields.signInCode;
      const now = Date.now();
      if (previous && now - new Date(previous.sentAt).getTime() < OTP_RESEND_MS) {
        send(res, 429, { error: "A code was just sent. Please wait a minute before asking for another." });
        return true;
      }
      const sameWindow = previous && now - new Date(previous.windowStart).getTime() < 60 * 60 * 1000;
      if (sameWindow && previous.sendCount >= OTP_MAX_SENDS_PER_HOUR) {
        send(res, 429, { error: "Too many codes requested for this email. Please try again in an hour." });
        return true;
      }
      // The same reply whether or not the email is known, so this form can't
      // be used to find out who has given their details to the church.
      const reply = { ok: true, message: "If this email is registered with Harvesters Akure, a 6-digit code is on its way. It expires in 10 minutes." };
      const known = db.submissions.some(record => emailKeyOf(emailAddress(record.fields)) === email);
      if (!known) {
        send(res, 200, reply);
        return true;
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await sendSignInCode(email, code);
      ensureMemberRecord(db, email).fields.signInCode = {
        codeHash: sha256(`${email}:${code}`),
        expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
        attempts: 0,
        sentAt: new Date(now).toISOString(),
        windowStart: sameWindow ? previous.windowStart : new Date(now).toISOString(),
        sendCount: sameWindow ? previous.sendCount + 1 : 1
      };
      await writeDb(db);
      send(res, 200, reply);
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/member/verify" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const email = emailKeyOf(cleanText(body.email));
      const code = cleanText(body.code).replace(/\D/g, "");
      const db = await readDb();
      const member = memberRecord(db, email);
      const otp = member?.fields.signInCode;
      if (!otp || new Date(otp.expiresAt) <= new Date()) throw new Error("This code has expired or was not found. Please request a new one.");
      if (otp.attempts >= OTP_MAX_ATTEMPTS) {
        delete member.fields.signInCode;
        await writeDb(db);
        throw new Error("Too many incorrect attempts. Please request a new code.");
      }
      if (!codesMatch(sha256(`${email}:${code}`), otp.codeHash)) {
        otp.attempts += 1;
        await writeDb(db);
        throw new Error("That code is not correct. Please check the email and try again.");
      }
      delete member.fields.signInCode;
      member.fields.lastSignInAt = new Date().toISOString();
      const token = randomBytes(32).toString("hex");
      db.sessions.push({
        token: memberSessionKey(token),
        adminId: member.id,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + MEMBER_SESSION_TTL_MS).toISOString()
      });
      await writeDb(db);
      setMemberCookie(res, token);
      send(res, 200, { profile: buildMemberProfile(db, email) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/member/me" && req.method === "GET") {
    const ctx = await getMemberContext(req).catch(() => null);
    send(res, 200, { profile: ctx ? buildMemberProfile(ctx.db, ctx.email) : null });
    return true;
  }

  if (url.pathname === "/api/member/logout" && req.method === "POST") {
    const ctx = await getMemberContext(req).catch(() => null);
    if (ctx) {
      ctx.db.sessions = ctx.db.sessions.filter(session => session.token !== ctx.sessionKey);
      await writeDb(ctx.db).catch(() => {});
    }
    clearMemberCookie(res);
    send(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/api/member/profile" && req.method === "POST") {
    const ctx = await getMemberContext(req);
    if (!ctx) {
      send(res, 401, { error: "Please sign in again." });
      return true;
    }
    try {
      const body = await parseBody(req, 2_500_000);
      const fullName = cleanText(body.fullName).slice(0, 120);
      const phone = cleanText(body.phoneNumber).slice(0, 30);
      if (!fullName) throw new Error("Please enter your full name.");
      if (phone && phone.replace(/\D/g, "").length < 7) throw new Error("Please enter a valid phone number.");
      const photo = body.photo ? parsePhoto(body.photo) : null;
      const db = await readDb();
      const record = memberRecord(db, ctx.email);
      if (!record) throw new Error("Please sign in again.");
      const previousPhotoPath = record.fields.photoPath;
      if (photo) {
        const photoPath = `${record.id}.${photo.extension}`;
        await savePhoto(photoPath, photo);
        record.fields.photoPath = photoPath;
        record.fields.photoType = photo.contentType;
      }
      record.fields.fullName = fullName;
      record.fields.name = fullName;
      record.fields.phoneNumber = phone;
      record.updatedAt = new Date().toISOString();
      await writeDb(db);
      if (photo && previousPhotoPath && previousPhotoPath !== record.fields.photoPath) await deletePhoto(previousPhotoPath);
      send(res, 200, { profile: buildMemberProfile(db, ctx.email) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  const memberPhotoMatch = url.pathname.match(/^\/api\/member\/photo\/([^/]+)$/);
  if (memberPhotoMatch && req.method === "GET") {
    const ctx = await getMemberContext(req);
    if (!ctx) {
      send(res, 401, { error: "Please sign in again." });
      return true;
    }
    const db = await readDb();
    const record = db.submissions.find(item => item.id === memberPhotoMatch[1]);
    const owned = record && emailKeyOf(emailAddress(record.fields)) === ctx.email;
    const bytes = owned && record.fields.photoPath ? await readPhoto(record.fields.photoPath) : null;
    if (!bytes) {
      send(res, 404, { error: "Photo not found." });
      return true;
    }
    res.writeHead(200, { "Content-Type": record.fields.photoType || "image/jpeg", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" });
    res.end(bytes);
    return true;
  }

  if (url.pathname === "/api/cell/overview" && req.method === "GET") {
    const db = await readDb();
    const ctx = requireCellAccess(req, res, db);
    if (!ctx) return true;
    send(res, 200, cellOverview(db, ctx));
    return true;
  }

  if (url.pathname === "/api/cell/reports" && req.method === "POST") {
    const db = await readDb();
    const ctx = requireCellAccess(req, res, db);
    if (!ctx) return true;
    try {
      const body = await parseBody(req);
      const cell = ctx.cells.find(name => sameCellName(name, cleanText(body.cell)));
      if (!cell) {
        send(res, 403, { error: "You can only send reports for your own cells." });
        return true;
      }
      const meetingDate = cleanText(body.meetingDate);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate) || Number.isNaN(Date.parse(`${meetingDate}T00:00:00Z`))) throw new Error("Please choose the meeting date.");
      if (meetingDate > lagosDateKey()) throw new Error("The meeting date can't be in the future.");
      const held = body.held === "no" ? "no" : "yes";
      const members = cellMembers(db, cell);
      const memberIds = new Set(members.map(member => member.id));
      const present = held === "yes" ? idList(body.present, memberIds) : [];
      const absent = held === "yes" ? members.map(member => member.id).filter(id => !present.includes(id)) : [];
      const visitors = held === "yes" && Array.isArray(body.visitors)
        ? body.visitors.slice(0, 50)
          .map(visitor => ({ name: cleanText(visitor?.name).slice(0, 120), phone: cleanText(visitor?.phone).slice(0, 30), addToCell: visitor?.addToCell !== false }))
          .filter(visitor => visitor.name)
        : [];
      const offering = Math.max(0, Math.round(Number(String(body.offering || "0").replace(/[^\d.]/g, "")) || 0));
      const leader = ctx.admin;

      // Visitors who want to join become cell members straight away (unless
      // already in this cell), so they're on the list at the next meeting.
      const added = [];
      for (const visitor of visitors.filter(item => item.addToCell)) {
        const phoneKey = visitor.phone.replace(/\D/g, "").slice(-10);
        const alreadyMember = db.submissions.some(record => record.type === "community"
          && sameCellName(record.fields.preferredCommunity, cell)
          && ((phoneKey.length === 10 && String(phoneNumber(record.fields)).replace(/\D/g, "").slice(-10) === phoneKey)
            || displayName(record.fields).toLowerCase() === visitor.name.toLowerCase()));
        if (alreadyMember) continue;
        const record = {
          id: randomUUID(),
          type: "community",
          fields: { fullName: visitor.name, name: visitor.name, phoneNumber: visitor.phone, preferredCommunity: cell, addedBy: `${leader.name} (cell report ${meetingDate})` },
          shortCode: createShortCode(db),
          status: "Added by cell leader",
          createdAt: new Date().toISOString()
        };
        db.submissions.push(record);
        added.push(visitor.name);
      }

      const fields = {
        cell,
        meetingDate,
        week: weekOf(meetingDate),
        held,
        topic: cleanText(body.topic).slice(0, 200),
        notes: cleanText(body.notes),
        offering,
        present,
        absent,
        visitors: visitors.map(({ name, phone }) => ({ name, phone })),
        memberCount: members.length,
        presentCount: present.length,
        visitorCount: visitors.length,
        leaderId: leader.id,
        leaderName: leader.name
      };
      // One report per cell per week: any date in the same week edits it.
      const existing = db.submissions.find(record => record.type === "cell_report" && sameCellName(record.fields.cell, cell) && weekOf(record.fields.meetingDate) === fields.week);
      if (existing) {
        existing.fields = fields;
        existing.updatedAt = new Date().toISOString();
      } else {
        db.submissions.push({
          id: /^[0-9a-f-]{36}$/i.test(String(body.submissionId)) && !db.submissions.some(record => record.id === body.submissionId) ? body.submissionId : randomUUID(),
          type: "cell_report",
          fields,
          shortCode: createShortCode(db),
          status: "Submitted",
          createdAt: new Date().toISOString()
        });
      }
      addAuditLog(db, leader, existing ? "Updated cell report" : "Submitted cell report", `${cell} - ${meetingDate}${added.length ? ` (added ${added.length} visitor${added.length === 1 ? "" : "s"} to the cell)` : ""}`);
      await writeDb(db);
      send(res, existing ? 200 : 201, { updated: Boolean(existing), added, overview: cellOverview(db, ctx) });
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
      const db = await readDb();
      const admin = db.admins.find(item => item.email === email);
      if (!admin || admin.active === false || !verifyPassword(password, admin.passwordHash)) {
        registerFailedLogin(attemptKey);
        throw new Error("Incorrect email or password.");
      }
      clearLoginAttempts(attemptKey);
      admin.lastLoginAt = new Date().toISOString();
      const session = createSession(db, admin.id);
      addAuditLog(db, admin, "Signed in");
      await writeDb(db);
      setSessionCookie(res, session.token);
      send(res, 200, { admin: sanitizeAdmin(admin) });
    } catch (error) {
      send(res, 401, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/admin/logout" && req.method === "POST") {
    const db = await readDb();
    const token = parseCookies(req.headers.cookie).ha_session;
    if (token) {
      const before = db.sessions.length;
      db.sessions = db.sessions.filter(item => item.token !== token);
      if (db.sessions.length !== before) await writeDb(db);
    }
    clearSessionCookie(res);
    send(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === "/api/admin/me" && req.method === "GET") {
    const db = await readDb();
    const ctx = getSessionContext(req, db);
    send(res, 200, { admin: ctx ? sanitizeAdmin(ctx.admin) : null });
    return true;
  }

  if (url.pathname === "/api/admin/change-password" && req.method === "POST") {
    const db = await readDb();
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
      await writeDb(db);
      send(res, 200, { admin: sanitizeAdmin(ctx.admin) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  const submissionMatch = url.pathname.match(/^\/api\/admin\/submissions\/([^/]+)$/);
  if (submissionMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    const db = await readDb();
    if (req.method === "DELETE") {
      const ctx = requireAdminSession(req, res, db, "delete_submissions");
      if (!ctx) return true;
      const index = db.submissions.findIndex(record => record.id === submissionMatch[1]);
      if (index === -1) { send(res, 404, { error: "Submission not found." }); return true; }
      const [removed] = db.submissions.splice(index, 1);
      addAuditLog(db, ctx.admin, "Deleted submission", `${removed.type} - ${removed.shortCode || removed.id}`);
      await writeDb(db);
      if (removed.fields?.photoPath) await deletePhoto(removed.fields.photoPath);
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
      await writeDb(db);
      send(res, 200, { record, dashboard: dashboard(db) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/admin/launch-items" && req.method === "POST") {
    const db = await readDb();
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
      await writeDb(db);
      send(res, 201, { item, dashboard: dashboard(db) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  const launchItemMatch = url.pathname.match(/^\/api\/admin\/launch-items\/([^/]+)$/);
  if (launchItemMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    const db = await readDb();
    const ctx = requireAdminSession(req, res, db, "manage_content");
    if (!ctx) return true;
    const index = db.seed.launchItems.findIndex(entry => entry.id === launchItemMatch[1]);
    if (index === -1) { send(res, 404, { error: "Launch item not found." }); return true; }
    if (req.method === "DELETE") {
      const [removed] = db.seed.launchItems.splice(index, 1);
      addAuditLog(db, ctx.admin, "Removed launch item", removed.item);
      await writeDb(db);
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
      await writeDb(db);
      send(res, 200, { item, dashboard: dashboard(db) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/admin/admins" && req.method === "GET") {
    const db = await readDb();
    const ctx = requireAdminSession(req, res, db, "manage_admins");
    if (!ctx) return true;
    send(res, 200, { admins: db.admins.map(sanitizeAdmin), permissions: ALL_PERMISSIONS, roles: ROLES });
    return true;
  }

  if (url.pathname === "/api/admin/admins" && req.method === "POST") {
    const db = await readDb();
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
      const permissions = Array.isArray(body.permissions) || role === "cell_leader"
        ? cleanPermissions(role, body.permissions)
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
      await writeDb(db);
      send(res, 201, { admin: sanitizeAdmin(admin) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  const adminMatch = url.pathname.match(/^\/api\/admin\/admins\/([^/]+)$/);
  if (adminMatch && (req.method === "PATCH" || req.method === "DELETE")) {
    const db = await readDb();
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
      await writeDb(db);
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
      const nextRole = body.role !== undefined && ROLES.includes(body.role) ? body.role : target.role;
      const nextPermissions = Array.isArray(body.permissions) || (nextRole === "cell_leader" && nextRole !== target.role)
        ? cleanPermissions(nextRole, body.permissions)
        : body.role !== undefined ? ROLE_DEFAULTS[nextRole].slice() : target.permissions;
      if (body.name !== undefined) target.name = cleanText(body.name);
      target.role = nextRole;
      target.permissions = nextPermissions;
      if (body.active !== undefined) target.active = Boolean(body.active);
      if (body.newPassword) {
        if (String(body.newPassword).length < 8) throw new Error("Password must be at least 8 characters.");
        target.passwordHash = hashPassword(body.newPassword);
        target.mustChangePassword = true;
        db.sessions = db.sessions.filter(item => item.adminId !== target.id);
      }
      addAuditLog(db, ctx.admin, "Updated admin account", `${target.name} (${target.email})`);
      await writeDb(db);
      send(res, 200, { admin: sanitizeAdmin(target) });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/admin/audit-log" && req.method === "GET") {
    const db = await readDb();
    const ctx = requireAdminSession(req, res, db, "view_dashboard");
    if (!ctx) return true;
    send(res, 200, { entries: db.auditLog.slice(0, 100) });
    return true;
  }

  if (url.pathname === "/api/admin/sms-audience" && req.method === "GET") {
    const db = await readDb();
    if (!requireBroadcastAccess(req, res, db)) return true;
    const recipients = optedInPhones(db);
    send(res, 200, {
      sms: { audience: "opted-in", recipients: recipients.length, maximumPerSend: 100 },
      email: { audience: "newsletter and opted-in", recipients: optedInEmails(db).length, maximumPerSend: 100 }
    });
    return true;
  }

  if (url.pathname === "/api/admin/bulk-sms" && req.method === "POST") {
    const db = await readDb();
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
        await writeDb(db);
      }
      send(res, 200, { ok: true, recipients: recipients.length, delivery });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname === "/api/admin/bulk-email" && req.method === "POST") {
    const db = await readDb();
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
        await writeDb(db);
      }
      send(res, 200, { ok: true, recipients: recipients.length, delivery });
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return true;
  }

  if (url.pathname.startsWith("/api/short-code/") && req.method === "GET") {
    const code = url.pathname.split("/").pop();
    const record = findByShortCode(await readDb(), code);
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
      const db = await readDb();
      // A check-in saved offline and resent (or retried after a dropped
      // response) carries the same submissionId: return the original.
      const submissionId = cleanText(body.submissionId || "");
      const existing = submissionId && db.submissions.find(record => record.id === submissionId);
      if (existing) {
        send(res, 200, { record: existing });
        return true;
      }
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
        id: /^[0-9a-f-]{36}$/i.test(submissionId) ? submissionId : randomUUID(),
        type: "attendance",
        fields,
        status: "Checked in",
        createdAt: new Date().toISOString()
      };
      db.submissions.push(record);
      await writeDb(db);
      send(res, 201, { record });
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
    const db = await readDb();
    const ctx = requireAdminSession(req, res, db, "view_dashboard");
    if (!ctx) return true;
    send(res, 200, dashboard(db));
    return true;
  }

  if (url.pathname === "/api/export" && req.method === "GET") {
    const db = await readDb();
    const ctx = requireAdminSession(req, res, db, "export_data");
    if (!ctx) return true;
    const type = url.searchParams.get("type");
    let body;
    let filename;
    if (type === "community") {
      body = csvCommunity(db.submissions.filter(record => record.type === "community"));
      filename = "harvesters-akure-communities.csv";
    } else if (type === "workforce") {
      body = csvWorkforce(db.submissions.filter(record => record.type === "workforce"));
      filename = "harvesters-akure-workforce.csv";
    } else if (type === "birthday") {
      const protocol = String(req.headers["x-forwarded-proto"] || url.protocol.replace(":", "")).split(",")[0];
      body = csvBirthdays(db.submissions.filter(record => record.type === "birthday"), `${protocol}://${url.host}`);
      filename = "harvesters-akure-birthdays.csv";
    } else {
      body = csv(db.submissions);
      filename = "harvesters-akure-submissions.csv";
    }
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    send(res, 200, body, "text/csv; charset=utf-8");
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
  try {
    if (url.pathname.startsWith("/api") && await handleApi(req, res, url)) return;
  } catch (error) {
    // A route handler threw without its own try/catch (e.g. readDb() itself
    // failing) -- surface a clean JSON error instead of an opaque platform
    // crash page, and never leave the response hanging.
    if (!res.headersSent) send(res, 500, { error: error.message || "Something went wrong." });
    return;
  }
  serveStatic(req, res, url);
}

if (!process.env.VERCEL) {
  createServer(requestHandler).listen(port, "127.0.0.1", () => {
    if (!useSupabase) ensureDb();
    console.log(`Harvesters Akure server running at http://127.0.0.1:${port}`);
    console.log(`Database: ${useSupabase ? "Supabase" : "local JSON file"}`);
  });
}
