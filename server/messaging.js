import { memberEmailFrom, resendApiKey, termiiApiKey, termiiBaseUrl, termiiChannel, termiiEmailConfigurationId, termiiEmailTemplateId, termiiSenderId } from "./config.js";
import { cleanText } from "./http.js";
import { emailAddress, phoneNumber } from "./records.js";

export function termiiEmailReady() {
  return Boolean(termiiApiKey && termiiBaseUrl && termiiEmailConfigurationId && termiiEmailTemplateId);
}

export async function sendResendEmail(to, subject, text, html) {
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

function hasCommunicationsConsent(record) {
  return record.fields?.communicationsConsent === "on";
}

function normalizeNigeriaPhone(value) {
  const digits = cleanText(value).replace(/\D/g, "");
  if (/^0\d{10}$/.test(digits)) return `234${digits.slice(1)}`;
  if (/^234\d{10}$/.test(digits)) return digits;
  return "";
}

export function optedInPhones(db) {
  return [...new Set(db.submissions
    .filter(hasCommunicationsConsent)
    .map(record => normalizeNigeriaPhone(phoneNumber(record.fields)))
    .filter(Boolean))];
}

export function optedInEmails(db) {
  return [...new Set(db.submissions
    .filter(record => record.type === "newsletter" || hasCommunicationsConsent(record))
    .map(record => emailAddress(record.fields).toLowerCase())
    .filter(email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))];
}

export async function sendTermiiBulkSms(recipients, message) {
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

export async function sendTermiiBulkEmail(recipients, subject, message) {
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
