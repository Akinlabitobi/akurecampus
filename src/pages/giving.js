import { externalLinkButton, formPage } from "../components/forms.js";
import { externalLinks } from "../lib/config.js";

export function givingPage() {
  return `
    <section class="section">
      <div class="container card-grid">
        ${["Campus Launch", "Venue Readiness", "Media and Production", "Community Outreach", "Children and Teens", "Transport and Logistics"].map(item => `
          <article class="card compact"><h3>${item}</h3><p>Support ${item.toLowerCase()} for the Harvesters Akure launch.</p>${externalLinkButton("Give Now", externalLinks.giving, "primary block")}</article>
        `).join("")}
      </div>
    </section>
    ${formPage("Giving Pledge", ["Full name", "Phone number", "Email address", "Fund", "Amount"], "giving")}
  `;
}
