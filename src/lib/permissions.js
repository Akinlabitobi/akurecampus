import { state } from "./state.js";

export const ALL_PERMISSIONS = ["view_dashboard", "edit_submissions", "delete_submissions", "manage_content", "send_broadcasts", "manage_admins", "export_data"];
export const ROLE_DEFAULTS = {
  superadmin: ALL_PERMISSIONS.slice(),
  manager: ["view_dashboard", "edit_submissions", "manage_content", "export_data", "send_broadcasts"],
  viewer: ["view_dashboard"],
  cell_leader: ["cell_reports"]
};
export const ROLE_LABELS = { viewer: "Viewer", manager: "Manager", superadmin: "Superadmin", cell_leader: "Cell leader" };
const PERMISSION_LABELS = {
  cell_reports: "Cell reports",
  view_dashboard: "View dashboard",
  edit_submissions: "Edit submissions",
  delete_submissions: "Delete submissions",
  manage_content: "Manage launch items",
  send_broadcasts: "Send SMS/email broadcasts",
  manage_admins: "Manage admin accounts",
  export_data: "Export data (CSV)"
};

export function can(permission) {
  if (!state.adminSession) return false;
  if (state.adminSession.role === "superadmin") return true;
  return Array.isArray(state.adminSession.permissions) && state.adminSession.permissions.includes(permission);
}

export function permissionLabel(permission) {
  if (permission.startsWith("cell:")) return `Cell: ${permission.slice(5)}`;
  return PERMISSION_LABELS[permission] || permission;
}
