import { supabase, supabaseConfigured, missingConfigMarkup } from "../lib/supabaseClient.js";
import { normalizePhone, derivedEmail, telHref, whatsappHref } from "./phone.js";

const REACH_DETAILS = ["Yes", "No Answer", "Switched Off", "Invalid Number", "Busy"];
const OUTCOMES_AFTER_REACHED = ["Reached", "Will attend", "Needs follow-up", "Prayer request", "Wrong number", "Do not contact"];

function outcomeForReachDetail(reachDetail, chosenOutcome) {
  if (reachDetail === "Invalid Number") return "Wrong number";
  if (reachDetail === "Yes") return chosenOutcome || null;
  if (reachDetail) return "Not reached";
  return null;
}

const app = document.querySelector("#app");

let phase = "checking"; // checking | login | register | setpin | enterpin | not-an-agent | queue
let session = null;
let agent = null; // { id, display_name, phone }

let loginPhone = "";
let loginKind = null; // unknown | needs_pin | has_account
let loginAgentName = "";
let loginError = "";
let loginBusy = false;

let scriptContent = "";
let whatsappTemplate = "";
let weeklyAuditCount = null;
let contacts = null;
let contactsError = "";
let queueFilter = "todo";
let scriptOpen = false;
let openOutcomeFor = null;
let outcomeState = {}; // per contact-id: { reachDetail, outcome, needsBus, busPickup, wantsLocation, prefersWhatsapp, followUpDate, notes, saving, error }

const callTracking = new Map(); // contactId -> { callLogId, dialOpenedAtMs, hiddenSeconds }
let lastDialedContactId = null;
let hiddenSince = null;

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenSince = Date.now();
    return;
  }
  if (hiddenSince && lastDialedContactId) {
    const elapsed = Math.round((Date.now() - hiddenSince) / 1000);
    const tracked = callTracking.get(lastDialedContactId);
    if (tracked) tracked.hiddenSeconds = (tracked.hiddenSeconds || 0) + elapsed;
  }
  hiddenSince = null;
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function slug(value) {
  return String(value || "").replace(/\s+/g, "-");
}

async function init() {
  if (!supabaseConfigured) {
    render();
    return;
  }
  const { data } = await supabase.auth.getSession();
  session = data.session || null;
  supabase.auth.onAuthStateChange((_event, newSession) => {
    session = newSession;
  });
  if (session) {
    await afterAuth();
  } else {
    phase = "login";
    render();
  }
}

async function afterAuth() {
  const { data, error } = await supabase.from("agents").select("id, display_name, phone").maybeSingle();
  if (error || !data) {
    phase = "not-an-agent";
    render();
    return;
  }
  agent = data;
  phase = "queue";
  render();
  loadQueueData();
}

async function loadQueueData() {
  const [contactsRes, scriptRes, auditRes] = await Promise.all([
    supabase.from("contacts").select("*").order("created_at", { ascending: true }),
    supabase.from("call_script").select("content, whatsapp_template").eq("id", true).maybeSingle(),
    supabase.rpc("weekly_audit_count")
  ]);
  if (contactsRes.error) {
    contactsError = contactsRes.error.message;
    contacts = [];
  } else {
    contacts = contactsRes.data || [];
  }
  if (scriptRes.data) {
    scriptContent = scriptRes.data.content || "";
    whatsappTemplate = scriptRes.data.whatsapp_template || "";
  }
  if (!auditRes.error) weeklyAuditCount = auditRes.data;
  render();
}

function topbar() {
  return `
    <header class="cc-topbar">
      <span class="cc-brand"><img src="/logo-black.png" alt="Harvesters Akure" /> Outreach</span>
      ${agent ? `<span class="cc-who">${escapeHtml(agent.display_name)} <button class="btn ghost small" type="button" data-sign-out>Sign Out</button></span>` : ""}
    </header>
  `;
}

function render() {
  let body = "";
  if (!supabaseConfigured) {
    body = `<div class="cc-main">${missingConfigMarkup("Outreach Call Centre")}</div>`;
  } else if (phase === "checking") {
    body = `<div class="cc-center"><p class="cc-hint">Loading...</p></div>`;
  } else if (phase === "not-an-agent") {
    body = `
      <div class="cc-center">
        <div class="cc-auth-card">
          <h1>Not registered as an agent</h1>
          <p>This account is signed in, but is not set up as a calling agent. Contact your admin, or sign out and try a different phone number.</p>
          <button class="btn primary block" type="button" data-sign-out>Sign Out</button>
        </div>
      </div>
    `;
  } else if (phase === "queue") {
    body = queueView();
  } else {
    body = loginView();
  }
  app.innerHTML = `${supabaseConfigured && phase === "queue" ? topbar() : ""}${body}`;
  bind();
}

