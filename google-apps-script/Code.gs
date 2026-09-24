/*
 * Harvesters Akure form receiver
 *
 * In Apps Script Project Settings, add these Script Properties:
 *   SPREADSHEET_ID       = 1JzFGrJ6Cc3lDpY5nAcC2P6FFuet4931_oiJq2Un9fYg
 *   FORM_SUBMISSION_TOKEN = the same value as GOOGLE_APPS_SCRIPT_TOKEN on the website server
 */

const COMMUNITY_SHEET = "Community Registrations";
const COUNSELLING_SHEET = "Counselling";

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData && event.postData.contents || "{}");
    const properties = PropertiesService.getScriptProperties();
    const expectedToken = properties.getProperty("FORM_SUBMISSION_TOKEN");

    if (!expectedToken || payload.token !== expectedToken) {
      return jsonResponse({ ok: false, error: "Unauthorized request." });
    }

    const formType = String(payload.formType || "").toLowerCase();
    const fields = payload.fields && typeof payload.fields === "object" ? payload.fields : {};
    const submissionId = clean(payload.submissionId, 100);

    if (!submissionId) throw new Error("Missing submission identifier.");
    if (!["registration", "counselling"].includes(formType)) throw new Error("Unsupported form type.");

    if (formType === "registration") validateRegistration(fields);
    if (formType === "counselling") validateCounselling(fields);

    const spreadsheetId = properties.getProperty("SPREADSHEET_ID");
    if (!spreadsheetId) throw new Error("Spreadsheet is not configured.");
    const sheet = getOrCreateSheet(SpreadsheetApp.openById(spreadsheetId), formType === "registration" ? COMMUNITY_SHEET : COUNSELLING_SHEET);

    if (hasSubmission(sheet, submissionId)) {
      return jsonResponse({ ok: true, duplicate: true, submissionId: submissionId });
    }

    if (formType === "registration") {
      sheet.appendRow([
        new Date(), submissionId, clean(fields.fullName), clean(fields.phoneNumber),
        clean(fields.preferredCommunity), clean(fields.areaInAkure), clean(fields.dateOfBirth), "New"
      ]);
    } else {
      sheet.appendRow([
        new Date(), submissionId, clean(fields.fullName), clean(fields.emailAddress), clean(fields.phoneNumber),
        clean(fields.careArea), clean(fields.message), clean(fields.preferredTime), "New"
      ]);
    }

    return jsonResponse({ ok: true, submissionId: submissionId });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || "Could not save submission." });
  }
}

function doGet() {
  return jsonResponse({ ok: true, service: "Harvesters Akure form receiver" });
}

function validateRegistration(fields) {
  ["fullName", "phoneNumber", "preferredCommunity", "areaInAkure", "dateOfBirth"].forEach(function (name) {
    if (!clean(fields[name])) throw new Error("Missing required registration field: " + name + ".");
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean(fields.dateOfBirth))) throw new Error("Date of birth must use YYYY-MM-DD.");
}

function validateCounselling(fields) {
  ["fullName", "phoneNumber", "careArea", "preferredTime"].forEach(function (name) {
    if (!clean(fields[name])) throw new Error("Missing required counselling field: " + name + ".");
  });
  const email = clean(fields.emailAddress);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Please provide a valid email address.");
}

function getOrCreateSheet(spreadsheet, name) {
  let sheet = spreadsheet.getSheetByName(name);
  if (sheet) return sheet;
  sheet = spreadsheet.insertSheet(name);
  const headers = name === COMMUNITY_SHEET
    ? ["Timestamp", "Submission ID", "Full Name", "Phone", "Preferred Community", "Area in Akure", "Date of Birth", "Status"]
    : ["Timestamp", "Submission ID", "Name", "Email", "Phone", "Counselling Type", "Message", "Preferred Contact Time", "Status"];
  sheet.appendRow(headers);
  sheet.setFrozenRows(1);
  return sheet;
}

function hasSubmission(sheet, submissionId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  return sheet.getRange(2, 2, lastRow - 1, 1).getValues().flat().includes(submissionId);
}

function clean(value, limit) {
  return String(value == null ? "" : value).trim().slice(0, limit || 500);
}

function jsonResponse(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
