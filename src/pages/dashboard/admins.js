import { COMMUNITIES as communities } from "../../lib/communities.js";
import { escapeHtml } from "../../lib/format.js";
import { ALL_PERMISSIONS, ROLE_DEFAULTS, ROLE_LABELS, permissionLabel } from "../../lib/permissions.js";
import { state } from "../../lib/state.js";

export function adminsTab() {
  if (!state.adminsList) return `<div class="panel"><h3>Loading admins...</h3></div>`;
  const editing = state.editingAdminId ? state.adminsList.find(admin => admin.id === state.editingAdminId) : null;
  const rows = state.adminsList.map(admin => `
    <tr>
      <td>${admin.name}</td>
      <td>${admin.email}</td>
      <td><span class="badge role-${admin.role}">${ROLE_LABELS[admin.role] || admin.role}</span></td>
      <td>${admin.permissions?.length ? admin.permissions.map(permissionLabel).join(", ") : "-"}</td>
      <td>${admin.active ? "Active" : "Suspended"}</td>
      <td>${admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : "Never"}</td>
      <td class="actions-cell">
        <button class="btn outline small" type="button" data-edit-admin="${admin.id}">Edit</button>
        ${admin.id !== state.adminSession.id ? `<button class="btn danger small" type="button" data-delete-admin="${admin.id}">Remove</button>` : ""}
      </td>
    </tr>
  `).join("");
  return `
    <div class="table">
      <table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Permissions</th><th>Status</th><th>Last Sign-in</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="7">No admins yet.</td></tr>`}</tbody></table>
    </div>
    ${adminForm(editing)}
  `;
}

function adminForm(editing) {
  const permissions = editing ? editing.permissions || [] : ROLE_DEFAULTS.viewer;
  return `
    <div class="panel">
      <h3>${editing ? `Edit ${editing.name}` : "Add Admin"}</h3>
      ${state.adminFormError ? `<p class="form-note error">${state.adminFormError}</p>` : ""}
      <form class="form inline-form" data-admin-form data-editing-id="${editing?.id || ""}">
        <label><span>Full name</span><input name="name" value="${editing?.name || ""}" required /></label>
        <label><span>Email</span><input name="email" type="email" value="${editing?.email || ""}" ${editing ? "readonly" : ""} required /></label>
        <label><span>${editing ? "New password (leave blank to keep current)" : "Temporary password"}</span><input name="password" type="password" minlength="8" ${editing ? "" : "required"} /></label>
        <label><span>Role</span>
          <select name="role" data-role-select>
            ${["viewer", "manager", "superadmin", "cell_leader"].map(role => `<option value="${role}" ${(editing?.role || "viewer") === role ? "selected" : ""}>${ROLE_LABELS[role]}</option>`).join("")}
          </select>
        </label>
        <fieldset class="permission-grid" data-cell-picker ${editing?.role === "cell_leader" ? "" : "hidden"}>
          <legend>Cells this leader manages</legend>
          ${communities.map(([name]) => `
            <label class="permission-check"><input type="checkbox" name="cells" value="${escapeHtml(name)}" ${permissions.includes(`cell:${name}`) ? "checked" : ""} /> <span>${escapeHtml(name)}</span></label>
          `).join("")}
        </fieldset>
        <fieldset class="permission-grid" data-permission-picker ${editing?.role === "cell_leader" ? "hidden" : ""}>
          <legend>Permissions</legend>
          ${ALL_PERMISSIONS.map(permission => `
            <label class="permission-check"><input type="checkbox" name="permissions" value="${permission}" ${permissions.includes(permission) ? "checked" : ""} /> <span>${permissionLabel(permission)}</span></label>
          `).join("")}
        </fieldset>
        ${editing ? `<label class="permission-check"><input type="checkbox" name="active" ${editing.active ? "checked" : ""} /> <span>Account active</span></label>` : ""}
        <div class="inline-actions">
          <button class="btn primary" type="submit">${editing ? "Save Changes" : "Create Admin"}</button>
          ${editing ? `<button class="btn ghost-dark" type="button" data-cancel-edit-admin>Cancel</button>` : ""}
        </div>
      </form>
    </div>
  `;
}