function loginView() {
  if (phase === "login") {
    return `
      <div class="cc-center">
        <div class="cc-auth-card">
          <img src="/logo-black.png" alt="Harvesters Akure" />
          <h1>Outreach Call Centre</h1>
          <p>Enter your phone number to sign in.</p>
          <form data-phone-form>
            <label><span>Phone number</span><input name="phone" type="tel" inputmode="numeric" placeholder="08012345678" required autofocus /></label>
            ${loginError ? `<p class="form-note error">${escapeHtml(loginError)}</p>` : ""}
            <button class="btn primary block" type="submit" ${loginBusy ? "disabled" : ""}>${loginBusy ? "Checking..." : "Continue"}</button>
          </form>
        </div>
      </div>
    `;
  }
  if (phase === "register") {
    return `
      <div class="cc-center">
        <div class="cc-auth-card">
          <h1>New number</h1>
          <p>We don't recognize <strong>${escapeHtml(loginPhone)}</strong> yet. Enter your name to register.</p>
          <form data-register-form>
            <label><span>Full name</span><input name="name" type="text" required autofocus /></label>
            ${loginError ? `<p class="form-note error">${escapeHtml(loginError)}</p>` : ""}
            <button class="btn primary block" type="submit" ${loginBusy ? "disabled" : ""}>${loginBusy ? "Registering..." : "Register & Continue"}</button>
          </form>
          <button class="btn ghost-dark" type="button" data-back-to-phone>Use a different number</button>
        </div>
      </div>
    `;
  }
  if (phase === "setpin") {
    return `
      <div class="cc-center">
        <div class="cc-auth-card">
          <h1>Hi ${escapeHtml(loginAgentName || "there")}</h1>
          <p>Set a 6-digit PIN to finish setting up your account. You'll use this PIN to sign in from now on.</p>
          <form data-setpin-form>
            <label><span>New PIN</span><input class="cc-pin-input" name="pin" type="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" minlength="6" required autofocus /></label>
            <label><span>Confirm PIN</span><input class="cc-pin-input" name="pinConfirm" type="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" minlength="6" required /></label>
            ${loginError ? `<p class="form-note error">${escapeHtml(loginError)}</p>` : ""}
            <button class="btn primary block" type="submit" ${loginBusy ? "disabled" : ""}>${loginBusy ? "Saving..." : "Set PIN & Continue"}</button>
          </form>
          <button class="btn ghost-dark" type="button" data-back-to-phone>Use a different number</button>
        </div>
      </div>
    `;
  }
  if (phase === "enterpin") {
    return `
      <div class="cc-center">
        <div class="cc-auth-card">
          <h1>Hi ${escapeHtml(loginAgentName || "there")}</h1>
          <p>Enter your 6-digit PIN.</p>
          <form data-enterpin-form>
            <label><span>PIN</span><input class="cc-pin-input" name="pin" type="password" inputmode="numeric" pattern="\\d{6}" maxlength="6" minlength="6" required autofocus /></label>
            ${loginError ? `<p class="form-note error">${escapeHtml(loginError)}</p>` : ""}
            <button class="btn primary block" type="submit" ${loginBusy ? "disabled" : ""}>${loginBusy ? "Signing in..." : "Sign In"}</button>
          </form>
          <button class="btn ghost-dark" type="button" data-back-to-phone>Use a different number</button>
        </div>
      </div>
    `;
  }
  return "";
}

function queueView() {
  const todo = (contacts || []).filter(c => c.status === "Not started" && !c.do_not_contact);
  const shown = queueFilter === "todo" ? todo : (contacts || []);
  return `
    <main class="cc-main">
      ${contacts === null ? `<div class="cc-card"><p class="cc-hint">Loading your queue...</p></div>` : ""}
      ${contactsError ? `<div class="cc-card cc-card-warn"><p>${escapeHtml(contactsError)}</p></div>` : ""}
      ${weeklyAuditCount !== null ? `<p class="cc-hint" style="margin-bottom:14px;">${weeklyAuditCount} verification call${weeklyAuditCount === 1 ? "" : "s"} happened team-wide this week &mdash; a random check to keep logs honest.</p>` : ""}
      <div class="cc-card cc-script-toggle">
        <button class="btn secondary small" type="button" data-toggle-script>${scriptOpen ? "Hide call script" : "View call script"}</button>
        ${scriptOpen ? `<div class="cc-script-body">${escapeHtml(scriptContent) || "No script has been added yet."}</div>` : ""}
      </div>
      ${contacts !== null ? `
        <div class="cc-queue-tabs">
          <button class="${queueFilter === "todo" ? "active" : ""}" type="button" data-filter="todo">To do (${todo.length})</button>
          <button class="${queueFilter === "all" ? "active" : ""}" type="button" data-filter="all">All (${(contacts || []).length})</button>
        </div>
        ${shown.length ? shown.map(contactCard).join("") : `<div class="cc-empty">Nothing here. Ask your admin to allocate you contacts.</div>`}
      ` : ""}
    </main>
  `;
}

