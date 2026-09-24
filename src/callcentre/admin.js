import { supabase, supabaseConfigured, missingConfigMarkup } from "../lib/supabaseClient.js";
import { normalizePhone, derivedEmail } from "./phone.js";

const app = document.querySelector("#app");

let phase = "checking"; // checking | signed-out | link-sent | not-admin | dashboard
let session = null;
let adminEmail = "";
let authError = "";
let authBusy = false;

let activeTab = "overview";
let summary = null;
let dialedCount = null;
let weeklyAudits = null;
let campaigns = null;
let agents = null;
let unassignedCount = null;
let scriptContent = "";
let whatsappTemplate = "";
let scriptSaved = "";
let auditSample = null;
let auditForms = {};
let refillResult = "";
let importText = "";
let importCampaignId = "";
let importResult = "";
let quickAddText = "";
let quickAddResult = "";
let allocateAgentId = "";
let allocateCount = 20;
let allocateResult = "";
let leaderName = "";
let leaderPhone = "";
let leaderResult = "";
let newCampaignName = "";
let newCampaignDescription = "";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

async function init() {
  if (!supabaseConfigured) {
    render();
    return;
  }
  const { data } = await supabase.auth.getSession();
  session = data.session || null;
  supabase.auth.onAuthStateChange((_event, newSession) => {
    if (newSession && !session) {
      session = newSession;
      checkAdmin();
    }
  });
  if (session) {
    await checkAdmin();
  } else {
    phase = "signed-out";
    render();
  }
}

async function checkAdmin() {
  const { data, error } = await supabase.rpc("is_admin");
  if (error || !data) {
    phase = "not-admin";
    render();
    return;
  }
  phase = "dashboard";
  render();
  loadOverview();
}

async function loadOverview() {
  const [summaryRes, dialedRes, auditRes] = await Promise.all([
    supabase.rpc("agent_summary"),
    supabase.rpc("dialed_count"),
    supabase.rpc("weekly_audit_count")
  ]);
  if (!summaryRes.error) summary = summaryRes.data || [];
  if (!dialedRes.error) dialedCount = dialedRes.data;
  if (!auditRes.error) weeklyAudits = auditRes.data;
  render();
}

async function loadCampaigns() {
  const { data, error } = await supabase.from("campaigns").select("*").order("created_at", { ascending: false });
  campaigns = error ? [] : data;
  render();
}

async function loadAgents() {
  const { data, error } = await supabase.from("agents").select("id, display_name, phone, active, auth_user_id, created_at").order("created_at", { ascending: false });
  agents = error ? [] : data;
  render();
}

async function loadUnassignedCount() {
  const { count } = await supabase.from("contacts").select("id", { count: "exact", head: true }).is("assigned_agent_id", null).eq("is_leader_check", false);
  unassignedCount = count ?? 0;
  render();
}

async function loadScript() {
  const { data } = await supabase.from("call_script").select("content, whatsapp_template").eq("id", true).maybeSingle();
  if (data) {
    scriptContent = data.content || "";
    whatsappTemplate = data.whatsapp_template || "";
  }
  render();
}

function topbar() {
  return `
    <header class="cc-topbar">
      <span class="cc-brand"><img src="/logo-black.png" alt="Harvesters Akure" /> Call Centre Admin</span>
      ${phase === "dashboard" ? `<button class="btn ghost small" type="button" data-sign-out>Sign Out</button>` : ""}
    </header>
  `;
}

function render() {
  let body = "";
  if (!supabaseConfigured) {
    body = `<div class="cc-main">${missingConfigMarkup("Call Centre Admin")}</div>`;
  } else if (phase === "checking") {
    body = `<div class="cc-center"><p class="cc-hint">Loading...</p></div>`;
  } else if (phase === "signed-out") {
    body = signInView();
  } else if (phase === "link-sent") {
    body = `
      <div class="cc-center"><div class="cc-auth-card">
        <h1>Check your email</h1>
        <p>We sent a sign-in link to <strong>${escapeHtml(adminEmail)}</strong>. Open it on this device to continue.</p>
        <button class="btn ghost-dark" type="button" data-back-to-signin>Use a different email</button>
      </div></div>
    `;
  } else if (phase === "not-admin") {
    body = `
      <div class="cc-center"><div class="cc-auth-card">
        <h1>Not an admin</h1>
        <p>This email is signed in but is not on the admin allow-list.</p>
        <button class="btn primary block" type="button" data-sign-out>Sign Out</button>
      </div></div>
    `;
  } else {
    body = dashboardView();
  }
  app.innerHTML = `${supabaseConfigured && (phase === "dashboard") ? topbar() : ""}${body}`;
  bind();
}

