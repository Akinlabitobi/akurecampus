import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ALL_PERMISSIONS, hashPassword, randomPassword } from "./auth.js";
import { dataDir, dbPath, supabase, useSupabase } from "./config.js";
import { sha256 } from "./members.js";

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

export function ensureDb() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(dbPath)) writeFileSync(dbPath, JSON.stringify(defaultDb, null, 2));
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

export function assertNoError(error, context) {
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

export async function readDb() {
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

export async function writeDb(db) {
  return useSupabase ? writeDbToSupabase(db) : writeDbToFile(db);
}
