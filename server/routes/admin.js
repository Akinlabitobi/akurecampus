import { randomUUID } from "node:crypto";
import { ALL_PERMISSIONS, ROLES, ROLE_DEFAULTS, addAuditLog, cleanPermissions, clearLoginAttempts, clearSessionCookie, createSession, getSessionContext, hashPassword, isLoginLocked, loginAttemptKey, parseCookies, registerFailedLogin, requireAdminSession, sanitizeAdmin, setSessionCookie, verifyPassword } from "../auth.js";
import { readDb, writeDb } from "../db.js";
import { cleanText, parseBody, send } from "../http.js";
import { deletePhoto, readPhoto } from "../photos.js";
import { dashboard } from "../records.js";

// Admin sign-in, submissions, launch items, admin accounts and audit log.
export async function adminRoutes(req, res, url) {

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

  return false;
}
