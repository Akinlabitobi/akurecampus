import { createClient } from "@supabase/supabase-js";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const dataDir = join(root, "data");
export const dbPath = join(dataDir, "database.json");
export const distDir = join(root, "dist");
export const port = Number(process.env.PORT || 5174);
export const googleAppsScriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL || "";
export const googleAppsScriptToken = process.env.GOOGLE_APPS_SCRIPT_TOKEN || "";
export const termiiApiKey = process.env.TERMII_API_KEY || "";
export const termiiBaseUrl = (process.env.TERMII_BASE_URL || "").replace(/\/$/, "");
export const termiiSenderId = process.env.TERMII_SENDER_ID || "";
export const termiiChannel = process.env.TERMII_SMS_CHANNEL || "generic";
export const termiiEmailConfigurationId = process.env.TERMII_EMAIL_CONFIGURATION_ID || "";
export const termiiEmailTemplateId = process.env.TERMII_EMAIL_TEMPLATE_ID || "";
export const adminBroadcastToken = process.env.ADMIN_BROADCAST_TOKEN || "";
// Local development only: print member sign-in codes to the server console
// instead of emailing them. Ignored on Vercel.
export const memberOtpDevLog = process.env.MEMBER_OTP_DEV_LOG === "1" && !process.env.VERCEL;
// Resend (resend.com) sends member sign-in codes. The From address must be
// on a domain verified in the Resend dashboard.
export const resendApiKey = process.env.RESEND_API_KEY || "";
export const memberEmailFrom = process.env.MEMBER_EMAIL_FROM || "Harvesters Akure <noreply@harvestersng.org>";

// Site data (submissions, admins, sessions, audit log, launch items) lives
// in Supabase when these are set (see site-schema.sql) -- required on
// Vercel, since serverless functions there have a read-only filesystem and
// cannot write a local JSON file. Falls back to the local JSON file only
// when they're absent, so a plain `git clone` + `npm run dev` still works
// with zero setup for local-only contributors.
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const useSupabase = Boolean(supabaseUrl && supabaseServiceKey);
export const supabase = useSupabase
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
  : null;
