// Link-preview details (WhatsApp, Facebook, X...) for every page, in one
// place. Used three ways:
//   - vite.config.js writes a copy of index.html for each page (e.g.
//     dist/birthdays/index.html) carrying that page's tags, because link
//     previewers never run JavaScript and never see anything after a "#".
//   - scripts/generate-share-images.mjs draws each page's 1200x630 image
//     from the headline, text and photo below (run: npm run share-images).
//   - src/app.js sets the browser tab title from `title`.
//
// After changing a headline or photo, re-run `npm run share-images` and bump
// SHARE_IMAGE_VERSION so WhatsApp fetches the new picture instead of its
// cached copy.

export const SITE_URL = "https://harvestersakurecampus.vercel.app";
export const SHARE_IMAGE_VERSION = 1;

// layout: "full" = photo fills the card behind the text; "portrait" = text
// on the left, photo on the right; "celebrate" = designed card, no photo.
export const SHARE_PAGES = {
  home: {
    path: "/",
    title: "Harvesters Akure | There is a place for you here",
    description: "Worship, prayer, community and growth in the heart of Akure. Join a community, serve, or plan your visit.",
    eyebrow: "Harvesters Akure",
    headline: "There is a place for you here.",
    sub: "Worship, prayer, community and growth in the heart of Akure.",
    photo: "hero_worship.png",
    layout: "full"
  },
  about: {
    path: "/about",
    title: "About Harvesters Akure",
    description: "A Harvesters International Christian Centre campus bringing worship, prayer, community and transformation to Akure.",
    eyebrow: "About Us",
    headline: "Something powerful is coming to Akure.",
    sub: "A Harvesters campus for worship, prayer, growth and purpose.",
    photo: "pastor_preaching.png",
    layout: "portrait"
  },
  communities: {
    path: "/communities",
    title: "Join a Community | Harvesters Akure",
    description: "Find your people: Bible study, worship, young professionals, tech, business, family life, and area cells across Akure.",
    eyebrow: "Communities",
    headline: "Find your people.",
    sub: "Interest communities and area cells across Akure. Register in a minute.",
    photo: "gallery-globe.png",
    layout: "full"
  },
  nlp: {
    path: "/nlp",
    title: "Next Level Prayers | Harvesters Akure",
    description: "Start your mornings with prayer, clarity and faith for the city. Daily prayer at 6:30 AM online.",
    eyebrow: "Next Level Prayers",
    headline: "Pray with us every morning.",
    sub: "Daily prayer at 6:30 AM online, for you, your family and the city.",
    photo: "pastor_preaching.png",
    layout: "portrait"
  },
  giving: {
    path: "/giving",
    title: "Giving | Harvesters Akure",
    description: "Give toward the Akure campus launch: venue, media, outreach, children and teens, and ministry infrastructure.",
    eyebrow: "Giving",
    headline: "Partner with what God is building in Akure.",
    sub: "Give toward the launch, venue, media and outreach.",
    photo: "hero_worship.png",
    layout: "full"
  },
  counselling: {
    path: "/counselling",
    title: "Counselling | Harvesters Akure",
    description: "Book pastoral care, premarital support, family support or prayer counselling with the Harvesters Akure team.",
    eyebrow: "Counselling",
    headline: "You don't have to walk through it alone.",
    sub: "Pastoral care, family support and prayer counselling.",
    photo: "pastor_preaching.png",
    layout: "portrait"
  },
  workforce: {
    path: "/workforce",
    title: "Join the Workforce | Harvesters Akure",
    description: "Serve with your gifts: choir, media, protocol, ushering, children, follow-up and more. Help build the Akure campus.",
    eyebrow: "Workforce",
    headline: "Serve with your gifts.",
    sub: "Join a department and help build the Akure campus from day one.",
    photo: "gallery-globe.png",
    layout: "full"
  },
  partnership: {
    path: "/partnership",
    title: "Partnership | Harvesters Akure",
    description: "Partner through prayer, finance, media, venue support, logistics or professional skills.",
    eyebrow: "Partnership",
    headline: "Stand with the Akure launch.",
    sub: "Partner through prayer, finance, media, logistics or your skills.",
    photo: "hero_worship.png",
    layout: "full"
  },
  attendance: {
    path: "/attendance",
    title: "Mark Attendance | Harvesters Akure",
    description: "Check in to today's service with the daily code.",
    eyebrow: "Attendance",
    headline: "Good to see you today!",
    sub: "Check in to today's service with the daily code.",
    photo: "gallery-globe.png",
    layout: "full"
  },
  birthdays: {
    path: "/birthdays",
    title: "Birthday Celebrations | Harvesters Akure",
    description: "Share your birthday and photo with the Harvesters Akure family so we can celebrate and pray with you.",
    eyebrow: "Birthday Celebrations",
    headline: "Let us celebrate you!",
    sub: "Send your name, birthday and photo. We'll celebrate you on your day.",
    layout: "celebrate"
  },
  gallery: {
    path: "/gallery",
    title: "Gallery | Harvesters Akure",
    description: "Worship, outreach and community moments from the Harvesters Akure launch.",
    eyebrow: "Gallery",
    headline: "Moments that carry the vision.",
    sub: "Worship, outreach and community moments from Akure.",
    photo: "gallery-globe.png",
    layout: "full"
  },
  contact: {
    path: "/contact",
    title: "Contact Us | Harvesters Akure",
    description: "Reach the Harvesters Akure team. Call 0811 723 7752 or send us a message.",
    eyebrow: "Contact Us",
    headline: "We'd love to hear from you.",
    sub: "Call 0811 723 7752 or send us a message.",
    photo: "hero_worship.png",
    layout: "full"
  },
  profile: {
    path: "/profile",
    title: "My Profile | Harvesters Akure",
    description: "Sign in with your email to see your communities, teams and birthday, and update your details.",
    eyebrow: "My Profile",
    headline: "Everything about you, in one place.",
    sub: "Sign in with your email to see and update your details.",
    photo: "gallery-globe.png",
    layout: "full"
  },
  dashboard: {
    path: "/admin",
    title: "Team Dashboard | Harvesters Akure",
    description: "Harvesters Akure team dashboard.",
    image: "home",
    noindex: true
  }
};

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function shareImageUrl(id) {
  const imageId = SHARE_PAGES[id].image || id;
  return `${SITE_URL}/share/${imageId}.jpg?v=${SHARE_IMAGE_VERSION}`;
}

// The <head> tags for one page. index.html marks where they go with
// <!-- share-meta --> ... <!-- /share-meta -->.
export function shareMetaTags(id) {
  const page = SHARE_PAGES[id];
  const url = `${SITE_URL}${page.path === "/" ? "/" : page.path}`;
  const image = shareImageUrl(id);
  const alt = page.headline ? `${page.eyebrow}: ${page.headline}` : page.title;
  return [
    `<title>${escapeAttr(page.title)}</title>`,
    `<meta name="description" content="${escapeAttr(page.description)}" />`,
    page.noindex ? `<meta name="robots" content="noindex" />` : "",
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Harvesters Akure" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${escapeAttr(page.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(page.description)}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:secure_url" content="${image}" />`,
    `<meta property="og:image:type" content="image/jpeg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeAttr(alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(page.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(page.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`
  ].filter(Boolean).join("\n    ");
}
