import { icon } from "../components/icon.js";
import { QUEUED_NOTE } from "../lib/constants.js";
import { postOrQueue } from "../lib/offline-queue.js";
import { state } from "../lib/state.js";

export function attendancePage() {
  return `
    <section class="section">
      <div class="container split">
        <div>
          <span class="label">Daily Code</span>
          <h2>Mark Attendance With Today's Code</h2>
          <p>The team can announce one code for the day. People do not need to have registered on the website first; attendance is saved from the daily code plus their basic details.</p>
          <div class="daily-code" data-daily-code>
            <span>Today's code</span>
            <strong>Loading...</strong>
          </div>
          <div class="attendance-steps">
            <div><strong>1</strong><span>Announce today's code during service</span></div>
            <div><strong>2</strong><span>Collect name and phone with the code</span></div>
            <div><strong>3</strong><span>Attendance appears in the dashboard</span></div>
          </div>
        </div>
        <form class="form attendance-form" data-attendance-form>
          <h3>Daily Attendance</h3>
          <label><span>Today's code</span><input name="attendanceCode" placeholder="Example: HA0123" autocomplete="off" required /></label>
          <label><span>Full name</span><input name="name" placeholder="Attendee name" required /></label>
          <label><span>Phone number</span><input name="phone" type="tel" placeholder="Phone number" required /></label>
          <label><span>Department or group</span><input name="department" placeholder="Your department or group" required /></label>
          <label><span>Service</span><input name="service" value="Sunday Service" required /></label>
          <label><span>Note</span><input name="note" data-tall placeholder="Note" required /></label>
          <button class="btn primary block" type="submit">Save Attendance ${icon("arrow")}</button>
          <p class="form-note">Use the daily code shown on this page or in the dashboard.</p>
        </form>
      </div>
    </section>
  `;
}

export async function loadDailyAttendanceCode() {
  const codeCard = document.querySelector("[data-daily-code]");
  if (!codeCard) return;
  try {
    const response = await fetch("/api/daily-attendance-code");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not load today's code");
    state.dailyAttendance = result;
    codeCard.innerHTML = `<span>Today's code</span><strong>${result.code}</strong><small>${result.date}</small>`;
    const input = document.querySelector("[data-attendance-form] input[name='attendanceCode']");
    if (input && !input.value) input.value = result.code;
  } catch (error) {
    codeCard.innerHTML = `<span>Today's code</span><strong>Unavailable</strong><small>${error.message}</small>`;
  }
}

export async function saveAttendance(form) {
  const note = form.querySelector(".form-note");
  const button = form.querySelector("button[type='submit']");
  const fields = Object.fromEntries(new FormData(form).entries());
  note.className = "form-note";
  note.textContent = "Saving attendance...";
  if (button) button.disabled = true;
  try {
    const result = await postOrQueue("/api/attendance", { ...fields, submissionId: crypto.randomUUID() }, "Attendance check-in");
    state.dashboardData = null;
    form.reset();
    if (state.dailyAttendance?.code) form.attendanceCode.value = state.dailyAttendance.code;
    note.className = "form-note success";
    note.textContent = result.queued ? `${QUEUED_NOTE} Today's code only works today, so reconnect before the day ends.` : "Attendance saved to the dashboard.";
  } catch (error) {
    note.className = "form-note error";
    note.textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
}
