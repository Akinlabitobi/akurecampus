import { randomUUID } from "node:crypto";
import { sameCelebrant, validateBirthday } from "../birthdays.js";
import { googleAppsScriptToken, googleAppsScriptUrl, resendApiKey, termiiApiKey, termiiBaseUrl, termiiSenderId, useSupabase } from "../config.js";
import { readDb, writeDb } from "../db.js";
import { cleanCode, cleanText, parseBody, send } from "../http.js";
import { termiiEmailReady } from "../messaging.js";
import { deletePhoto, parsePhoto, savePhoto } from "../photos.js";
import { attendeeFromRecord, createShortCode, dailyAttendanceCode, findByShortCode, lagosDateKey, trySyncToGoogleSheet, validateSubmission } from "../records.js";

// Public forms, birthdays, attendance and health check.
export async function publicRoutes(req, res, url) {
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
      const missing = [["name", name], ["phone number", phone], ["department or group", cleanText(body.department)], ["service", cleanText(body.service)], ["note", cleanText(body.note)]].find(([, value]) => !value);
      if (missing) {
        send(res, 400, { error: `Please complete the ${missing[0]} field.` });
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

  return false;
}
