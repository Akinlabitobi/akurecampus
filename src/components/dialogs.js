import { COMMUNITIES as communities } from "../lib/communities.js";
import { birthdayLabel, escapeHtml, recordCode } from "../lib/format.js";
import { state } from "../lib/state.js";
import { NEW_CELL } from "../pages/leadCell.js";
import { navigate, render } from "../render.js";
import { icon } from "./icon.js";

// ---- Installable app ---------------------------------------------------

export function toast(message, type = "") {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.setAttribute("role", "status");
  element.textContent = message;
  document.body.appendChild(element);
  setTimeout(() => element.classList.add("hide"), 6000);
  setTimeout(() => element.remove(), 6600);
}

// ---- Pop-up dialogs (welcome, submission editor) ----

// Appends a dialog to <body> (outside the re-rendered app) and returns a
// function that closes it. Clicking the dim backdrop or any [data-close]
// element closes it too.
export function openDialog(innerHtml, className = "") {
  const modal = document.createElement("div");
  modal.className = "form-modal";
  modal.innerHTML = `
    <div class="form-modal-panel ${className}" role="dialog" aria-modal="true">
      <button class="form-modal-close" type="button" aria-label="Close" data-close>&times;</button>
      ${innerHtml}
    </div>
  `;
  const close = () => {
    modal.remove();
    document.body.classList.remove("modal-open");
  };
  modal.addEventListener("click", event => {
    if (event.target === modal || event.target.closest("[data-close]")) close();
  });
  document.body.appendChild(modal);
  document.body.classList.add("modal-open");
  return { modal, close };
}

// What to say after each kind of form. Community and workforce signups are
// welcomed into the specific group they chose.
function welcomeContent(type, fields) {
  const firstName = String(fields.fullName || fields.name || "").trim().split(/\s+/)[0];
  const hello = firstName ? `${firstName}, welcome` : "Welcome";
  if (type === "community") {
    const group = fields.preferredCommunity || "the community";
    const description = communities.find(([name]) => name === group)?.[1] || "";
    const isCell = /cell$/i.test(group);
    return {
      icon: "users",
      title: `${hello} to ${group}!`,
      message: `${description} ${isCell
        ? "Your cell leader will reach out with details of your next cell meeting."
        : "Someone from the group will reach out soon about how to get involved."}`,
      extra: fields.workforceTeam
        ? `You're also signed up for the ${fields.workforceTeam} team; its team lead will contact you about training.`
        : "We're so glad you're part of the Harvesters Akure family."
    };
  }
  if (type === "workforce") {
    const team = fields.department || "Workforce";
    return {
      icon: "briefcase",
      title: `${hello} to the ${team} team!`,
      message: `Thank you for choosing to serve. The ${team} team lead will contact you about training and next steps.`,
      extra: fields.smallGroup
        ? `You've also joined ${fields.smallGroup}; someone from there will reach out soon.`
        : "Together we're building something powerful in Akure."
    };
  }
  if (type === "birthday") {
    return {
      icon: "cake",
      title: `${hello} to our birthday family!`,
      message: `We'll celebrate you on ${birthdayLabel(fields.dateOfBirth)}. Look out for your birthday shout-out!`,
      extra: "Every year of your life is a reason to give thanks."
    };
  }
  return {
    counselling: { icon: "heart", title: "We've received your request", message: "A member of our pastoral team will reach out to you at your preferred time. You are not alone, and we're here for you.", extra: "" },
    partnership: { icon: "heart", title: "Thank you for partnering with us!", message: "Our partnership team will contact you about how we can work together for the Akure launch.", extra: "Your support makes a real difference." },
    giving: { icon: "heart", title: "Thank you for your generosity!", message: "Your pledge has been recorded. The finance team may reach out to confirm the details.", extra: "God loves a cheerful giver." },
    cell_lead: { icon: "users", title: "Thank you for stepping up to lead!", message: `We've received your application to lead ${fields.preferredCell === NEW_CELL ? "a new cell in your area" : fields.preferredCell || "a cell"}. A pastor will call you about next steps and training.`, extra: "Leading a cell is one of the best ways to care for people." },
    nlp: { icon: "calendar", title: `${hello} to Next Level Prayers!`, message: "You'll receive prayer updates and reminders. Join us daily at 6:30 AM.", extra: "" },
    contact: { icon: "mail", title: "Message received", message: "Thank you for reaching out. Someone from the Harvesters Akure team will get back to you shortly.", extra: "" },
    content: { icon: "check", title: "Thank you for sharing!", message: "The media team will review your content idea or upload.", extra: "" }
  }[type] || { icon: "check", title: "Thank you!", message: "Your details have been saved.", extra: "" };
}

export function showWelcome(type, fields, record) {
  const content = welcomeContent(type, fields);
  const code = record ? record.shortCode || recordCode(record) : "";
  const email = fields.emailAddress || fields.email || "";
  const offerProfile = email && !state.memberProfile;
  const { modal, close } = openDialog(`
    <div class="welcome-card">
      <span class="welcome-icon">${icon(content.icon)}</span>
      <h3>${escapeHtml(content.title)}</h3>
      <p>${escapeHtml(content.message)}</p>
      ${content.extra ? `<p class="muted">${escapeHtml(content.extra)}</p>` : ""}
      ${code ? `<p class="welcome-code">Your reference: <strong>${escapeHtml(code)}</strong></p>` : ""}
      <div class="welcome-actions">
        <button class="btn primary" type="button" data-close>Done</button>
        ${offerProfile ? `<button class="btn outline" type="button" data-welcome-profile>See my profile</button>` : ""}
      </div>
    </div>
  `, "welcome-panel");
  modal.querySelector("[data-welcome-profile]")?.addEventListener("click", () => {
    close();
    state.memberEmail = email;
    state.memberStep = "email";
    navigate("profile");
  });
}

export function welcomeAfterSubmit(form, type, fields, record) {
  if (type === "newsletter") {
    toast("You're subscribed! Launch updates will come to your inbox.", "success");
    return;
  }
  // Signups made inside the community/department pop-up: close it first.
  if (form.closest(".form-modal") && state.selectedChoice[type] !== undefined) {
    state.selectedChoice[type] = "";
    render();
  }
  showWelcome(type, fields, record);
}
