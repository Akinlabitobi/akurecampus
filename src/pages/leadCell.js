import { formMarkup } from "../components/forms.js";
import { COMMUNITIES as communities } from "../lib/communities.js";

// The cells someone can apply to lead: every area cell, or a new one.
export const NEW_CELL = "Start a new cell in my area";
export const leadableCells = () => [...communities.map(([name]) => name).filter(name => /cell$/i.test(name)), NEW_CELL];
export const MEETING_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function leadCellPage() {
  return `
    <section class="section">
      <div class="container split">
        <div>
          <span class="label">Cell Leadership</span>
          <h2>Lead a Cell Where You Live</h2>
          <p>Cells are where people in Harvesters Akure pray, study the Word, and look out for one another during the week. If you want to lead one, in an existing area or a new one, tell us about yourself.</p>
          <div class="attendance-steps">
            <div><strong>1</strong><span>Fill in the form</span></div>
            <div><strong>2</strong><span>A pastor calls you to talk it over</span></div>
            <div><strong>3</strong><span>Get trained and start leading your cell</span></div>
          </div>
        </div>
        ${formMarkup("Cell Leader Application", ["Full name", "Phone number", "Email address", "Area in Akure", "Preferred cell", "Preferred meeting day", "Leadership experience", "Why do you want to lead?"], "cell_lead")}
      </div>
    </section>
  `;
}
