import { openDialog, toast } from "../../components/dialogs.js";
import { JOIN_SMALL_GROUP, JOIN_WORKFORCE, smallGroupOptions } from "../../components/forms.js";
import { COMMUNITIES as communities } from "../../lib/communities.js";
import { departments } from "../../lib/constants.js";
import { escapeHtml, fieldName, recordCode } from "../../lib/format.js";
import { state } from "../../lib/state.js";
import { render } from "../../render.js";
import { MEETING_DAYS, leadableCells } from "../leadCell.js";
import { SUBMISSION_LABELS } from "./members.js";

// Admin editor for any submitted form. Shows every text field on the record
// (photos, sign-in data and cell-report lists are edited elsewhere).
const NON_EDITABLE_FIELDS = ["name", "photoPath", "photoType", "photoConsent", "communicationsConsent", "signInCode", "lastSignInAt", "present", "absent", "visitors"];

function fieldLabel(key) {
  const text = key.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function editorInput(key, value) {
  const name = `field:${key}`;
  const safe = escapeHtml(value);
  const select = (options, current) => {
    const list = options.includes(current) || !current ? options : [current, ...options];
    return `<select name="${name}"><option value="">-</option>${list.map(option => `<option value="${escapeHtml(option)}" ${option === current ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
  };
  if (key === "preferredCommunity") return select(communities.map(([group]) => group), value);
  if (key === "smallGroup") return `<select name="${name}"><option value="">-</option>${smallGroupOptions(value)}</select>`;
  if (key === "department" || key === "workforceTeam") return select(departments, value);
  if (["wouldYouLikeToLead", fieldName(JOIN_WORKFORCE), fieldName(JOIN_SMALL_GROUP)].includes(key)) return select(["Yes", "No"], value);
  if (key === "preferredCell") return select(leadableCells(), value);
  if (key === "preferredMeetingDay") return select(MEETING_DAYS, value);
  if (/date$|^dateOf/i.test(key) && /^\d{4}-\d{2}-\d{2}$/.test(value)) return `<input type="date" name="${name}" value="${safe}" />`;
  if (/message|notes?|experience|description|^why/i.test(key) || String(value).length > 70) return `<textarea name="${name}" rows="3">${safe}</textarea>`;
  return `<input name="${name}" value="${safe}" />`;
}

export function showSubmissionEditor(record) {
  // Older signups, and ones that answered No, have no follow-up pick yet;
  // offer it anyway so the team can add one.
  const followUp = { community: "workforceTeam", workforce: "smallGroup" }[record.type];
  const fields = followUp && !(followUp in record.fields) ? { ...record.fields, [followUp]: "" } : record.fields;
  const entries = Object.entries(fields).filter(([key, value]) => !NON_EDITABLE_FIELDS.includes(key) && (typeof value === "string" || typeof value === "number"));
  const { modal, close } = openDialog(`
    <form class="form submission-editor" data-submission-editor>
      <h3>Edit ${escapeHtml(SUBMISSION_LABELS[record.type] || record.type)} &middot; ${escapeHtml(recordCode(record))}</h3>
      ${entries.map(([key, value]) => `<label><span>${escapeHtml(fieldLabel(key))}</span>${editorInput(key, String(value))}</label>`).join("")}
      <label><span>Status</span><input name="status" value="${escapeHtml(record.status || "")}" /></label>
      <div class="inline-actions">
        <button class="btn primary" type="submit">Save Changes</button>
        <button class="btn ghost-dark" type="button" data-close>Cancel</button>
      </div>
      <p class="form-note"></p>
    </form>
  `, "editor-panel");
  const form = modal.querySelector("form");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(form);
    const fields = {};
    for (const [key, value] of data.entries()) {
      if (key.startsWith("field:")) fields[key.slice(6)] = String(value).trim();
    }
    // Some records keep a copy of the name in "name"; keep it in step.
    if ("fullName" in fields && "name" in record.fields) fields.name = fields.fullName;
    const note = form.querySelector(".form-note");
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    note.className = "form-note";
    note.textContent = "Saving...";
    try {
      const response = await fetch(`/api/admin/submissions/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: String(data.get("status") || ""), fields })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not save these changes.");
      state.dashboardData = result.dashboard;
      close();
      toast("Changes saved.", "success");
      render();
    } catch (error) {
      note.className = "form-note error";
      note.textContent = error.message;
      button.disabled = false;
    }
  });
}
