import { addAuditLog, requireBroadcastAccess } from "../auth.js";
import { readDb, writeDb } from "../db.js";
import { cleanText, parseBody, send } from "../http.js";
import { optedInEmails, optedInPhones, sendTermiiBulkEmail, sendTermiiBulkSms } from "../messaging.js";

// Bulk SMS and email to members who opted in.
export async function broadcastRoutes(req, res, url) {
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

  return false;
}
