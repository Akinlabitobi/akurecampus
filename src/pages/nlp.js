import { externalLinkButton, formPage } from "../components/forms.js";
import { externalLinks } from "../lib/config.js";

export function nlpPage() {
  return `
    <section class="section">
      <div class="container split">
        <div>
          <span class="label">Prayer Movement</span>
          <h2>Next Level Prayers for Akure</h2>
          <p>Join daily prayer online as we prepare hearts, families, volunteers, and the city for what God is building.</p>
          <div class="hero-actions prayer-actions">
            ${externalLinkButton("Daily Prayer", externalLinks.dailyPrayer, "primary")}
            ${externalLinkButton("Weekly Prayer", externalLinks.weeklyPrayerWhatsapp, "secondary")}
          </div>
        </div>
        <div class="schedule">
          <div><strong>6:30 AM</strong><span>Daily Prayer Call</span></div>
          <div><strong>Weekly</strong><span>WhatsApp Prayer Community</span></div>
          <div><strong>Monthly</strong><span>City Prayer Walk</span></div>
        </div>
      </div>
    </section>
    ${formPage("NLP Prayer Updates", ["Full name", "Phone number", "Email address", "Prayer focus"], "nlp")}
  `;
}