function signInView() {
  return `
    <div class="cc-center">
      <div class="cc-auth-card">
        <img src="/logo-black.png" alt="Harvesters Akure" />
        <h1>Call Centre Admin</h1>
        <p>Sign in with your admin email. We'll send a one-time link.</p>
        <form data-signin-form>
          <label><span>Email</span><input name="email" type="email" required autofocus /></label>
          ${authError ? `<p class="form-note error">${escapeHtml(authError)}</p>` : ""}
          <button class="btn primary block" type="submit" ${authBusy ? "disabled" : ""}>${authBusy ? "Sending..." : "Send Sign-in Link"}</button>
        </form>
      </div>
    </div>
  `;
}

const TABS = ["overview", "campaigns", "agents", "allocate", "script", "audits"];

function dashboardView() {
  return `
    <section class="dashboard-shell">
      <aside>
        <span>Call Centre</span>
        ${TABS.map(tab => `<button class="${activeTab === tab ? "active" : ""}" data-tab="${tab}">${tab}</button>`).join("")}
      </aside>
      <section class="dashboard-main">
        <header>
          <div><span class="label">Admin</span><h1>${activeTab[0].toUpperCase()}${activeTab.slice(1)}</h1></div>
        </header>
        ${tabContent()}
      </section>
    </section>
  `;
}

function tabContent() {
  if (activeTab === "overview") return overviewTab();
  if (activeTab === "campaigns") return campaignsTab();
  if (activeTab === "agents") return agentsTab();
  if (activeTab === "allocate") return allocateTab();
  if (activeTab === "script") return scriptTab();
  if (activeTab === "audits") return auditsTab();
  return "";
}

function sum(rows, key) {
  return (rows || []).reduce((total, row) => total + Number(row[key] || 0), 0);
}

