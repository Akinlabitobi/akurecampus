import { COMMUNITIES as communities } from "../lib/communities.js";
import { departments } from "../lib/constants.js";
import { escapeHtml, fieldName } from "../lib/format.js";
import { state } from "../lib/state.js";
import { MEETING_DAYS, leadableCells } from "../pages/leadCell.js";
import { render } from "../render.js";
import { icon } from "./icon.js";

// Nothing is rendered until a community/department has been picked; then the
// form opens in a pop-up with that pick filled into `lockedField`, read-only.
export function lockedFormModal(title, fields, type, lockedField) {
  const choice = state.selectedChoice[type];
  if (!choice) return "";
  return `
    <div class="form-modal" data-close-choice>
      <div class="form-modal-panel" role="dialog" aria-modal="true" aria-label="${title}">
        <button class="form-modal-close" type="button" data-close-choice aria-label="Close">&times;</button>
        ${formMarkup(title, fields, type, { [lockedField]: choice })}
      </div>
    </div>
  `;
}

export function formPage(title, fields, type) {
  return `<section class="section" id="form"><div class="container narrow">${formMarkup(title, fields, type)}</div></section>`;
}

export function formMarkup(title, fields, type, locked = {}) {
  return `
    <form class="form" data-api-form data-form-type="${type}">
      <h3>${title}</h3>
      ${fields.map(field => field in locked ? lockedField(field, locked[field]) : formField(field, type)).join("")}
      ${["community", "counselling"].includes(type) ? `<label class="consent"><input name="communicationsConsent" type="checkbox" /> <span>I agree to receive Harvesters Akure updates by SMS and email.</span></label>` : ""}
      <button class="btn primary block" type="submit">Submit ${icon("arrow")}</button>
      <p class="form-note">Submissions save to the local database and appear in the dashboard.</p>
    </form>
  `;
}

// Follow-up questions: the community form offers the workforce and the
// workforce form offers a small group. The pick only shows (and is only
// required) once they answer Yes.
export const JOIN_WORKFORCE = "Would you like to join the workforce?";
export const JOIN_SMALL_GROUP = "Would you like to join a small group?";
const REVEALS = { [JOIN_WORKFORCE]: "Workforce team", [JOIN_SMALL_GROUP]: "Small group" };

// Every community and cell, split into interest groups and area cells.
export function smallGroupOptions(current = "") {
  const option = name => `<option value="${escapeHtml(name)}" ${name === current ? "selected" : ""}>${escapeHtml(name)}</option>`;
  const names = communities.map(([name]) => name);
  const isCell = name => /cell$/i.test(name);
  const extra = current && !names.includes(current) ? option(current) : "";
  return `${extra}<optgroup label="Interest communities">${names.filter(name => !isCell(name)).map(option).join("")}</optgroup>`
    + `<optgroup label="Cells (by area)">${names.filter(isCell).map(option).join("")}</optgroup>`;
}

function formField(field, type) {
  const name = fieldName(field);
  const question = Object.keys(REVEALS).find(key => REVEALS[key] === field);
  if (question) {
    const smallGroup = field === "Small group";
    const options = smallGroup ? smallGroupOptions() : departments.map(item => `<option value="${item}">${item}</option>`).join("");
    return `<label data-reveal-for="${fieldName(question)}" hidden><span>${smallGroup ? "Pick a small group (community or cell)" : "Pick a workforce team"}</span><select name="${name}" required disabled><option value="">Select an option</option>${options}</select></label>`;
  }
  const dateOfBirth = field === "Date of Birth";
  const email = field === "Email address";
  const yesNo = field === "Would you like to lead?" || field in REVEALS;
  const phone = field === "Phone number";
  const amount = field === "Amount";
  const tall = ["Message", "Relevant experience", "Leadership experience", "Why do you want to lead?"].includes(field);
  const choices = yesNo ? ["Yes", "No"]
    : field === "Preferred cell" ? leadableCells()
    : field === "Preferred meeting day" ? MEETING_DAYS
    : null;
  // Every field on every public form is required (the server checks too).
  if (choices) {
    return `<label><span>${field}</span><select name="${name}" required ${field in REVEALS ? "data-reveal" : ""}><option value="">Select an option</option>${choices.map(choice => `<option value="${choice}">${choice}</option>`).join("")}</select></label>`;
  }
  return `<label><span>${field}</span><input name="${name}" type="${dateOfBirth ? "date" : email ? "email" : phone ? "tel" : "text"}" ${amount ? 'inputmode="numeric"' : ""} ${tall ? "data-tall" : ""} required placeholder="${dateOfBirth ? "" : field}" /></label>`;
}

// Shows a follow-up pick only while its question is answered Yes. A hidden
// pick is disabled, so the browser neither requires nor submits it.
export function syncReveals(form) {
  form.querySelectorAll("[data-reveal-for]").forEach(label => {
    const show = form.elements[label.dataset.revealFor]?.value === "Yes";
    const select = label.querySelector("select");
    label.hidden = !show;
    select.disabled = !show;
    if (!show) select.value = "";
  });
}

function lockedField(field, value) {
  return `<label><span>${field}</span><div class="locked-field"><input name="${fieldName(field)}" value="${value}" readonly /><button class="btn ghost-dark" type="button" data-close-choice>Change</button></div></label>`;
}

export function externalLinkButton(label, url, classes = "primary") {
  if (!url) return `<button class="btn ${classes}" type="button" disabled title="This link has not been configured yet.">${label}</button>`;
  return `<a class="btn ${classes}" href="${url}" target="_blank" rel="noopener noreferrer">${label} ${icon("arrow")}</a>`;
}

export function closeChoiceModal() {
  state.selectedChoice = { community: "", workforce: "" };
  // Keep the reader where they were in the list rather than jumping to the top.
  const scrollY = window.scrollY;
  render();
  window.scrollTo(0, scrollY);
}
