import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { communityOf, departmentOf } from "../src/lib/communities.js";
import { parseCookies } from "./auth.js";
import { memberOtpDevLog, resendApiKey } from "./config.js";
import { readDb } from "./db.js";
import { sendResendEmail, sendTermiiBulkEmail, termiiEmailReady } from "./messaging.js";
import { createShortCode, displayName, emailAddress, phoneNumber } from "./records.js";

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

export const MEMBER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_MS = 60 * 1000;
export const OTP_MAX_SENDS_PER_HOUR = 5;
export const OTP_MAX_ATTEMPTS = 5;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const memberCodeRequests = new Map();
const MEMBER_SESSION_PREFIX = "member:";

export function emailKeyOf(value) {
  return String(value || "").trim().toLowerCase();
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function memberSessionKey(token) {
  return MEMBER_SESSION_PREFIX + sha256(token);
}

export function ensureMemberRecord(db, email) {
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

export function setMemberCookie(res, token) {
  const parts = [`ha_member=${token}`, "HttpOnly", "Path=/", `Max-Age=${MEMBER_SESSION_TTL_MS / 1000}`, "SameSite=Lax"];
  if (process.env.VERCEL) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearMemberCookie(res) {
  res.setHeader("Set-Cookie", "ha_member=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
}

// Only a hash of the session token is stored, so a leaked database row
// cannot be replayed as a cookie. Returns the database it read, for reuse.
export async function getMemberContext(req) {
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

export function memberRecord(db, email) {
  return db.submissions.find(record => record.type === "member" && emailKeyOf(record.fields.emailAddress) === email);
}

function sameName(a, b) {
  const tidy = value => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  return Boolean(tidy(a)) && tidy(a) === tidy(b);
}

const ACTIVITY_LABELS = {
  counselling: ["Care request", fields => fields.careArea],
  partnership: ["Partnership interest", fields => fields.partnershipType],
  cell_lead: ["Cell leader application", fields => fields.preferredCell],
  giving: ["Giving pledge", fields => [fields.fund, fields.amount && `₦${Number(fields.amount).toLocaleString("en-NG")}`].filter(Boolean).join(" · ")],
  nlp: ["Prayer updates", fields => fields.prayerFocus],
  contact: ["Message to the team", fields => fields.subject],
  content: ["Content idea", fields => fields.subject],
  newsletter: ["Newsletter signup", () => ""]
};

// What a signed-in member sees about themselves. Deliberately a curated
// summary, not the raw records: admin-only fields such as a care request's
// internal status never leave the server.
export function buildMemberProfile(db, email) {
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
    communities: records.filter(communityOf).map(record => ({ name: communityOf(record), date: record.createdAt })),
    departments: records.filter(departmentOf).map(record => ({ name: departmentOf(record), date: record.createdAt })),
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

export function emailSignInReady() {
  return Boolean(resendApiKey) || termiiEmailReady() || memberOtpDevLog;
}

export async function sendSignInCode(email, code) {
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

export function memberCodeRateLimited(req) {
  const key = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const recent = (memberCodeRequests.get(key) || []).filter(time => now - time < 15 * 60 * 1000);
  recent.push(now);
  memberCodeRequests.set(key, recent);
  return recent.length > 10;
}

export function codesMatch(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