function contactCard(contact) {
  const normalized = normalizePhone(contact.phone);
  const showWhatsapp = contact.wants_location || contact.prefers_whatsapp;
  const outcomeOpen = openOutcomeFor === contact.id;
  const tags = [
    contact.status ? `<span class="cc-tag status-${slug(contact.status)}">${escapeHtml(contact.status)}</span>` : "",
    contact.priority ? `<span class="cc-tag">${escapeHtml(contact.priority)}</span>` : "",
    contact.segment ? `<span class="cc-tag">${escapeHtml(contact.segment)}</span>` : "",
    contact.do_not_contact ? `<span class="cc-tag status-Do-not-contact">Do not contact</span>` : ""
  ].filter(Boolean).join("");
  return `
    <article class="cc-contact-card" data-contact-id="${contact.id}">
      <div class="cc-contact-head">
        <div>
          <h3>${escapeHtml(contact.full_name)}</h3>
          <p class="cc-contact-meta">${escapeHtml(contact.phone)}${contact.email_or_area ? ` &middot; ${escapeHtml(contact.email_or_area)}` : ""}</p>
          ${contact.previous_response ? `<p class="cc-contact-meta">Previously: ${escapeHtml(contact.previous_response)}</p>` : ""}
        </div>
      </div>
      <div class="cc-tag-row">${tags}</div>
      ${!contact.do_not_contact ? `
        <div class="cc-actions-row">
          <a class="btn primary" href="${telHref(normalized)}" data-call-now data-id="${contact.id}">Call Now</a>
          ${showWhatsapp ? `<a class="btn secondary" href="${whatsappHref(normalized, whatsappTemplate)}" target="_blank" rel="noopener noreferrer" data-whatsapp data-id="${contact.id}">WhatsApp</a>` : ""}
          <button class="btn outline" type="button" data-log-outcome="${contact.id}">${outcomeOpen ? "Cancel" : "Log Outcome"}</button>
        </div>
        ${outcomeOpen ? outcomeForm(contact) : ""}
      ` : ""}
    </article>
  `;
}

function outcomeForm(contact) {
  const state = outcomeState[contact.id] || {};
  const showOutcomeButtons = state.reachDetail === "Yes";
  const impliedOutcome = outcomeForReachDetail(state.reachDetail, state.outcome);
  return `
    <div class="cc-outcome" data-outcome-form="${contact.id}">
      <p class="cc-hint">Call Reached?</p>
      <div class="cc-outcome-grid">
        ${REACH_DETAILS.map(option => `<button type="button" class="${state.reachDetail === option ? "selected" : ""}" data-reach-detail="${option}" data-id="${contact.id}">${option}</button>`).join("")}
      </div>
      ${showOutcomeButtons ? `
        <p class="cc-hint">What did they say?</p>
        <div class="cc-outcome-grid">
          ${OUTCOMES_AFTER_REACHED.map(option => `<button type="button" class="${state.outcome === option ? "selected" : ""}" data-outcome="${option}" data-id="${contact.id}">${option}</button>`).join("")}
        </div>
      ` : ""}
      ${state.reachDetail && !showOutcomeButtons ? `<p class="cc-hint">Will be logged as <strong>${escapeHtml(impliedOutcome || "")}</strong>.</p>` : ""}
      <label class="cc-checkline"><input type="checkbox" data-needs-bus="${contact.id}" ${state.needsBus ? "checked" : ""} /> Needs a bus</label>
      ${state.needsBus ? `<label><span class="cc-hint">Pickup location</span><input type="text" data-bus-pickup="${contact.id}" value="${escapeHtml(state.busPickup || "")}" /></label>` : ""}
      <label class="cc-checkline"><input type="checkbox" data-wants-location="${contact.id}" ${state.wantsLocation ? "checked" : ""} /> Asked for the church address</label>
      <label class="cc-checkline"><input type="checkbox" data-prefers-whatsapp="${contact.id}" ${state.prefersWhatsapp ? "checked" : ""} /> Prefers WhatsApp going forward</label>
      <label><span class="cc-hint">Follow-up date (optional)</span><input type="date" data-follow-up="${contact.id}" value="${state.followUpDate || ""}" /></label>
      <label><span class="cc-hint">Notes (optional)</span><input type="text" data-notes="${contact.id}" data-tall value="${escapeHtml(state.notes || "")}" /></label>
      ${state.error ? `<p class="form-note error">${escapeHtml(state.error)}</p>` : ""}
      <button class="btn primary block" type="button" data-save-outcome="${contact.id}" ${state.saving ? "disabled" : ""}>${state.saving ? "Saving..." : "Save Outcome"}</button>
    </div>
  `;
}

