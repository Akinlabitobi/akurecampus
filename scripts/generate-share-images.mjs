// Draws the 1200x630 link-preview image for every page in src/share-meta.js
// into public/share/<page>.jpg. Run with: npm run share-images
//
// To use a real photo for a page, drop it in public/ and set that page's
// `photo` in src/share-meta.js (and bump SHARE_IMAGE_VERSION), then re-run.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { SHARE_PAGES } from "../src/share-meta.js";

const dataUrl = file => {
  const type = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[extname(file).toLowerCase()];
  return `data:${type};base64,${readFileSync(`public/${file}`).toString("base64")}`;
};

const styles = `
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; position: relative; overflow: hidden; font-family: Inter, sans-serif; color: #fff; background: #071e3d; }
  /* Taller than the frame and anchored to the bottom: crops off the top
     strip, where the stock photos carry other campuses' signs. */
  .bg { position: absolute; left: 0; bottom: 0; width: 100%; height: 140%; object-fit: cover; object-position: center bottom; }
  .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(7,30,61,.95) 0%, rgba(7,30,61,.8) 50%, rgba(7,30,61,.25) 100%); }
  .portrait-photo { position: absolute; top: 0; right: 0; width: 470px; height: 100%; object-fit: cover; object-position: center 20%; }
  .portrait-fade { position: absolute; top: 0; right: 330px; width: 140px; height: 100%; background: linear-gradient(90deg, #071e3d, rgba(7,30,61,0)); }
  .content { position: absolute; left: 72px; top: 60px; bottom: 64px; width: 660px; display: flex; flex-direction: column; }
  .logo { width: 250px; }
  .eyebrow { margin-top: auto; display: flex; align-items: center; gap: 12px; font-weight: 600; font-size: 22px; letter-spacing: .14em; text-transform: uppercase; color: #ffb3b6; }
  .eyebrow span { width: 40px; height: 4px; background: #d71920; border-radius: 2px; }
  h1 { margin-top: 16px; font-family: "Plus Jakarta Sans", sans-serif; font-size: 64px; line-height: 1.06; font-weight: 800; }
  p { margin-top: 20px; font-size: 25px; line-height: 1.4; color: rgba(255,255,255,.86); }
  /* Birthday card: brand red with confetti. */
  body.portrait .content { width: 600px; }
  body.celebrate { background: radial-gradient(circle at 80% 30%, #f0353c 0%, #d71920 45%, #9e0f15 100%); }
  body.celebrate .eyebrow { color: #ffe1e2; }
  body.celebrate .eyebrow span { background: #fff; }
  .confetti { position: absolute; border-radius: 50%; }
  .cake { position: absolute; right: 120px; top: 150px; font-size: 230px; line-height: 1; filter: drop-shadow(0 20px 30px rgba(0,0,0,.25)); }
`;

const confetti = Array.from({ length: 40 }, (_, index) => {
  // Deterministic "random" so re-runs produce the same image.
  const rand = n => (Math.sin(index * 97.13 + n * 13.7) + 1) / 2;
  const size = 8 + rand(1) * 18;
  const color = ["#ffffff", "#ffd166", "#071e3d", "#ffb3b6"][index % 4];
  return `<i class="confetti" style="left:${620 + rand(2) * 560}px;top:${rand(3) * 610}px;width:${size}px;height:${size}px;background:${color};opacity:${0.5 + rand(4) * 0.5}"></i>`;
}).join("");

function pageHtml(page) {
  const background = {
    full: () => `<img class="bg" src="${dataUrl(page.photo)}"><div class="shade"></div>`,
    portrait: () => `<img class="portrait-photo" src="${dataUrl(page.photo)}"><div class="portrait-fade"></div>`,
    celebrate: () => `${confetti}<div class="cake">🎂</div>`
  }[page.layout]();
  return `<!doctype html><html><head>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&family=Inter:wght@500;600&display=swap" rel="stylesheet">
    <style>${styles}</style></head>
    <body class="${page.layout}">
      ${background}
      <div class="content">
        <img class="logo" src="${dataUrl("logo-white.png")}">
        <div class="eyebrow"><span></span>${page.eyebrow}</div>
        <h1>${page.headline}</h1>
        <p>${page.sub}</p>
      </div>
    </body></html>`;
}

mkdirSync("public/share", { recursive: true });
const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [id, page] of Object.entries(SHARE_PAGES)) {
  if (!page.layout) continue; // pages that reuse another page's image
  await tab.setContent(pageHtml(page), { waitUntil: "networkidle" });
  await tab.evaluate(() => document.fonts.ready);
  await tab.screenshot({ path: `public/share/${id}.jpg`, type: "jpeg", quality: 82 });
  console.log(`public/share/${id}.jpg`);
}
await browser.close();
