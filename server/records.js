import { randomUUID } from "node:crypto";
import { communityOf, departmentOf } from "../src/lib/communities.js";
import { COMMUNITY_NAMES } from "./cells.js";
import { googleAppsScriptToken, googleAppsScriptUrl } from "./config.js";
import { cleanCode } from "./http.js";

export function makeShortCode(id) {
  return cleanCode(id).slice(0, 6);
}

export function createShortCode(db) {
  let code = "";
  do {
    code = makeShortCode(randomUUID());
  } while (db.submissions.some(record => (record.shortCode || makeShortCode(record.id)) === code));
  return code;
}

export function displayName(fields) {
  return fields.fullName || fields.name || "";
}

export function phoneNumber(fields) {
  return fields.phoneNumber || fields.phone || "";
}

export function emailAddress(fields) {
  return fields.emailAddress || fields.email || "";
}

export function attendeeFromRecord(record) {
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

export function findByShortCode(db, code) {
  const normalized = cleanCode(code);
  return db.submissions.find(record => (record.shortCode || makeShortCode(record.id)) === normalized);
}

export function lagosDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function dailyAttendanceCode(dateKey = lagosDateKey()) {
  const compact = dateKey.replaceAll("-", "");
  let total = 0;
  for (let index = 0; index < compact.length; index++) {
    total += Number(compact[index]) * (index + 3);
  }
  return `HA${String(total % 10000).padStart(4, "0")}`;
}

export function dashboard(db) {
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
      // Counts signups from either form that picked a community / team.
      community: submissions.filter(communityOf).length,
      workforce: submissions.filter(departmentOf).length,
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

// Every field on every public form is required. Mirrors the forms in
// src/ (the browser app); the browser checks first, this stops anyone skipping it.
const REQUIRED_FIELDS = {
  community: ["fullName", "phoneNumber", "emailAddress", "preferredCommunity", "areaInAkure", "dateOfBirth", "wouldYouLikeToLead"],
  workforce: ["fullName", "phoneNumber", "emailAddress", "department", "relevantExperience", "wouldYouLikeToLead"],
  cell_lead: ["fullName", "phoneNumber", "emailAddress", "areaInAkure", "preferredCell", "preferredMeetingDay", "leadershipExperience", "whyDoYouWantToLead"],
  counselling: ["fullName", "emailAddress", "phoneNumber", "careArea", "preferredTime"],
  nlp: ["fullName", "phoneNumber", "emailAddress", "prayerFocus"],
  giving: ["fullName", "phoneNumber", "emailAddress", "fund", "amount"],
  partnership: ["fullName", "phoneNumber", "emailAddress", "partnershipType", "message"],
  contact: ["fullName", "emailAddress", "subject", "message"],
  content: ["fullName", "emailAddress", "subject", "message"],
  newsletter: ["emailAddress"]
};

export function validateSubmission(type, fields) {
  const missing = (REQUIRED_FIELDS[type] || []).find(key => !String(fields[key] || "").trim());
  if (missing) throw new Error(`Please complete the ${missing.replace(/([A-Z])/g, " $1").toLowerCase()} field.`);
  // The follow-up picks are only asked for once the question is answered Yes.
  if (type === "community" && fields.wouldYouLikeToJoinTheWorkforce === "Yes" && !String(fields.workforceTeam || "").trim()) throw new Error("Please pick a workforce team.");
  if (type === "workforce" && fields.wouldYouLikeToJoinASmallGroup === "Yes" && !String(fields.smallGroup || "").trim()) throw new Error("Please pick a small group.");
  if (fields.smallGroup && !COMMUNITY_NAMES.includes(fields.smallGroup)) throw new Error("Please pick a small group from the list.");
  if (fields.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(fields.dateOfBirth)) throw new Error("Please enter a valid date of birth.");
  if (fields.emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.emailAddress)) throw new Error("Please enter a valid email address.");
  if (fields.phoneNumber && fields.phoneNumber.replace(/\D/g, "").length < 7) throw new Error("Please enter a valid phone number.");
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
export async function trySyncToGoogleSheet(record) {
  try {
    return await syncToGoogleSheet(record);
  } catch (error) {
    return { synced: false, error: error.message };
  }
}