function setOutcomeState(contactId, patch) {
  outcomeState[contactId] = { ...(outcomeState[contactId] || {}), ...patch };
}

async function ensureCallLog(contactId) {
  let tracked = callTracking.get(contactId);
  if (tracked?.callLogId) return tracked;
  const dialOpenedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("call_logs")
    .insert({ contact_id: contactId, agent_id: agent.id, dial_opened_at: dialOpenedAt, channel: "call", source: "app" })
    .select("id")
    .single();
  if (error) throw error;
  tracked = { callLogId: data.id, dialOpenedAtMs: Date.now(), hiddenSeconds: 0 };
  callTracking.set(contactId, tracked);
  return tracked;
}

async function saveOutcome(contactId) {
  const state = outcomeState[contactId] || {};
  const outcome = outcomeForReachDetail(state.reachDetail, state.outcome);
  if (!state.reachDetail) {
    setOutcomeState(contactId, { error: "Choose whether the call was reached." });
    render();
    return;
  }
  if (state.reachDetail === "Yes" && !state.outcome) {
    setOutcomeState(contactId, { error: "Choose what the contact said." });
    render();
    return;
  }
  setOutcomeState(contactId, { saving: true, error: "" });
  render();
  try {
    const tracked = await ensureCallLog(contactId);
    const awaySeconds = tracked.hiddenSeconds || Math.round((Date.now() - tracked.dialOpenedAtMs) / 1000);
    const { error: logError } = await supabase
      .from("call_logs")
      .update({
        completed_at: new Date().toISOString(),
        outcome,
        reach_detail: state.reachDetail,
        notes: state.notes || null,
        away_seconds: awaySeconds
      })
      .eq("id", tracked.callLogId);
    if (logError) throw logError;
    const { error: contactError } = await supabase
      .from("contacts")
      .update({
        status: outcome,
        needs_bus: state.needsBus || false,
        bus_pickup_location: state.needsBus ? state.busPickup || null : null,
        wants_location: state.wantsLocation || false,
        prefers_whatsapp: state.prefersWhatsapp || false,
        follow_up_date: state.followUpDate || null,
        do_not_contact: outcome === "Do not contact"
      })
      .eq("id", contactId);
    if (contactError) throw contactError;
    callTracking.delete(contactId);
    delete outcomeState[contactId];
    openOutcomeFor = null;
    contacts = contacts.map(c => (c.id === contactId ? { ...c, status: outcome, do_not_contact: outcome === "Do not contact" } : c));
    render();
  } catch (error) {
    setOutcomeState(contactId, { saving: false, error: error.message || "Could not save this outcome." });
    render();
  }
}

