import { viewFromLocation } from "./router.js";

// Shared app state. These were module-level `let`s in the single-file app;
// they live on one object so every module can read and update them.
export const state = {
  activeView: viewFromLocation(),
  menuOpen: false,
  activeDashboard: "overview",
  dashboardData: null,
  dashboardLoading: false,
  dailyAttendance: null,
  heroSceneCleanup: null,
  adminSession: undefined, // undefined = unchecked, null = signed out, object = signed in admin
  adminChecking: false,
  loginError: "",
  loginSubmitting: false,
  adminsList: null,
  adminsLoading: false,
  editingAdminId: null,
  adminFormError: "",
  editingLaunchItemId: null,
  broadcastAudience: null,
  broadcastBusy: false,
  broadcastNote: "",
  broadcastNoteType: "",

  // The community/department picked on the Communities or Workforce page. The
  // signup form stays hidden until one is picked, then opens with it locked in.
  selectedChoice: { community: "", workforce: "" },

  // Photos picked on the birthday form and the profile editor, already shrunk
  // to JPEG data URLs in the browser (see preparePhoto), kept outside the DOM
  // so a re-render doesn't lose them.
  photoDrafts: { birthday: "", member: "" },
  photoBusy: { birthday: false, member: false },

  // Member sign-in: undefined = unchecked, null = signed out, object = profile.
  memberProfile: undefined,
  memberChecking: false,
  memberStep: "email",
  memberEmail: "",
  memberNote: "",
  memberNoteType: "",
  memberBusy: false,
  memberEditing: false,

  // Admin Members tab: the person whose full profile is open, by group key.
  selectedMemberKey: "",

  // Cell reports (dashboard): data from /api/cell/overview, the cell and date
  // being reported on, and the report being viewed.
  cellData: undefined,
  cellLoading: false,
  cellChoice: "",
  cellDate: "",
  cellDraft: null,
  cellReportView: "",
  cellReportFilter: "",
  deferredInstall: null
};
