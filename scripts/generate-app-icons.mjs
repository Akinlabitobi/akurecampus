// Draws the installable-app icons and browser favicons into public/icons/.
// Run with: npm run app-icons
//
// The logo's cross can't be cropped out of logo-black.png cleanly (its arm
// runs into the "HARVESTERS" lettering), so the mark is redrawn here as a
// vector in the same style: a tall slanted stroke and a rising arm.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const NAVY = "#071e3d";

// A brush stroke: a cubic Bezier centre line whose width changes linearly
// from `from` to `to`, drawn as a filled outline with round ends.
function brush([p0, p1, p2, p3], from, to) {
  const at = t => {
    const u = 1 - t;
    return [0, 1].map(i => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]);
  };
  const left = [];
  const right = [];
  const steps = 40;
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const [x, y] = at(t);
    const [nx, ny] = at(Math.min(1, t + 0.001));
    const [px, py] = at(Math.max(0, t - 0.001));
    const length = Math.hypot(nx - px, ny - py);
    const half = (from + (to - from) * t) / 2;
    const ox = (-(ny - py) / length) * half;
    const oy = ((nx - px) / length) * half;
    left.push(`${(x + ox).toFixed(1)},${(y + oy).toFixed(1)}`);
    right.unshift(`${(x - ox).toFixed(1)},${(y - oy).toFixed(1)}`);
  }
  const [sx, sy] = p0;
  const [ex, ey] = p3;
  return `<polygon points="${[...left, ...right].join(" ")}"/>
    <circle cx="${sx}" cy="${sy}" r="${from / 2}"/><circle cx="${ex}" cy="${ey}" r="${to / 2}"/>`;
}

const CROSS = [
  brush([[300, 74], [288, 190], [262, 330], [240, 448]], 52, 20),
  brush([[124, 252], [220, 226], [318, 200], [404, 180]], 18, 40)
].join("\n    ");

// `scale` shrinks the cross toward the centre. Maskable icons need it: phone
// launchers crop them to circles or squircles, so the mark must sit inside
// the middle ~80% "safe zone".
function iconSvg({ scale = 1, rounded = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="${NAVY}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-262 -262)" fill="#fff">
    ${CROSS}
  </g>
</svg>`;
}

const outputs = [
  ["icon-192.png", 192, iconSvg({ scale: 0.82 })],
  ["icon-512.png", 512, iconSvg({ scale: 0.82 })],
  ["icon-maskable-512.png", 512, iconSvg({ scale: 0.62 })],
  ["apple-touch-icon.png", 180, iconSvg({ scale: 0.78 })],
  ["favicon-32.png", 32, iconSvg({ scale: 0.95, rounded: true })]
];

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/icons/favicon.svg", iconSvg({ scale: 0.95, rounded: true }));
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, svg] of outputs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${size}" height="${size}" style="display:block"></body>`);
  await page.screenshot({ path: `public/icons/${file}`, omitBackground: true });
  console.log(`public/icons/${file}`);
}
await browser.close();
