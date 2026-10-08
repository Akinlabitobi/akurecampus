import { welcomeAfterSubmit } from "./components/dialogs.js";
import { closeChoiceModal, syncReveals } from "./components/forms.js";
import { initHeroScene } from "./components/heroScene.js";
import { installApp } from "./components/installPrompt.js";
import { choosePhoto } from "./components/photoPicker.js";
import { shell } from "./components/shell.js";
import { deleteMember, deleteSubmission, loadAdminSession, loadAdmins, loadBroadcastAudience, loadCellData, loadDashboard, updateSubmission } from "./lib/api.js";
import { QUEUED_NOTE } from "./lib/constants.js";
import { recordCode } from "./lib/format.js";
import { loadMemberProfile, requestMemberCode, saveMemberProfile, setMemberNote, signOutMember, verifyMemberCode } from "./lib/member.js";
import { postOrQueue } from "./lib/offline-queue.js";
import { ROLE_DEFAULTS, can } from "./lib/permissions.js";
import { syncLocation } from "./lib/router.js";
import { state } from "./lib/state.js";
import { loadDailyAttendanceCode, saveAttendance } from "./pages/attendance.js";
import { saveBirthday } from "./pages/birthdays.js";
import { downloadCellReportsCsv, submitCellReport, visitorRow } from "./pages/dashboard/cells.js";
import { adminArea } from "./pages/dashboard/index.js";
import { showSubmissionEditor } from "./pages/dashboard/submissionEditor.js";
import { home } from "./pages/home.js";
import { simplePage } from "./pages/simplePage.js";

const app = document.querySelector("#app");

export function navigate(view, options = {}) {
  if (view !== state.activeView) {
    state.selectedChoice = { community: "", workforce: "" };
    state.photoDrafts = { birthday: "", member: "" };
    state.memberEditing = false;
    setMemberNote("");
  }
  state.activeView = view;
  state.menuOpen = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
  syncLocation(view, options.fromHistory);
  render();
}

