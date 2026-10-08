import { state } from "../../lib/state.js";

export function broadcastTab() {
  return `
    <div class="panel">
      <h3>Audience</h3>
      ${state.broadcastAudience ? `
        <div class="metric-grid">
          <article class="metric"><span>Opted-in SMS</span><strong>${state.broadcastAudience.sms.recipients}</strong><small>max ${state.broadcastAudience.sms.maximumPerSend} per send</small></article>
          <article class="metric"><span>Opted-in Email</span><strong>${state.broadcastAudience.email.recipients}</strong><small>max ${state.broadcastAudience.email.maximumPerSend} per send</small></article>
        </div>
      ` : `<p class="muted">Loading audience...</p>`}
    </div>
    <div class="dashboard-grid">
      <article class="panel">
        <h3>Send SMS</h3>
        <form class="form inline-form" data-broadcast-form="sms">
          <label><span>Message</span><input name="message" data-tall maxlength="480" required /></label>
          <button class="btn primary" type="submit" ${state.broadcastBusy ? "disabled" : ""}>${state.broadcastBusy === "sms" ? "Sending..." : "Send SMS"}</button>
        </form>
      </article>
      <article class="panel">
        <h3>Send Email</h3>
        <form class="form inline-form" data-broadcast-form="email">
          <label><span>Subject</span><input name="subject" maxlength="120" required /></label>
          <label><span>Message</span><input name="message" data-tall required /></label>
          <button class="btn primary" type="submit" ${state.broadcastBusy ? "disabled" : ""}>${state.broadcastBusy === "email" ? "Sending..." : "Send Email"}</button>
        </form>
      </article>
    </div>
    ${state.broadcastNote ? `<p class="form-note ${state.broadcastNoteType}">${state.broadcastNote}</p>` : ""}
  `;
}