function overviewTab() {
  if (summary === null) return `<div class="panel"><h3>Loading...</h3></div>`;
  const totals = [
    ["Assigned", sum(summary, "assigned")],
    ["Dialed (people)", dialedCount ?? "-"],
    ["Connected", sum(summary, "connected")],
    ["Will Attend", sum(summary, "will_attend")],
    ["Needs Follow-up", sum(summary, "needs_follow_up")],
    ["Do Not Contact", sum(summary, "do_not_contact")]
  ];
  const rows = summary.map(row => [
    row.agent_name, row.assigned, row.calls_logged, row.connected, row.reached, row.not_reached,
    row.will_attend, row.needs_follow_up, row.prayer_request, row.whatsapp_sent, `${row.pct_done}%`
  ]);
  return `
    <div class="cc-tab-panel">
      <div class="cc-stat-strip">
        ${totals.map(([label, value]) => `<div class="cc-stat"><span>${label}</span><strong>${value}</strong></div>`).join("")}
        <div class="cc-stat"><span>Verification calls (7d)</span><strong>${weeklyAudits ?? "-"}</strong></div>
      </div>
      <div class="table"><table><thead><tr><th>Agent</th><th>Assigned</th><th>Logged</th><th>Connected</th><th>Reached</th><th>Not Reached</th><th>Will Attend</th><th>Follow-up</th><th>Prayer</th><th>WhatsApp</th><th>% Done</th></tr></thead>
      <tbody>${rows.length ? rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="11">No agents yet.</td></tr>`}</tbody></table></div>
    </div>
  `;
}

function campaignsTab() {
  if (campaigns === null) return `<div class="panel"><h3>Loading...</h3></div>`;
  const rows = campaigns.map(c => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.description || "-")}</td>
      <td>${c.active ? "Active" : "Inactive"}</td>
      <td>${new Date(c.created_at).toLocaleDateString()}</td>
      <td><button class="btn outline small" type="button" data-toggle-campaign="${c.id}" data-active="${c.active}">${c.active ? "Deactivate" : "Activate"}</button></td>
    </tr>
  `).join("");
  return `
    <div class="cc-tab-panel">
      <div class="table"><table><thead><tr><th>Name</th><th>Description</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No campaigns yet.</td></tr>`}</tbody></table></div>
      <div class="panel">
        <h3>New Campaign</h3>
        <form class="form inline-form" data-campaign-form>
          <label><span>Name</span><input name="name" required /></label>
          <label><span>Description</span><input name="description" /></label>
          <button class="btn primary" type="submit">Create Campaign</button>
        </form>
      </div>
    </div>
  `;
}

function agentsTab() {
  if (agents === null) return `<div class="panel"><h3>Loading...</h3></div>`;
  const rows = agents.map(a => `
    <tr>
      <td>${escapeHtml(a.display_name)}</td>
      <td>${escapeHtml(a.phone || "-")}</td>
      <td>${a.auth_user_id ? "Linked" : "Needs PIN"}</td>
      <td>${a.active ? "Active" : "Suspended"}</td>
      <td><button class="btn outline small" type="button" data-toggle-agent="${a.id}" data-active="${a.active}">${a.active ? "Suspend" : "Reactivate"}</button></td>
    </tr>
  `).join("");
  return `
    <div class="cc-tab-panel">
      <div class="table"><table><thead><tr><th>Name</th><th>Phone</th><th>Account</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="5">No agents yet.</td></tr>`}</tbody></table></div>
      <div class="panel">
        <h3>Quick-add Phone Numbers</h3>
        <p class="cc-hint">One per line: <code>Name, Phone</code> &mdash; or just a phone number (they'll set their own name after signing in).</p>
        <div class="cc-import-box"><textarea data-quickadd-text placeholder="Jane Doe, 08012345678&#10;08099998888">${escapeHtml(quickAddText)}</textarea></div>
        ${quickAddResult ? `<p class="form-note">${escapeHtml(quickAddResult)}</p>` : ""}
        <button class="btn primary" type="button" data-quickadd-submit>Add Agents</button>
      </div>
    </div>
  `;
}

