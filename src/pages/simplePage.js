import { formPage } from "../components/forms.js";
import { state } from "../lib/state.js";
import { attendancePage } from "./attendance.js";
import { birthdayPage } from "./birthdays.js";
import { communityPage } from "./communities.js";
import { contactPage } from "./contact.js";
import { givingPage } from "./giving.js";
import { aboutSection, gallerySection, serviceSection } from "./home.js";
import { leadCellPage } from "./leadCell.js";
import { nlpPage } from "./nlp.js";
import { partnershipPage } from "./partnership.js";
import { profilePage } from "./profile.js";
import { workforcePage } from "./workforce.js";

export function simplePage(kind) {
  const pageData = {
    about: ["About Harvesters Akure", "A new Harvesters community for worship, prayer, community, growth, and transformation in Akure.", aboutSection() + serviceSection()],
    communities: ["Join a Community", "Find a circle for prayer, friendship, accountability, and spiritual growth before launch.", communityPage()],
    nlp: ["Next Level Prayers", "Start your mornings with prayer, clarity, and faith for the city.", nlpPage()],
    giving: ["Giving", "Give toward launch operations, venue readiness, media, outreach, and ministry infrastructure.", givingPage()],
    counselling: ["Counselling", "Book pastoral care, premarital support, family support, or prayer counselling.", formPage("Counselling Request", ["Full name", "Email address", "Phone number", "Care area", "Preferred time"], "counselling")],
    workforce: ["Join the Workforce", "Serve with your gifts and help build the Akure campus from the beginning.", workforcePage()],
    partnership: ["Partnership", "Partner through prayer, finance, media, venue support, logistics, or professional skills.", partnershipPage()],
    attendance: ["Attendance", "Mark attendance with today's daily code.", attendancePage()],
    "lead-a-cell": ["Lead a Cell", "Open your home and heart to the people around you. Apply to lead a Harvesters Akure cell.", leadCellPage()],
    birthdays: ["Birthday Celebrations", "Share your birthday with the Harvesters Akure family so we can celebrate you.", birthdayPage()],
    gallery: ["Gallery", "A growing archive of launch, worship, outreach, and community moments.", gallerySection() + formPage("Gallery Upload or Content Idea", ["Full name", "Email address", "Subject", "Message"], "content")],
    contact: ["Contact Us", "Reach the Akure launch team and stay updated.", contactPage()],
    profile: state.memberProfile
      ? ["My Profile", "Your Harvesters Akure details, communities and teams in one place.", profilePage()]
      : ["Member Sign In", "Sign in with your email to see and update your Harvesters Akure details.", profilePage()]
  };
  const [title, subtitle, body] = pageData[kind];
  return `
    <section class="page-hero">
      <div class="container">
        <span class="label">Harvesters Akure</span>
        <h1>${title}</h1>
        <p>${subtitle}</p>
      </div>
    </section>
    ${body}
  `;
}
