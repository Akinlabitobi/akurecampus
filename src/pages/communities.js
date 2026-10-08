import { JOIN_WORKFORCE, lockedFormModal } from "../components/forms.js";
import { COMMUNITIES as communities } from "../lib/communities.js";
import { state } from "../lib/state.js";

function communityCard(title, text) {
  return `<article class="card compact ${state.selectedChoice.community === title ? "selected" : ""}"><h3>${title}</h3><p>${text}</p><button class="btn secondary block" data-choose="community" data-choice="${title}">Register Interest</button></article>`;
}

export function communityPage() {
  return `
    <section class="section">
      <div class="container">
        <div class="center"><span class="label">Communities</span><h2>Find People Who Share Your Passion</h2></div>
        <div class="card-grid">${communities.map(([title, text]) => communityCard(title, text)).join("")}</div>
      </div>
    </section>
    ${lockedFormModal("Community Signup", ["Full name", "Phone number", "Email address", "Preferred community", "Area in Akure", "Date of Birth", "Would you like to lead?", JOIN_WORKFORCE, "Workforce team"], "community", "Preferred community")}
  `;
}