function allocateTab() {
  return `
    <div class="cc-tab-panel">
      <div class="panel">
        <h3>Import Contacts</h3>
        <p class="cc-hint">Paste CSV with a header row: <code>full_name,phone,email_or_area,group_name,segment,source,priority,previous_response</code></p>
        <div class="cc-import-box"><textarea data-import-text placeholder="full_name,phone&#10;John Doe,08011112222">${escapeHtml(importText)}</textarea></div>
        <label><span class="cc-hint">Campaign</span>
          <select data-import-campaign>
            <option value="">No campaign</option>
            ${(campaigns || []).map(c => `<option value="${c.id}" ${importCampaignId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </label>
        ${importResult ? `<p class="form-note">${escapeHtml(importResult)}</p>` : ""}
        <button class="btn primary" type="button" data-import-submit>Import Contacts</button>
      </div>
      <div class="panel">
        <h3>Allocate to an Agent</h3>
        <p class="cc-hint">${unassignedCount === null ? "Loading unassigned count..." : `${unassignedCount} unassigned contact(s) available.`}</p>
        <label><span class="cc-hint">Agent</span>
          <select data-allocate-agent>
            <option value="">Choose an agent</option>
            ${(agents || []).filter(a => a.active).map(a => `<option value="${a.id}" ${allocateAgentId === a.id ? "selected" : ""}>${escapeHtml(a.display_name)}</option>`).join("")}
          </select>
        </label>
        <label><span class="cc-hint">How many</span><input type="number" min="1" data-allocate-count value="${allocateCount}" /></label>
        ${allocateResult ? `<p class="form-note">${escapeHtml(allocateResult)}</p>` : ""}
        <button class="btn primary" type="button" data-allocate-submit>Allocate</button>
      </div>
      <div class="panel">
        <h3>Leader / Integrity-check Contact</h3>
        <p class="cc-hint">Adds one real leader's number, mixed into the normal queue, to confirm agents are actually dialing.</p>
        <label><span class="cc-hint">Name</span><input type="text" data-leader-name value="${escapeHtml(leaderName)}" /></label>
        <label><span class="cc-hint">Phone</span><input type="tel" data-leader-phone value="${escapeHtml(leaderPhone)}" /></label>
        ${leaderResult ? `<p class="form-note">${escapeHtml(leaderResult)}</p>` : ""}
        <button class="btn primary" type="button" data-leader-submit>Add Leader Check</button>
        <button class="btn outline" type="button" data-refill-submit>Refill Leader-check Pool</button>
        ${refillResult ? `<p class="form-note">${escapeHtml(refillResult)}</p>` : ""}
      </div>
    </div>
  `;
}

function scriptTab() {
  return `
    <div class="cc-tab-panel">
      <div class="panel">
        <h3>Call Script</h3>
        <p class="cc-hint">Shown to every agent inside the calling page.</p>
        <div class="cc-import-box"><textarea data-script-content style="min-height:220px;">${escapeHtml(scriptContent)}</textarea></div>
      </div>
      <div class="panel">
        <h3>WhatsApp Location Message</h3>
        <p class="cc-hint">Sent when an agent taps WhatsApp for a contact who asked for the address.</p>
        <div class="cc-import-box"><textarea data-script-whatsapp>${escapeHtml(whatsappTemplate)}</textarea></div>
        ${scriptSaved ? `<p class="form-note success">${escapeHtml(scriptSaved)}</p>` : ""}
        <button class="btn primary" type="button" data-script-save>Save</button>
      </div>
    </div>
  `;
}

function auditsTab() {
  return `
    <div class="cc-tab-panel">
      <div class="panel">
        <p class="cc-hint">${weeklyAudits ?? "-"} verification calls happened team-wide in the last 7 days.</p>
        <button class="btn primary" type="button" data-pull-sample>Pull a Random Sample (5)</button>
      </div>
      ${auditSample && auditSample.length ? auditSample.map(auditCard).join("") : ""}
      ${auditSample && !auditSample.length ? `<div class="panel"><p class="cc-hint">Nothing left to check right now &mdash; everything completed has been audited in the last 14 days.</p></div>` : ""}
    </div>
  `;
}

function auditCard(item) {
  const state = auditForms[item.call_log_id] || {};
  return `
    <div class="panel">
      <h3>${escapeHtml(item.contact_name)} &mdash; ${escapeHtml(item.phone)}</h3>
      <p class="cc-hint">Agent: ${escapeHtml(item.agent_name)} &middot; Outcome: ${escapeHtml(item.outcome || "-")} &middot; ${item.completed_at ? new Date(item.completed_at).toLocaleString() : ""}</p>
      ${item.notes ? `<p class="cc-hint">Note: ${escapeHtml(item.notes)}</p>` : ""}
      <label><span class="cc-hint">Result</span>
        <select data-audit-result="${item.call_log_id}">
          <option value="">Choose...</option>
          ${["Confirmed", "Contact denies call", "Could not reach for verification", "Voicemail or inconclusive"].map(option => `<option value="${option}" ${state.result === option ? "selected" : ""}>${option}</option>`).join("")}
        </select>
      </label>
      <label><span class="cc-hint">Notes</span><input type="text" data-audit-notes="${item.call_log_id}" value="${escapeHtml(state.notes || "")}" /></label>
      ${state.error ? `<p class="form-note error">${escapeHtml(state.error)}</p>` : ""}
      ${state.saved ? `<p class="form-note success">Saved.</p>` : `<button class="btn primary" type="button" data-save-audit="${item.call_log_id}" data-contact-id="${item.contact_id}" data-agent-id="${item.agent_id}">Save Audit</button>`}
    </div>
  `;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const cells = line.split(",").map(c => c.trim());
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] || ""]));
  });
  return { headers, rows };
}

function bind() {
  document.querySelector("[data-sign-out]")?.addEventListener("click", async () => {
    await supabase.auth.signOut();
    session = null;
    phase = "signed-out";
    render();
  });

  document.querySelector("[data-back-to-signin]")?.addEventListener("click", () => {
    phase = "signed-out";
    authError = "";
    render();
  });

  document.querySelector("[data-signin-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const email = new FormData(event.target).get("email");
    authBusy = true;
    authError = "";
    render();
    try {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
      if (error) throw error;
      adminEmail = email;
      phase = "link-sent";
    } catch (error) {
      authError = error.message || "Could not send the sign-in link.";
    } finally {
      authBusy = false;
      render();
    }
  });

  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => {
    activeTab = button.dataset.tab;
    render();
    if (activeTab === "campaigns" && campaigns === null) loadCampaigns();
    if (activeTab === "agents" && agents === null) loadAgents();
    if (activeTab === "allocate") {
      if (campaigns === null) loadCampaigns();
      if (agents === null) loadAgents();
      if (unassignedCount === null) loadUnassignedCount();
    }
    if (activeTab === "script") loadScript();
  }));

  document.querySelector("[data-campaign-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const formData = new FormData(event.target);
    const { error } = await supabase.from("campaigns").insert({ name: formData.get("name"), description: formData.get("description") || null });
    if (!error) await loadCampaigns();
  });

  document.querySelectorAll("[data-toggle-campaign]").forEach(button => button.addEventListener("click", async () => {
    const active = button.dataset.active === "true";
    await supabase.from("campaigns").update({ active: !active }).eq("id", button.dataset.toggleCampaign);
    await loadCampaigns();
  }));

  document.querySelectorAll("[data-toggle-agent]").forEach(button => button.addEventListener("click", async () => {
    const active = button.dataset.active === "true";
    await supabase.from("agents").update({ active: !active }).eq("id", button.dataset.toggleAgent);
    await loadAgents();
  }));

  document.querySelector("[data-quickadd-text]")?.addEventListener("input", event => { quickAddText = event.target.value; });
  document.querySelector("[data-quickadd-submit]")?.addEventListener("click", async () => {
    const lines = quickAddText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const rows = lines.map(line => {
      const [first, ...rest] = line.split(",");
      const hasName = rest.length > 0;
      const phone = normalizePhone(hasName ? rest.join(",") : first);
      const name = hasName ? first.trim() : phone;
      return { display_name: name, phone, email: derivedEmail(phone), active: true };
    }).filter(row => row.phone.length >= 10);
    if (!rows.length) {
      quickAddResult = "No valid phone numbers found.";
      render();
      return;
    }
    const { error, count } = await supabase.from("agents").upsert(rows, { onConflict: "phone", ignoreDuplicates: true, count: "exact" });
    quickAddResult = error ? error.message : `Added ${count ?? rows.length} agent(s). Existing phone numbers were left untouched.`;
    quickAddText = "";
    await loadAgents();
  });

  document.querySelector("[data-import-text]")?.addEventListener("input", event => { importText = event.target.value; });
  document.querySelector("[data-import-campaign]")?.addEventListener("change", event => { importCampaignId = event.target.value; });
  document.querySelector("[data-import-submit]")?.addEventListener("click", async () => {
    const { rows } = parseCsv(importText);
    if (!rows.length) {
      importResult = "Paste at least a header row and one data row.";
      render();
      return;
    }
    const payload = rows
      .filter(row => row.full_name && row.phone)
      .map(row => ({
        campaign_id: importCampaignId || null,
        full_name: row.full_name,
        phone: normalizePhone(row.phone),
        email_or_area: row.email_or_area || null,
        group_name: row.group_name || null,
        segment: row.segment || null,
        source: row.source || null,
        priority: row.priority || null,
        previous_response: row.previous_response || null
      }));
    if (!payload.length) {
      importResult = "No valid rows (need at least full_name and phone).";
      render();
      return;
    }
    const { error, count } = await supabase.from("contacts").upsert(payload, { onConflict: "campaign_id,phone", count: "exact" });
    importResult = error ? error.message : `Imported ${count ?? payload.length} contact(s).`;
    importText = "";
    await loadUnassignedCount();
    render();
  });

  document.querySelector("[data-allocate-agent]")?.addEventListener("change", event => { allocateAgentId = event.target.value; });
  document.querySelector("[data-allocate-count]")?.addEventListener("input", event => { allocateCount = Number(event.target.value) || 1; });
  document.querySelector("[data-allocate-submit]")?.addEventListener("click", async () => {
    if (!allocateAgentId) {
      allocateResult = "Choose an agent first.";
      render();
      return;
    }
    const { data: candidates, error: fetchError } = await supabase
      .from("contacts")
      .select("id")
      .is("assigned_agent_id", null)
      .eq("is_leader_check", false)
      .eq("do_not_contact", false)
      .limit(allocateCount);
    if (fetchError) {
      allocateResult = fetchError.message;
      render();
      return;
    }
    if (!candidates.length) {
      allocateResult = "No unassigned contacts left.";
      render();
      return;
    }
    const { error } = await supabase.from("contacts").update({ assigned_agent_id: allocateAgentId }).in("id", candidates.map(c => c.id));
    allocateResult = error ? error.message : `Allocated ${candidates.length} contact(s).`;
    await loadUnassignedCount();
  });

  document.querySelector("[data-leader-name]")?.addEventListener("input", event => { leaderName = event.target.value; });
  document.querySelector("[data-leader-phone]")?.addEventListener("input", event => { leaderPhone = event.target.value; });
  document.querySelector("[data-leader-submit]")?.addEventListener("click", async () => {
    const phone = normalizePhone(leaderPhone);
    if (!leaderName.trim() || phone.length < 10) {
      leaderResult = "Enter a name and a valid phone number.";
      render();
      return;
    }
    const { error } = await supabase.from("contacts").insert({ full_name: leaderName.trim(), phone, is_leader_check: true, status: "Not started" });
    leaderResult = error ? error.message : "Added.";
    leaderName = "";
    leaderPhone = "";
    render();
  });

  document.querySelector("[data-refill-submit]")?.addEventListener("click", async () => {
    const { data, error } = await supabase.rpc("refill_leader_checks");
    refillResult = error ? error.message : `Inserted ${data} refill contact(s).`;
    render();
  });

  document.querySelector("[data-script-content]")?.addEventListener("input", event => { scriptContent = event.target.value; });
  document.querySelector("[data-script-whatsapp]")?.addEventListener("input", event => { whatsappTemplate = event.target.value; });
  document.querySelector("[data-script-save]")?.addEventListener("click", async () => {
    const { error } = await supabase.from("call_script").update({ content: scriptContent, whatsapp_template: whatsappTemplate }).eq("id", true);
    scriptSaved = error ? error.message : "Saved.";
    render();
  });

  document.querySelector("[data-pull-sample]")?.addEventListener("click", async () => {
    const { data, error } = await supabase.rpc("get_audit_sample", { sample_size: 5 });
    auditSample = error ? [] : data;
    auditForms = {};
    render();
  });

  document.querySelectorAll("[data-audit-result]").forEach(select => select.addEventListener("change", event => {
    const id = select.dataset.auditResult;
    auditForms[id] = { ...(auditForms[id] || {}), result: event.target.value };
  }));

  document.querySelectorAll("[data-audit-notes]").forEach(input => input.addEventListener("input", event => {
    const id = input.dataset.auditNotes;
    auditForms[id] = { ...(auditForms[id] || {}), notes: event.target.value };
  }));

  document.querySelectorAll("[data-save-audit]").forEach(button => button.addEventListener("click", async () => {
    const callLogId = button.dataset.saveAudit;
    const state = auditForms[callLogId] || {};
    if (!state.result) {
      auditForms[callLogId] = { ...state, error: "Choose a result." };
      render();
      return;
    }
    const { error } = await supabase.from("call_audits").insert({
      call_log_id: callLogId,
      contact_id: button.dataset.contactId,
      agent_id: button.dataset.agentId,
      result: state.result,
      notes: state.notes || null
    });
    auditForms[callLogId] = error ? { ...state, error: error.message } : { ...state, saved: true };
    render();
  }));
}

init();
