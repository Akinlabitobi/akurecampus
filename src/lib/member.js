import { render } from "../render.js";
import { state } from "./state.js";

export function setMemberNote(text, type = "") {
  state.memberNote = text;
  state.memberNoteType = type;
}

async function memberRequest(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}

export async function loadMemberProfile() {
  if (state.memberChecking) return;
  state.memberChecking = true;
  try {
    const response = await fetch("/api/member/me");
    state.memberProfile = (await response.json()).profile || null;
  } catch {
    state.memberProfile = null;
  } finally {
    state.memberChecking = false;
    if (state.activeView === "profile") render();
    else updateMemberButtons();
  }
}

export function memberButtonLabel() {
  return state.memberProfile ? "My Profile" : "Sign In";
}

function updateMemberButtons() {
  document.querySelectorAll("[data-member-label]").forEach(element => {
    element.textContent = memberButtonLabel();
  });
}

export async function requestMemberCode() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.memberEmail)) {
    setMemberNote("Please enter a valid email address.", "error");
    render();
    return;
  }
  state.memberBusy = true;
  setMemberNote("");
  render();
  try {
    const result = await memberRequest("/api/member/request-code", { email: state.memberEmail });
    state.memberStep = "code";
    setMemberNote(result.message, "success");
  } catch (error) {
    setMemberNote(error.message, "error");
  } finally {
    state.memberBusy = false;
    render();
    document.querySelector("[data-member-code-form] input[name='code']")?.focus();
  }
}

export async function verifyMemberCode(code) {
  state.memberBusy = true;
  setMemberNote("");
  render();
  try {
    const result = await memberRequest("/api/member/verify", { email: state.memberEmail, code });
    state.memberProfile = result.profile;
    state.memberStep = "email";
    // A brand-new profile has no name yet; open the editor straight away.
    state.memberEditing = !state.memberProfile.name;
    setMemberNote(state.memberEditing ? "Welcome! Add your name and photo to finish your profile." : "", "success");
  } catch (error) {
    setMemberNote(error.message, "error");
  } finally {
    state.memberBusy = false;
    render();
  }
}

export async function saveMemberProfile(form) {
  // Errors are shown in place rather than through render(), which would
  // rebuild the form and throw away what the member just typed.
  const note = form.querySelector(".form-note");
  const button = form.querySelector("button[type='submit']");
  const showError = message => {
    note.className = "form-note error";
    note.textContent = message;
  };
  const fields = Object.fromEntries(new FormData(form).entries());
  delete fields.photo;
  if (!fields.fullName.trim()) return showError("Please enter your full name.");
  if (state.photoBusy.member) return showError("Your photo is still being prepared. Please wait a moment.");
  button.disabled = true;
  button.textContent = "Saving...";
  try {
    const result = await memberRequest("/api/member/profile", { ...fields, photo: state.photoDrafts.member || undefined });
    state.memberProfile = result.profile;
    state.photoDrafts.member = "";
    state.memberEditing = false;
    state.dashboardData = null;
    setMemberNote("Your profile has been updated.", "success");
    render();
  } catch (error) {
    if (/sign in again/i.test(error.message)) {
      state.memberProfile = null;
      setMemberNote(error.message, "error");
      render();
      return;
    }
    showError(error.message);
    button.disabled = false;
    button.textContent = "Save Changes";
  }
}

export async function signOutMember() {
  try {
    await memberRequest("/api/member/logout");
  } catch {
    // the local session is cleared regardless
  }
  state.memberProfile = null;
  state.memberEditing = false;
  state.memberStep = "email";
  state.photoDrafts.member = "";
  setMemberNote("You've been signed out.", "success");
  render();
}