export function render() {
  if (state.heroSceneCleanup) {
    state.heroSceneCleanup();
    state.heroSceneCleanup = null;
  }
  const content = state.activeView === "home" ? home() : state.activeView === "dashboard" ? adminArea() : simplePage(state.activeView);
  app.innerHTML = shell(content);
  document.querySelectorAll("[data-nav]").forEach(el => el.addEventListener("click", event => {
    event.preventDefault();
    navigate(el.dataset.nav);
  }));
  document.querySelectorAll("[data-dash]").forEach(el => el.addEventListener("click", () => {
    state.activeDashboard = el.dataset.dash;
    render();
  }));
  document.querySelectorAll("[data-focus-form]").forEach(el => el.addEventListener("click", () => {
    document.querySelector("#form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  document.querySelectorAll("[data-choose]").forEach(el => el.addEventListener("click", () => {
    state.selectedChoice[el.dataset.choose] = el.dataset.choice;
    render();
    document.querySelector(".form-modal input:not([readonly])")?.focus();
  }));
  document.querySelectorAll("[data-close-choice]").forEach(el => el.addEventListener("click", event => {
    // The backdrop carries data-close-choice too; ignore clicks that land
    // inside the panel and merely bubble up to it.
    if (event.target !== el) return;
    closeChoiceModal();
  }));
  document.body.classList.toggle("modal-open", Boolean(document.querySelector(".form-modal")));
  document.querySelector("[data-export]")?.addEventListener("click", () => {
    const type = { communities: "community", workforce: "workforce", birthdays: "birthday" }[state.activeDashboard] || "";
    window.location.href = type ? `/api/export?type=${type}` : "/api/export";
  });
  const menu = document.querySelector("[data-menu]");
  if (menu) menu.addEventListener("click", () => {
    state.menuOpen = !state.menuOpen;
    render();
  });
  document.querySelectorAll("[data-reveal]").forEach(select => select.addEventListener("change", () => syncReveals(select.form)));
  document.querySelectorAll("[data-api-form]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const note = form.querySelector(".form-note") || document.createElement("p");
    const button = form.querySelector("button[type='submit']") || form.querySelector("button");
    const fields = Object.fromEntries(new FormData(form).entries());
    if (!fields.name && fields.fullName) fields.name = fields.fullName;
    const submissionId = form.dataset.submissionId || crypto.randomUUID();
    form.dataset.submissionId = submissionId;
    note.className = "form-note";
    note.textContent = "Saving...";
    form.appendChild(note);
    if (button) button.disabled = true;
    try {
      const result = await postOrQueue("/api/submissions", { type: form.dataset.formType, fields, submissionId }, form.querySelector("h3")?.textContent || "Form");
      state.dashboardData = null;
      form.reset();
      syncReveals(form);
      delete form.dataset.submissionId;
      note.className = "form-note success";
      note.textContent = result.queued
        ? QUEUED_NOTE
        : result.googleSheet?.synced
        ? `Saved and sent to the team. Short code: ${result.record.shortCode || recordCode(result.record)}.`
        : `Saved. Short code: ${result.record.shortCode || recordCode(result.record)}.`;
      if (!result.queued) welcomeAfterSubmit(form, form.dataset.formType, fields, result.record);
    } catch (error) {
      note.className = "form-note error";
      note.textContent = error.message;
    } finally {
      if (button) button.disabled = false;
    }
  }));
  document.querySelectorAll("[data-attendance-form]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    saveAttendance(form);
  }));
  document.querySelectorAll("[data-photo-input]").forEach(input => input.addEventListener("change", () => choosePhoto(input)));
  document.querySelector("[data-member-email-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    state.memberEmail = event.target.email.value.trim();
    requestMemberCode();
  });
  document.querySelector("[data-member-code-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    verifyMemberCode(event.target.code.value);
  });
  document.querySelector("[data-member-resend]")?.addEventListener("click", () => requestMemberCode());
  document.querySelector("[data-member-change-email]")?.addEventListener("click", () => {
    state.memberStep = "email";
    setMemberNote("");
    render();
  });
  document.querySelector("[data-member-edit]")?.addEventListener("click", () => {
    state.memberEditing = true;
    setMemberNote("");
    render();
  });
  document.querySelector("[data-member-cancel-edit]")?.addEventListener("click", () => {
    state.memberEditing = false;
    state.photoDrafts.member = "";
    setMemberNote("");
    render();
  });
  document.querySelector("[data-member-profile-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    saveMemberProfile(event.target);
  });
  document.querySelector("[data-member-logout]")?.addEventListener("click", signOutMember);
  document.querySelectorAll("[data-install]").forEach(button => button.addEventListener("click", installApp));
  // Cell reports. Ticking, searching and adding visitors change the page in
  // place (no re-render) so nothing the leader has typed is lost.
  document.querySelector("[data-cell-select]")?.addEventListener("change", event => {
    state.cellChoice = event.target.value;
    state.cellDraft = null;
    render();
  });
  document.querySelector("[data-cell-date]")?.addEventListener("change", event => {
    if (!event.target.value) return;
    state.cellDate = event.target.value;
    state.cellDraft = null;
    render();
  });
  const cellForm = document.querySelector("[data-cell-report-form]");
  if (cellForm) {
    const updateCount = () => {
      const boxes = cellForm.querySelectorAll("input[name=present]");
      const ticked = [...boxes].filter(box => box.checked);
      state.cellDraft.present = new Set(ticked.map(box => box.value));
      const count = cellForm.querySelector("[data-present-count]");
      if (count) count.textContent = `${ticked.length} of ${boxes.length} present`;
    };
    cellForm.addEventListener("change", event => {
      if (event.target.name === "present") updateCount();
      if (event.target.matches("[data-cell-held]")) {
        state.cellDraft.held = event.target.value;
        cellForm.querySelector("[data-held-section]").hidden = event.target.value !== "yes";
        cellForm.querySelector("[data-notes-label]").textContent = event.target.value === "yes" ? "Notes, testimonies or prayer requests" : "Why didn't the meeting hold?";
      }
    });
    cellForm.querySelector("[data-roster-search]")?.addEventListener("input", event => {
      const query = event.target.value.trim().toLowerCase();
      cellForm.querySelectorAll("[data-roster-row]").forEach(row => {
        row.hidden = Boolean(query) && !row.dataset.rosterRow.includes(query);
      });
    });
    cellForm.querySelector("[data-mark-all]")?.addEventListener("click", () => {
      cellForm.querySelectorAll("[data-roster-row]:not([hidden]) input[name=present]").forEach(box => { box.checked = true; });
      updateCount();
    });
    cellForm.querySelector("[data-add-visitor]").addEventListener("click", () => {
      const list = cellForm.querySelector("[data-visitor-list]");
      list.insertAdjacentHTML("beforeend", visitorRow());
      list.lastElementChild.querySelector("input").focus();
    });
    cellForm.addEventListener("click", event => {
      if (event.target.closest("[data-remove-visitor]")) event.target.closest("[data-visitor-row]").remove();
    });
    cellForm.addEventListener("submit", event => {
      event.preventDefault();
      submitCellReport(cellForm);
    });
  }
  document.querySelector("[data-report-filter]")?.addEventListener("change", event => {
    state.cellReportFilter = event.target.value;
    render();
  });
  document.querySelector("[data-cell-csv]")?.addEventListener("click", downloadCellReportsCsv);
  document.querySelectorAll("[data-view-report]").forEach(button => button.addEventListener("click", () => {
    state.cellReportView = button.dataset.viewReport;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  document.querySelector("[data-report-back]")?.addEventListener("click", () => {
    state.cellReportView = "";
    render();
  });
  document.querySelector("[data-edit-report]")?.addEventListener("click", event => {
    const report = state.cellData.reports.find(item => item.id === event.currentTarget.dataset.editReport);
    state.cellChoice = report.cell;
    state.cellDate = report.meetingDate;
    state.cellDraft = null;
    state.cellReportView = "";
    state.activeDashboard = "cell-attendance";
    render();
  });
  document.querySelector("[data-delete-report]")?.addEventListener("click", async event => {
    if (!confirm("Delete this cell report? This cannot be undone.")) return;
    try {
      const response = await fetch(`/api/admin/submissions/${event.currentTarget.dataset.deleteReport}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not delete this report.");
      state.cellReportView = "";
      state.dashboardData = result.dashboard || null;
      await loadCellData(true);
    } catch (error) {
      alert(error.message);
    }
  });
  document.querySelector("[data-member-search]")?.addEventListener("input", event => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll("[data-member-row]").forEach(row => {
      row.hidden = Boolean(query) && !row.dataset.memberRow.includes(query);
    });
  });
  document.querySelectorAll("[data-view-member]").forEach(button => button.addEventListener("click", () => {
    state.selectedMemberKey = button.dataset.viewMember;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }));
  document.querySelector("[data-member-back]")?.addEventListener("click", () => {
    state.selectedMemberKey = "";
    render();
  });
  document.querySelectorAll("[data-delete-member]").forEach(button => button.addEventListener("click", () => {
    deleteMember(button.dataset.deleteMember);
  }));
  document.querySelector("[data-birthday-form]")?.addEventListener("submit", event => {
    event.preventDefault();
    saveBirthday(event.target);
  });
  document.querySelector("[data-login-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.target).entries());
    state.loginSubmitting = true;
    state.loginError = "";
    render();
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not sign in.");
      state.adminSession = result.admin;
      state.activeDashboard = "overview";
      state.dashboardData = null;
      state.cellData = undefined;
    } catch (error) {
      state.loginError = error.message;
    } finally {
      state.loginSubmitting = false;
      render();
    }
  });
  document.querySelector("[data-logout]")?.addEventListener("click", async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {
      // ignore network errors on logout; the local session is cleared regardless
    }
    state.adminSession = null;
    state.dashboardData = null;
    state.adminsList = null;
    state.broadcastAudience = null;
    state.cellData = undefined;
    state.cellChoice = "";
    state.cellDraft = null;
    state.cellReportView = "";
    state.cellReportFilter = "";
    state.activeDashboard = "overview";
    render();
  });
  document.querySelector("[data-change-password-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const fields = Object.fromEntries(new FormData(form).entries());
    const note = form.querySelector(".form-note") || document.createElement("p");
    form.appendChild(note);
    try {
      const response = await fetch("/api/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update your password.");
      state.adminSession = result.admin;
      render();
    } catch (error) {
      note.className = "form-note error";
      note.textContent = error.message;
    }
  });
  document.querySelectorAll("[data-save-status]").forEach(button => button.addEventListener("click", () => {
    const id = button.dataset.saveStatus;
    const input = document.querySelector(`[data-status-input][data-id="${id}"]`);
    updateSubmission(id, { status: input.value });
  }));
  document.querySelectorAll("[data-edit-submission]").forEach(button => button.addEventListener("click", () => {
    const record = state.dashboardData?.submissions?.find(item => item.id === button.dataset.editSubmission);
    if (record) showSubmissionEditor(record);
  }));
  document.querySelectorAll("[data-delete-submission]").forEach(button => button.addEventListener("click", () => {
    deleteSubmission(button.dataset.deleteSubmission);
  }));
  document.querySelectorAll("[data-edit-launch-item]").forEach(button => button.addEventListener("click", () => {
    state.editingLaunchItemId = button.dataset.editLaunchItem;
    render();
  }));
  document.querySelector("[data-cancel-edit-launch-item]")?.addEventListener("click", () => {
    state.editingLaunchItemId = null;
    render();
  });
  document.querySelectorAll("[data-delete-launch-item]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Remove this launch item?")) return;
    try {
      const response = await fetch(`/api/admin/launch-items/${button.dataset.deleteLaunchItem}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not remove this item.");
      state.dashboardData = result.dashboard;
      render();
    } catch (error) {
      alert(error.message);
    }
  }));
  document.querySelector("[data-launch-item-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const fields = Object.fromEntries(new FormData(form).entries());
    const editingId = form.dataset.editingId;
    try {
      const response = await fetch(editingId ? `/api/admin/launch-items/${editingId}` : "/api/admin/launch-items", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this item.");
      state.dashboardData = result.dashboard;
      state.editingLaunchItemId = null;
      render();
    } catch (error) {
      alert(error.message);
    }
  });
  document.querySelectorAll("[data-broadcast-form]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    const kind = form.dataset.broadcastForm;
    const fields = Object.fromEntries(new FormData(form).entries());
    state.broadcastBusy = kind;
    state.broadcastNote = "";
    render();
    try {
      const response = await fetch(kind === "sms" ? "/api/admin/bulk-sms" : "/api/admin/bulk-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not send this broadcast.");
      state.broadcastNote = `Sent to ${result.recipients} recipients.`;
      state.broadcastNoteType = "success";
    } catch (error) {
      state.broadcastNote = error.message;
      state.broadcastNoteType = "error";
    } finally {
      state.broadcastBusy = false;
      render();
    }
  }));
  document.querySelector("[data-role-select]")?.addEventListener("change", event => {
    const leader = event.target.value === "cell_leader";
    document.querySelector("[data-cell-picker]").hidden = !leader;
    document.querySelector("[data-permission-picker]").hidden = leader;
    const defaults = ROLE_DEFAULTS[event.target.value] || [];
    document.querySelectorAll("[data-admin-form] input[name='permissions']").forEach(checkbox => {
      checkbox.checked = defaults.includes(checkbox.value);
    });
  });
  document.querySelectorAll("[data-edit-admin]").forEach(button => button.addEventListener("click", () => {
    state.editingAdminId = button.dataset.editAdmin;
    state.adminFormError = "";
    render();
  }));
  document.querySelector("[data-cancel-edit-admin]")?.addEventListener("click", () => {
    state.editingAdminId = null;
    state.adminFormError = "";
    render();
  });
  document.querySelectorAll("[data-delete-admin]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Remove this admin account?")) return;
    try {
      const response = await fetch(`/api/admin/admins/${button.dataset.deleteAdmin}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not remove this admin.");
      await loadAdmins(true);
    } catch (error) {
      alert(error.message);
    }
  }));
  document.querySelector("[data-admin-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const editingId = form.dataset.editingId;
    const payload = {
      name: formData.get("name"),
      role: formData.get("role"),
      permissions: formData.get("role") === "cell_leader"
        ? formData.getAll("cells").map(cell => `cell:${cell}`)
        : formData.getAll("permissions")
    };
    if (!editingId) {
      payload.email = formData.get("email");
      payload.password = formData.get("password");
    } else {
      const password = formData.get("password");
      if (password) payload.newPassword = password;
      payload.active = formData.get("active") === "on";
    }
    state.adminFormError = "";
    try {
      const response = await fetch(editingId ? `/api/admin/admins/${editingId}` : "/api/admin/admins", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save this admin.");
      state.editingAdminId = null;
      await loadAdmins(true);
    } catch (error) {
      state.adminFormError = error.message;
      render();
    }
  });
  if (state.activeView === "home") initHeroScene();
  if (state.activeView === "attendance") loadDailyAttendanceCode();
  if (state.activeView === "profile" && state.memberProfile === undefined) loadMemberProfile();
  if (state.activeView === "dashboard") {
    if (state.adminSession === undefined) loadAdminSession();
    else if (state.adminSession) {
      if (can("view_dashboard")) loadDashboard();
      if (state.activeDashboard.startsWith("cell-")) loadCellData();
      if (state.activeDashboard === "admins") loadAdmins();
      if (state.activeDashboard === "broadcast") loadBroadcastAudience();
    }
  }
}

export function closeMenuIfOpen() {
  if (!state.menuOpen) return;
  state.menuOpen = false;
  document.querySelector(".navlinks")?.classList.remove("open");
}
