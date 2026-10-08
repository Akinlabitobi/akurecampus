import { JOIN_SMALL_GROUP, lockedFormModal } from "../components/forms.js";
import { departments } from "../lib/constants.js";
import { state } from "../lib/state.js";

export function workforcePage() {
  return `
    <section class="section soft">
      <div class="container">
        <div class="center"><span class="label">Departments</span><h2>Serve With Your Gifts</h2></div>
        <div class="pill-grid">${departments.map(item => `<button class="${state.selectedChoice.workforce === item ? "active" : ""}" data-choose="workforce" data-choice="${item}">${item}</button>`).join("")}</div>
      </div>
    </section>
    ${lockedFormModal("Workforce Application", ["Full name", "Phone number", "Email address", "Department", "Relevant experience", "Would you like to lead?", JOIN_SMALL_GROUP, "Small group"], "workforce", "Department")}
  `;
}
