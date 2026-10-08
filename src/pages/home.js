import { icon } from "../components/icon.js";
import { dashboardCards } from "../lib/constants.js";
import { pathForView } from "../lib/router.js";

export function home() {
  return `
    <section class="hero home-hero">
      <img class="hero-img" src="/hero_worship.png" alt="Harvesters worship gathering" />
      <div class="hero-overlay"></div>
      <canvas class="hero-canvas" data-hero-3d aria-label="3D sanctuary scene"></canvas>
      <div class="container hero-inner">
        <div class="hero-copy">
          <div class="eyebrow"><span></span> Harvesters Akure</div>
          <h1>There is a place for you here.</h1>
          <p>A Harvesters family is gathering in the city for prayer, worship, friendship, service, and spiritual growth.</p>
          <div class="hero-actions">
            <button class="btn primary xl" data-nav="communities">Join Community ${icon("arrow")}</button>
            <button class="btn ghost xl" data-nav="workforce">Serve</button>
          </div>
        </div>
        <div class="hero-scene-label">
          <span>Sunday Gathering</span>
          <strong>Akure Launch Home</strong>
          <small>Worship • Word • Community</small>
        </div>
        <div class="hero-strip">
          <div><span>Launch City</span><strong>Akure</strong></div>
          <div><span>Sunday Services</span><strong>8:00 AM / 10:00 AM</strong></div>
          <div><span>Prayer</span><strong>6:30 AM Daily</strong></div>
          <div><span>Teams</span><strong>18 Departments</strong></div>
        </div>
      </div>
    </section>
    ${homeIntro()}
    ${aboutSection()}
    ${serviceSection()}
    ${nextSteps()}
    ${visitSection()}
    ${gallerySection()}
    ${cta()}
  `;
}

