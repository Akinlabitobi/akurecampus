import { formMarkup } from "../components/forms.js";
import { icon } from "../components/icon.js";
import { contactInfo, socialLinks } from "../lib/config.js";

export function contactPage() {
  return `
    <section class="section">
      <div class="container split">
        <div class="contact-list">
          <div>${icon("map")}<span>Akure, Ondo State, Nigeria</span></div>
          <a href="${contactInfo.phoneHref}">${icon("phone")}<span>${contactInfo.phone}</span></a>
          <div>${icon("mail")}<span>akure@harvestersng.org</span></div>
          ${socialLinks.map(social => `<a href="${social.url}" target="_blank" rel="noopener noreferrer">${icon(social.name.toLowerCase())}<span>${social.name} <strong>${social.handle}</strong></span></a>`).join("")}
        </div>
        ${formMarkup("Send a Message", ["Full name", "Email address", "Subject", "Message"], "contact")}
      </div>
    </section>
  `;
}
