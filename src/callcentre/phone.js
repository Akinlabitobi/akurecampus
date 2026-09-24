// Shared by both the agent and admin pages so a phone number always maps to
// the exact same `agents.phone` / `contacts.phone` value and the exact same
// derived login email, no matter which page typed it in.
export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^0\d{10}$/.test(digits)) return `234${digits.slice(1)}`;
  if (/^234\d{10}$/.test(digits)) return digits;
  return digits;
}

// Matches the exact formula self_register_agent() uses in schema.sql, so a
// phone added here (admin quick-add) or there (self-registration) always
// resolves to the same Supabase Auth identity. Uses harvestersng.org (a
// real domain with real mail records) rather than an invented one -- see
// the long comment on the `phone` column in schema.sql for why: Supabase's
// signup validation rejects any email whose domain can't receive mail, and
// its native phone auth requires a paid SMS provider just to avoid this.
// No mailbox needs to exist at this address; only the domain is checked.
export function derivedEmail(normalizedPhone) {
  return `outreach-agent-${normalizedPhone}@harvestersng.org`;
}

export function telHref(normalizedPhone) {
  return `tel:+${normalizedPhone}`;
}

export function whatsappHref(normalizedPhone, message) {
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message || "")}`;
}
