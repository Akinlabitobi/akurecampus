import { showWelcome } from "../components/dialogs.js";
import { icon } from "../components/icon.js";
import { photoPicker, updatePhotoPicker } from "../components/photoPicker.js";
import { QUEUED_NOTE } from "../lib/constants.js";
import { birthdayLabel, escapeHtml, localDateKey } from "../lib/format.js";
import { loadMemberProfile } from "../lib/member.js";
import { postOrQueue } from "../lib/offline-queue.js";
import { state } from "../lib/state.js";

export function birthdayPage() {
  return `
    <section class="section">
      <div class="container split">
        <div>
          <span class="label">Celebrate With Us</span>
          <h2>We Love To Celebrate Our Family</h2>
          <p>Send your name, phone number, birthday, and a clear photo of yourself. When your day comes, the Harvesters Akure family will celebrate and pray with you.</p>
          <div class="attendance-steps">
            <div><strong>1</strong><span>Fill in your details and add a photo</span></div>
            <div><strong>2</strong><span>The team keeps it safe for your special day</span></div>
            <div><strong>3</strong><span>We celebrate you on your birthday</span></div>
          </div>
          <p class="muted">Already sent your details? Send them again with the same name and phone number at any time to update your photo or birthday.</p>
        </div>
        <form class="form" data-birthday-form novalidate>
          <h3>Birthday Details</h3>
          <label><span>Full name</span><input name="fullName" placeholder="Full name" autocomplete="name" required /></label>
          <label><span>Phone number</span><input name="phoneNumber" type="tel" placeholder="Phone number" autocomplete="tel" required /></label>
          <label><span>Email address</span><input name="emailAddress" type="email" placeholder="Email address" autocomplete="email" required value="${escapeHtml(state.memberProfile?.email || "")}" /></label>
          <label><span>Date of birth</span><input name="dateOfBirth" type="date" min="1900-01-01" max="${localDateKey(new Date())}" required /></label>
          ${photoPicker("birthday", "Your photo")}
          <label class="consent"><input name="photoConsent" type="checkbox" /> <span>I'm happy for Harvesters Akure to share this photo and my name when celebrating my birthday.</span></label>
          <button class="btn primary block" type="submit">Send My Birthday ${icon("arrow")}</button>
          <p class="form-note">Your phone number stays private to the team.</p>
        </form>
      </div>
    </section>
  `;
}

export async function saveBirthday(form) {
  const note = form.querySelector(".form-note");
  const button = form.querySelector("button[type='submit']");
  const fields = Object.fromEntries(new FormData(form).entries());
  delete fields.photo;
  const showError = message => {
    note.className = "form-note error";
    note.textContent = message;
  };
  if (!fields.fullName.trim()) return showError("Please enter your full name.");
  if (fields.phoneNumber.replace(/\D/g, "").length < 7) return showError("Please enter a valid phone number.");
  if (!fields.dateOfBirth) return showError("Please enter your date of birth.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.emailAddress || "")) return showError("Please enter a valid email address.");
  if (state.photoBusy.birthday) return showError("Your photo is still being prepared. Please wait a moment.");
  if (!state.photoDrafts.birthday) return showError("Please add a photo of yourself.");
  if (!fields.photoConsent) return showError("Please tick the box to confirm we may share your photo on your birthday.");
  const submissionId = form.dataset.submissionId || crypto.randomUUID();
  form.dataset.submissionId = submissionId;
  note.className = "form-note";
  note.textContent = "Sending...";
  button.disabled = true;
  try {
    const result = await postOrQueue("/api/birthdays", { ...fields, photo: state.photoDrafts.birthday, submissionId }, "Birthday details");
    const firstName = fields.fullName.trim().split(/\s+/)[0];
    form.reset();
    delete form.dataset.submissionId;
    state.photoDrafts.birthday = "";
    updatePhotoPicker(form, "birthday");
    state.dashboardData = null;
    if (state.memberProfile) loadMemberProfile();
    note.className = "form-note success";
    note.textContent = result.queued
      ? QUEUED_NOTE
      : result.updated
      ? `Thanks, ${firstName}! Your birthday details have been updated.`
      : `Thank you, ${firstName}! We look forward to celebrating you on ${birthdayLabel(fields.dateOfBirth)}.`;
    if (!result.queued) showWelcome("birthday", fields, result.record);
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
  }
}
