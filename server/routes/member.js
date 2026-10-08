import { randomBytes, randomInt } from "node:crypto";
import { readDb, writeDb } from "../db.js";
import { cleanText, parseBody, send } from "../http.js";
import { EMAIL_PATTERN, MEMBER_SESSION_TTL_MS, OTP_MAX_ATTEMPTS, OTP_MAX_SENDS_PER_HOUR, OTP_RESEND_MS, OTP_TTL_MS, buildMemberProfile, clearMemberCookie, codesMatch, emailKeyOf, emailSignInReady, ensureMemberRecord, getMemberContext, memberCodeRateLimited, memberRecord, memberSessionKey, sendSignInCode, setMemberCookie, sha256 } from "../members.js";
import { deletePhoto, parsePhoto, readPhoto, savePhoto } from "../photos.js";
import { emailAddress } from "../records.js";

// Member sign-in (emailed code) and My Profile.
export async function memberRoutes(req, res, url) {
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
      // Any email gets a code: someone new signs in and starts a fresh
      // profile, and anything they later submit with that email joins it.
      // Every email is treated alike, so the reply still reveals nothing
      // about who has given their details to the church.
      const reply = { ok: true, message: "A 6-digit code is on its way to your email. It expires in 10 minutes. If you can't see it, check your spam folder." };
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

  return false;
}
