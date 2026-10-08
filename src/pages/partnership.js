import { formPage } from "../components/forms.js";

export function partnershipPage() {
  return `
    <section class="section">
      <div class="container card-grid">
        ${["Prayer Partner", "Financial Partner", "Venue Partner", "Media Partner", "Logistics Partner", "Professional Services"].map(item => `
          <article class="card compact"><h3>${item}</h3><p>Stand with the Akure launch as a ${item.toLowerCase()}.</p><button class="btn secondary block" data-focus-form>Start Partnership</button></article>
        `).join("")}
      </div>
    </section>
    ${formPage("Partnership Interest", ["Full name", "Phone number", "Email address", "Partnership type", "Message"], "partnership")}
  `;
}
