import { icon } from "../components/icon.js";
import { photoPicker } from "../components/photoPicker.js";
import { birthdayLabel, escapeHtml, formatDate, initials } from "../lib/format.js";
import { state } from "../lib/state.js";

export function profilePage() {
  if (state.memberProfile === undefined) {
    return `<section class="section"><div class="container narrow"><div class="form"><h3>Loading your profile...</h3></div></div></section>`;
  }
  return state.memberProfile ? memberProfileView() : memberSignIn();
}

function memberNoteMarkup() {
  return `<p class="form-note ${state.memberNoteType}">${escapeHtml(state.memberNote)}</p>`;
}

function memberSignIn() {
  const form = state.memberStep === "code"
    ? `
      <form class="form" data-member-code-form>
        <h3>Enter Your Code</h3>
        <p class="muted">We sent a 6-digit code to <strong>${escapeHtml(state.memberEmail)}</strong>. Check your spam folder if it hasn't arrived in a minute or two.</p>
        <label><span>6-digit code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required /></label>
        <button class="btn primary block" type="submit" ${state.memberBusy ? "disabled" : ""}>${state.memberBusy ? "Checking..." : "Sign In"} ${icon("arrow")}</button>
        <div class="inline-actions">
          <button class="btn ghost-dark" type="button" data-member-resend ${state.memberBusy ? "disabled" : ""}>Send a new code</button>
          <button class="btn ghost-dark" type="button" data-member-change-email>Use a different email</button>
        </div>
        ${memberNoteMarkup()}
      </form>
    `
    : `
      <form class="form" data-member-email-form>
        <h3>Sign In</h3>
        <p class="muted">Enter the email address you used on any Harvesters Akure form. We'll email you a 6-digit code &mdash; no password needed.</p>
        <label><span>Email address</span><input name="email" type="email" autocomplete="email" placeholder="you@example.com" value="${escapeHtml(state.memberEmail)}" required /></label>
        <button class="btn primary block" type="submit" ${state.memberBusy ? "disabled" : ""}>${state.memberBusy ? "Sending..." : "Email Me a Code"} ${icon("arrow")}</button>
        ${memberNoteMarkup()}
      </form>
    `;
  return `
    <section class="section">
      <div class="container split">
        <div>
          <span class="label">Members</span>
          <h2>Everything About You, In One Place</h2>
          <p>See your communities, the teams you serve on, and your birthday &mdash; and keep your name, phone number, and photo up to date.</p>
          <div class="attendance-steps">
            <div><strong>1</strong><span>Enter your email address</span></div>
            <div><strong>2</strong><span>Type in the code we email you</span></div>
            <div><strong>3</strong><span>View and update your profile</span></div>
          </div>
          <p class="muted">New here? Sign in with any email to start your profile. Use the same email when you <a href="/communities" data-nav="communities">join a community</a> or <a href="/birthdays" data-nav="birthdays">send your birthday</a> and it will show up here.</p>
        </div>
        ${form}
      </div>
    </section>
  `;
}

export function profileCard(title, iconName, body) {
  return `<article class="profile-section"><h3>${icon(iconName)} ${title}</h3>${body}</article>`;
}

function memberProfileView() {
  const profile = state.memberProfile;
  const list = (items, render) => `<ul class="profile-list">${items.map(item => `<li>${render(item)}</li>`).join("")}</ul>`;
  const empty = (text, view, cta) => `<p class="muted">${text}</p><button class="btn secondary" data-nav="${view}">${cta} ${icon("arrow")}</button>`;
  const editor = `
    <form class="form profile-editor" data-member-profile-form>
      <h3>Edit Profile</h3>
      <label><span>Full name</span><input name="fullName" value="${escapeHtml(profile.name)}" autocomplete="name" required /></label>
      <label><span>Phone number</span><input name="phoneNumber" type="tel" value="${escapeHtml(profile.phone)}" autocomplete="tel" placeholder="Phone number" /></label>
      <label><span>Email address</span><input value="${escapeHtml(profile.email)}" readonly /></label>
      ${photoPicker("member", "Profile photo", profile.photoUrl)}
      <div class="inline-actions">
        <button class="btn primary" type="submit">Save Changes</button>
        <button class="btn ghost-dark" type="button" data-member-cancel-edit>Cancel</button>
      </div>
      ${memberNoteMarkup()}
    </form>
  `;
  return `
    <section class="section">
      <div class="container profile-layout">
        <article class="profile-head">
          <div class="profile-photo">${profile.photoUrl ? `<img src="${escapeHtml(profile.photoUrl)}" alt="${escapeHtml(profile.name)}" />` : `<span>${initials(profile.name)}</span>`}</div>
          <div class="profile-identity">
            <h2>${escapeHtml(profile.name || "Welcome")}</h2>
            <p>${icon("mail")} ${escapeHtml(profile.email)}</p>
            ${profile.phone ? `<p>${icon("phone")} ${escapeHtml(profile.phone)}</p>` : ""}
            ${profile.memberSince ? `<small>With us since ${formatDate(profile.memberSince)}</small>` : ""}
          </div>
          <div class="profile-actions">
            ${state.memberEditing ? "" : `<button class="btn primary" type="button" data-member-edit>Edit Profile</button>`}
            <button class="btn ghost-dark" type="button" data-member-logout>Sign Out</button>
          </div>
        </article>
        ${state.memberEditing ? editor : state.memberNote ? memberNoteMarkup() : ""}
        <div class="profile-grid">
          ${profileCard("Communities", "users", profile.communities.length
            ? list(profile.communities, item => `<strong>${escapeHtml(item.name || "Community")}</strong><small>Joined ${formatDate(item.date)}</small>`)
            : empty("You haven't joined a community yet.", "communities", "Join a Community"))}
          ${profileCard("Workforce", "briefcase", profile.departments.length
            ? list(profile.departments, item => `<strong>${escapeHtml(item.name || "Department")}</strong><small>Applied ${formatDate(item.date)}</small>`)
            : empty("You're not serving on a team yet.", "workforce", "Join the Workforce"))}
          ${profileCard("Birthdays", "cake", profile.birthdays.length
            ? list(profile.birthdays, item => `<span class="profile-person">${item.photoUrl ? `<img src="${escapeHtml(item.photoUrl)}" alt="" />` : ""}<span><strong>${escapeHtml(item.name)}</strong><small>${birthdayLabel(item.dateOfBirth)}</small></span></span>`) + `<button class="btn outline small" data-nav="birthdays">Add or update a birthday</button>`
            : empty("We don't have your birthday yet. Add it with this email address so we can celebrate you.", "birthdays", "Add My Birthday"))}
          ${profile.activity.length ? profileCard("Other Activity", "heart", list(profile.activity, item => `<strong>${escapeHtml(item.label)}</strong><small>${item.detail ? `${escapeHtml(item.detail)} &middot; ` : ""}${formatDate(item.date)}</small>`)) : ""}
        </div>
      </div>
    </section>
  `;
}
