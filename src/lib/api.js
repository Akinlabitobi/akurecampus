import { toast } from "../components/dialogs.js";
import { memberDirectory } from "../pages/dashboard/members.js";
import { render } from "../render.js";
import { recordCode } from "./format.js";
import { flushOutbox } from "./offline-queue.js";
import { state } from "./state.js";

export async function loadDashboard(force = false) {
  if (state.dashboardLoading || (state.dashboardData && !force)) return;
  state.dashboardLoading = true;
  try {
    const response = await fetch("/api/dashboard");
    if (response.status === 401) {
      state.adminSession = null;
      state.dashboardData = null;
      return;
    }
    if (!response.ok) throw new Error("Dashboard API is unavailable");
    state.dashboardData = await response.json();
  } catch (error) {
    state.dashboardData = { error: error.message, metrics: {}, submissions: [], recent: [], launchItems: [] };
  } finally {
    state.dashboardLoading = false;
    if (state.activeView === "dashboard") render();
  }
}

export async function loadAdminSession() {
  if (state.adminChecking) return;
  state.adminChecking = true;
  try {
    const response = await fetch("/api/admin/me");
    const result = await response.json();
    state.adminSession = result.admin || null;
  } catch {
    state.adminSession = null;
  } finally {
    state.adminChecking = false;
    if (state.activeView === "dashboard") render();
  }
}

export async function loadAdmins(force = false) {
  if (state.adminsLoading || (state.adminsList && !force)) return;
  state.adminsLoading = true;
  try {
    const response = await fetch("/api/admin/admins");
    if (!response.ok) throw new Error("Could not load admins.");
    const result = await response.json();
    state.adminsList = result.admins;
  } catch {
    state.adminsList = [];
  } finally {
    state.adminsLoading = false;
    if (state.activeView === "dashboard") render();
  }
}

export async function loadCellData(force = false) {
  if (state.cellLoading || (state.cellData && !force)) return;
  state.cellLoading = true;
  try {
    const response = await fetch("/api/cell/overview");
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      state.adminSession = null;
      return;
    }
    if (!response.ok) throw new Error(result.error || "Could not load cell data.");
    state.cellData = result;
  } catch (error) {
    state.cellData = { error: error.message };
  } finally {
    state.cellLoading = false;
    if (state.activeView === "dashboard") render();
  }
}

export async function loadBroadcastAudience(force = false) {
  if (state.broadcastAudience && !force) return;
  try {
    const response = await fetch("/api/admin/sms-audience");
    if (!response.ok) throw new Error("Could not load audience.");
    state.broadcastAudience = await response.json();
  } catch {
    state.broadcastAudience = { sms: { recipients: "-", maximumPerSend: 100 }, email: { recipients: "-", maximumPerSend: 100 } };
  } finally {
    if (state.activeView === "dashboard") render();
  }
}

export async function updateSubmission(id, patch) {
  try {
    const response = await fetch(`/api/admin/submissions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not update this record.");
    state.dashboardData = result.dashboard;
    render();
  } catch (error) {
    alert(error.message);
  }
}

export async function deleteSubmission(id) {
  if (!confirm("Delete this record? This cannot be undone.")) return;
  // A member's key is their oldest record's id; if that record is the one
  // going, keep their detail page open by moving the key to the next one.
  const memberIds = state.selectedMemberKey === id
    ? memberDirectory(state.dashboardData?.submissions || []).find(person => person.key === id)?.records.map(row => row.id) || []
    : [];
  try {
    const response = await fetch(`/api/admin/submissions/${id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not delete this record.");
    state.dashboardData = result.dashboard;
    if (memberIds.length) state.selectedMemberKey = memberIds.find(other => other !== id) || "";
    render();
  } catch (error) {
    alert(error.message);
  }
}

// Removes every record grouped under one person in the Members tab.
export async function deleteMember(key) {
  const person = memberDirectory(state.dashboardData?.submissions || []).find(item => item.key === key);
  if (!person) return;
  const count = person.records.length;
  if (!confirm(`Delete ${person.name || "this member"} and all ${count} of their record${count === 1 ? "" : "s"}? This cannot be undone.`)) return;
  const failed = [];
  for (const row of person.records) {
    try {
      const response = await fetch(`/api/admin/submissions/${row.id}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not delete this record.");
      state.dashboardData = result.dashboard;
    } catch (error) {
      failed.push(`${recordCode(row)}: ${error.message}`);
    }
  }
  if (!failed.length) state.selectedMemberKey = "";
  render();
  if (failed.length) alert(`Some records could not be deleted:\n${failed.join("\n")}`);
  else toast("Member deleted.", "success");
}

export async function sendSavedForms() {
  const { sent, failed } = await flushOutbox().catch(() => ({ sent: [], failed: [] }));
  if (sent.length) {
    toast(sent.length === 1 ? `Back online: your ${sent[0].label.toLowerCase()} has been sent.` : `Back online: ${sent.length} saved forms have been sent.`, "success");
  }
  failed.forEach(item => toast(`Your saved ${item.label.toLowerCase()} couldn't be sent: ${item.error}`, "error"));
}