function bind() {
  document.querySelector("[data-sign-out]")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    session = null;
    agent = null;
    contacts = null;
    phase = "login";
    loginPhone = "";
    loginKind = null;
    render();
  });

  document.querySelector("[data-back-to-phone]")?.addEventListener("click", () => {
    phase = "login";
    loginError = "";
    render();
  });

  document.querySelector("[data-phone-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const raw = new FormData(event.target).get("phone");
    const normalized = normalizePhone(raw);
    if (normalized.length < 10) {
      loginError = "Enter a valid phone number.";
      render();
      return;
    }
    loginPhone = normalized;
    loginError = "";
    loginBusy = true;
    render();
    try {
      const { data, error } = await supabase.rpc("agent_login_kind", { p_phone: normalized });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      loginKind = row?.kind || "unknown";
      loginAgentName = row?.agent_name || "";
      phase = loginKind === "unknown" ? "register" : loginKind === "needs_pin" ? "setpin" : "enterpin";
    } catch (error) {
      loginError = error.message || "Could not look up that number.";
    } finally {
      loginBusy = false;
      render();
    }
  });

  document.querySelector("[data-register-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const name = new FormData(event.target).get("name");
    loginBusy = true;
    loginError = "";
    render();
    try {
      const { error } = await supabase.rpc("self_register_agent", { p_phone: loginPhone, p_name: name });
      if (error) throw error;
      loginAgentName = name;
      phase = "setpin";
    } catch (error) {
      loginError = error.message || "Could not register this number.";
    } finally {
      loginBusy = false;
      render();
    }
  });

  document.querySelector("[data-setpin-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const pin = formData.get("pin");
    const pinConfirm = formData.get("pinConfirm");
    if (!/^\d{6}$/.test(pin)) {
      loginError = "PIN must be exactly 6 digits.";
      render();
      return;
    }
    if (pin !== pinConfirm) {
      loginError = "PINs do not match.";
      render();
      return;
    }
    loginBusy = true;
    loginError = "";
    render();
    try {
      const { data, error } = await supabase.auth.signUp({ email: derivedEmail(loginPhone), password: pin });
      if (error) throw error;
      if (!data.session) {
        throw new Error("Account created, but email confirmation is required by this Supabase project. Ask your admin to disable \"Confirm email\" for the Email provider in Authentication settings.");
      }
      session = data.session;
      await afterAuth();
    } catch (error) {
      loginError = error.message || "Could not set your PIN.";
      loginBusy = false;
      render();
    }
  });

  document.querySelector("[data-enterpin-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const pin = new FormData(event.target).get("pin");
    loginBusy = true;
    loginError = "";
    render();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: derivedEmail(loginPhone), password: pin });
      if (error) throw error;
      session = data.session;
      await afterAuth();
    } catch (error) {
      loginError = "Incorrect PIN.";
      loginBusy = false;
      render();
    }
  });

  document.querySelector("[data-toggle-script]")?.addEventListener("click", () => {
    scriptOpen = !scriptOpen;
    render();
  });

  document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
    queueFilter = button.dataset.filter;
    render();
  }));

  document.querySelectorAll("[data-call-now]").forEach(link => link.addEventListener("click", async event => {
    const contactId = event.currentTarget.dataset.id;
    event.preventDefault();
    const href = event.currentTarget.getAttribute("href");
    try {
      await ensureCallLog(contactId);
      lastDialedContactId = contactId;
      openOutcomeFor = contactId;
      render();
    } finally {
      window.location.href = href;
    }
  }));

  document.querySelectorAll("[data-whatsapp]").forEach(link => link.addEventListener("click", async event => {
    const contactId = event.currentTarget.dataset.id;
    try {
      await supabase.from("call_logs").insert({
        contact_id: contactId,
        agent_id: agent.id,
        dial_opened_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        channel: "whatsapp",
        source: "app"
      });
    } catch {
      // best-effort logging; never block the WhatsApp link itself
    }
  }));

  document.querySelectorAll("[data-log-outcome]").forEach(button => button.addEventListener("click", () => {
    const id = button.dataset.logOutcome;
    openOutcomeFor = openOutcomeFor === id ? null : id;
    render();
  }));

  document.querySelectorAll("[data-reach-detail]").forEach(button => button.addEventListener("click", () => {
    setOutcomeState(button.dataset.id, { reachDetail: button.dataset.reachDetail, outcome: null, error: "" });
    render();
  }));

  document.querySelectorAll("[data-outcome]").forEach(button => button.addEventListener("click", () => {
    setOutcomeState(button.dataset.id, { outcome: button.dataset.outcome, error: "" });
    render();
  }));

  document.querySelectorAll("[data-needs-bus]").forEach(input => input.addEventListener("change", () => {
    setOutcomeState(input.dataset.needsBus, { needsBus: input.checked });
    render();
  }));

  document.querySelectorAll("[data-bus-pickup]").forEach(input => input.addEventListener("input", () => {
    setOutcomeState(input.dataset.busPickup, { busPickup: input.value });
  }));

  document.querySelectorAll("[data-wants-location]").forEach(input => input.addEventListener("change", () => {
    setOutcomeState(input.dataset.wantsLocation, { wantsLocation: input.checked });
  }));

  document.querySelectorAll("[data-prefers-whatsapp]").forEach(input => input.addEventListener("change", () => {
    setOutcomeState(input.dataset.prefersWhatsapp, { prefersWhatsapp: input.checked });
  }));

  document.querySelectorAll("[data-follow-up]").forEach(input => input.addEventListener("input", () => {
    setOutcomeState(input.dataset.followUp, { followUpDate: input.value });
  }));

  document.querySelectorAll("[data-notes]").forEach(input => input.addEventListener("input", () => {
    setOutcomeState(input.dataset.notes, { notes: input.value });
  }));

  document.querySelectorAll("[data-save-outcome]").forEach(button => button.addEventListener("click", () => {
    saveOutcome(button.dataset.saveOutcome);
  }));
}

init();
