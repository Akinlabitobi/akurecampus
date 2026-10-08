import { cleanText } from "./http.js";
import { EMAIL_PATTERN, emailKeyOf } from "./members.js";
import { lagosDateKey } from "./records.js";

export function validateBirthday(body) {
  const fields = {
    fullName: cleanText(body.fullName).slice(0, 120),
    phoneNumber: cleanText(body.phoneNumber).slice(0, 30),
    emailAddress: emailKeyOf(cleanText(body.emailAddress)),
    dateOfBirth: cleanText(body.dateOfBirth),
    photoConsent: body.photoConsent === "on" ? "on" : ""
  };
  if (!fields.fullName) throw new Error("Please enter the celebrant's full name.");
  if (fields.phoneNumber.replace(/\D/g, "").length < 7) throw new Error("Please enter a valid phone number.");
  if (!EMAIL_PATTERN.test(fields.emailAddress)) throw new Error("Please enter a valid email address.");
  const date = new Date(`${fields.dateOfBirth}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.dateOfBirth) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== fields.dateOfBirth) {
    throw new Error("Please enter a valid date of birth.");
  }
  if (fields.dateOfBirth < "1900-01-01" || fields.dateOfBirth > lagosDateKey()) throw new Error("Please enter a date of birth in the past.");
  if (!fields.photoConsent) throw new Error("Please confirm we may share the photo when celebrating the birthday.");
  return fields;
}

export function sameCelebrant(record, fields) {
  return record.type === "birthday"
    && record.fields.phoneNumber.replace(/\D/g, "").slice(-10) === fields.phoneNumber.replace(/\D/g, "").slice(-10)
    && record.fields.fullName.toLowerCase().replace(/\s+/g, " ") === fields.fullName.toLowerCase().replace(/\s+/g, " ");
}