function visitSection() {
  const items = [
    ["Arrive", "Friendly hosts help you find your seat and the right next step."],
    ["Worship", "A lively room, clear teaching, prayer, and a service built for people."],
    ["Connect", "Meet a community, join a team, or leave your details for follow-up."]
  ];
  return `
    <section class="section visit-section">
      <div class="container split">
        <div>
          <span class="label">Plan Your Visit</span>
          <h2>A Sunday experience that feels warm, clear, and alive.</h2>
          <p>From the first welcome to the final prayer, Harvesters Akure is designed to help people encounter God and find family without confusion.</p>
          <button class="btn secondary" data-nav="contact">Ask a Question ${icon("arrow")}</button>
        </div>
        <div class="visit-list">
          ${items.map(([title, text], index) => `
            <article>
              <span>${String(index + 1).padStart(2, "0")}</span>
              <div><strong>${title}</strong><p>${text}</p></div>
            </article>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

function homeIntro() {
  const items = [
    ["Build", "Help prepare the people, systems, and service teams before launch.", "workforce", "Join the Workforce"],
    ["Belong", "Find a community for prayer, friendship, and steady spiritual growth.", "communities", "Join a Community"],
    ["Serve", "Join a department and bring your gifts into the room.", "workforce", "Join the Workforce"]
  ];
  return `
    <section class="home-intro">
      <div class="container intro-grid">
        <div>
          <span class="label">A Real Home Base</span>
          <h2>Take Your Next Step For A City - Wide Launch.</h2>
        </div>
        ${items.map(([title, text, view, cta]) => `
          <article>l
            <strong>${title}</strong>
            <p>${text}</p>
            <a class="intro-link" href="${pathForView(view)}" data-nav="${view}">${cta} ${icon("arrow")}</a>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

export function aboutSection() {
  return `
    <section class="section" id="about">
      <div class="container split">
        <div>
          <span class="label">About Us</span>
          <h2>Something Powerful is Coming to Akure</h2>
          <div class="divider"></div>
          <p>Harvesters Akure brings the Harvesters experience of worship, prayer, community, growth, purpose, and transformation to the heart of Ondo State.</p>
          <p>The Harvesters dream began on December 13, 2003, through a divine vision given to Pastor Bolaji Idowu. That same vision is reaching Akure with fresh energy and a city-wide invitation.</p>
          <button class="btn secondary" data-nav="about">Learn More ${icon("arrow")}</button>
        </div>
        <div class="image-stack">
          <img src="/pastor_preaching.png" alt="Harvesters ministry moment" />
          <div class="founded"><span>Founded</span><strong>2003</strong><small>Harvesters International</small></div>
        </div>
      </div>
    </section>
  `;
}

function nextSteps() {
  const cards = [
    ["users", "Join a Community", "Find people to do life with, grow with, pray with, and connect with before launch.", "communities", "Explore Communities"],
    ["heart", "Partner With Us", "Support the vision through giving, resources, skills, prayer, or collaboration.", "partnership", "Become a Partner"],
    ["briefcase", "Join the Workforce", "Be part of the launch team helping to build this new campus from the ground up.", "workforce", "Join Launch Team"]
  ];
  return `
    <section class="section soft">
      <div class="container">
        <div class="center">
          <span class="label">Take Your Next Step</span>
          <h2>Be Part of Harvesters Akure From the Beginning</h2>
        </div>
        <div class="card-grid">
          ${cards.map(([ic, title, text, view, ctaText]) => `
            <article class="card">
              <div class="icon-box ${ic === "heart" ? "red" : ""}">${icon(ic)}</div>
              <h3>${title}</h3>
              <p>${text}</p>
              <button class="btn primary block" data-nav="${view}">${ctaText} ${icon("arrow")}</button>
            </article>
          `).join("")}
        </div>
      </div>
    </section>
  `;
}

export function serviceSection() {
  return `
    <section class="section navy">
      <div class="container">
        <div class="center">
          <span class="label red-text">Service Times</span>
          <h2>Join Us When We Launch</h2>
        </div>
        <div class="service-grid">
          <div><strong>Sundays</strong><span>Celebration Service</span><em>10:30 AM and 12:30 PM</em></div>
          <div><strong>Wednesdays</strong><span>Midweek Recharge</span><em>6:00 PM</em></div>
          <div><strong>Daily</strong><span>Next Level Prayers</span><em>6:30 AM online</em></div>
          <div><strong>Saturday Prayer</strong><span>Intense with Pastor Abraham</span><em>9:30 AM</em></div>
        </div>
      </div>
    </section>
  `;
}

function dashboardPreview() {
  return `
    <section class="section">
      <div class="container">
        <div class="split dashboard-tease">
          <div>
            <span class="label">Launch Dashboards</span>
            <h2>Manage the Akure Launch With Clarity</h2>
            <p>Track communities, volunteers, partners, care requests, events, and content from one focused operations dashboard.</p>
            <button class="btn secondary" data-nav="dashboard">Open Dashboard ${icon("arrow")}</button>
          </div>
          <div class="mini-dashboard">
            ${dashboardCards.slice(0, 3).map(([title, value, change]) => `
              <div class="metric"><span>${title}</span><strong>${value}</strong><small>${change}</small></div>
            `).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

export function gallerySection() {
  return `
    <section class="section soft">
      <div class="container">
        <div class="center">
          <span class="label">Gallery</span>
          <h2>Moments That Carry the Vision</h2>
        </div>
        <div class="gallery">
          <img src="/hero_worship.png" alt="Worship gathering" />
          <img src="/pastor_preaching.png" alt="Teaching moment" />
          <img src="/gallery-globe.png" alt="Harvesters worship congregation" />
          <div class="gallery-card">
            <strong>Akure Launch Gallery</strong>
            <span>Upload worship, outreach, volunteer, and pre-launch photos from the dashboard.</span>
            <button class="btn primary" data-nav="gallery">View Gallery</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function cta() {
  return `
    <section class="cta">
      <img src="/hero_worship.png" alt="" />
      <div></div>
      <article>
        <span class="label red-text">Your Next Step</span>
        <h2>Be Part of Harvesters Akure <strong>From the Beginning</strong></h2>
        <p>Whether you join a community, serve on the team, or partner with the vision, there is a place for you here.</p>
        <div class="hero-actions centered">
          <button class="btn primary xl" data-nav="communities">Join Community ${icon("arrow")}</button>
          <button class="btn ghost xl" data-nav="partnership">Partner With Us</button>
          <button class="btn ghost xl" data-nav="workforce">Join Workforce</button>
        </div>
      </article>
    </section>
  `;
}
