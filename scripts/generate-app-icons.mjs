// Builds the installable-app icons and browser favicons in public/icons/
// (plus public/favicon.ico) from the official logo in
// scripts/assets/logo-source.png. Run with: npm run app-icons
//
// A favicon is 16-48px wide, where the full "HARVESTERS ... AKURE" wordmark
// would be an unreadable smudge, so only the logo's cross is used. It is
// lifted out pixel-for-pixel: starting from a point on the cross's long
// stroke, every connected dark pixel is kept. The cross doesn't touch the
// lettering in this version of the logo, so none of the text comes along.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SOURCE = "scripts/assets/logo-source.png";
// A point inside the cross's long stroke, in source-image pixels.
const SEED = { x: 286, y: 640 };

// [file, size, how much of the icon the cross fills, rounded corners]
// Maskable icons get extra padding: phone launchers crop them to circles or
// squircles, so the mark must stay inside the middle ~80%.
const OUTPUTS = [
  ["icons/icon-192.png", 192, 0.74, false],
  ["icons/icon-512.png", 512, 0.74, false],
  ["icons/icon-maskable-512.png", 512, 0.56, false],
  ["icons/apple-touch-icon.png", 180, 0.7, false],
  ["icons/favicon-16.png", 16, 0.94, false],
  ["icons/favicon-32.png", 32, 0.92, true],
  ["icons/favicon-48.png", 48, 0.9, true]
];

const browser = await chromium.launch();
const page = await browser.newPage();
const results = await page.evaluate(async ({ source, seed, outputs }) => {
  const image = new Image();
  image.src = source;
  await image.decode();
  const width = image.width;
  const height = image.height;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, width, height).data;
  // 0 = white paper, 255 = solid black ink.
  const ink = new Uint8Array(width * height);
  for (let i = 0; i < ink.length; i++) {
    ink[i] = 255 - Math.round(0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2]);
  }

  // Flood-fill the cross from the seed through clearly-inked pixels.
  const inCross = new Uint8Array(width * height);
  const stack = [seed.y * width + seed.x];
  if (ink[stack[0]] < 128) throw new Error("Seed point is not on the cross; adjust SEED.");
  let minX = width, minY = height, maxX = 0, maxY = 0;
  while (stack.length) {
    const index = stack.pop();
    if (inCross[index] || ink[index] < 60) continue;
    inCross[index] = 1;
    const x = index % width;
    const y = (index - x) / width;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    if (x > 0) stack.push(index - 1);
    if (x < width - 1) stack.push(index + 1);
    if (y > 0) stack.push(index - width);
    if (y < height - 1) stack.push(index + width);
  }

  // The mark on a transparent background, keeping the soft anti-aliased
  // edge pixels that border the cross.
  const pad = 3;
  const markWidth = maxX - minX + 1 + pad * 2;
  const markHeight = maxY - minY + 1 + pad * 2;
  const mark = new OffscreenCanvas(markWidth, markHeight);
  const markContext = mark.getContext("2d");
  const markData = markContext.createImageData(markWidth, markHeight);
  for (let y = minY - pad; y <= maxY + pad; y++) {
    for (let x = minX - pad; x <= maxX + pad; x++) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dx = -2; dx <= 2 && !near; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && inCross[ny * width + nx]) near = true;
        }
      }
      if (!near) continue;
      const out = ((y - minY + pad) * markWidth + (x - minX + pad)) * 4;
      markData.data[out + 3] = ink[y * width + x];
    }
  }
  markContext.putImageData(markData, 0, 0);

  const toDataUrl = async target => {
    const blob = await target.convertToBlob({ type: "image/png" });
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  };

  // The bare cross, kept beside the source logo for reuse (not served).
  const files = { "../scripts/assets/logo-cross.png": await toDataUrl(mark) };
  for (const [file, size, fill, rounded] of outputs) {
    const icon = new OffscreenCanvas(size, size);
    const iconContext = icon.getContext("2d");
    iconContext.fillStyle = "#ffffff";
    if (rounded) {
      iconContext.beginPath();
      iconContext.roundRect(0, 0, size, size, size * 0.2);
      iconContext.fill();
    } else {
      iconContext.fillRect(0, 0, size, size);
    }
    const scale = (size * fill) / Math.max(markWidth, markHeight);
    const drawWidth = markWidth * scale;
    const drawHeight = markHeight * scale;
    iconContext.imageSmoothingQuality = "high";
    iconContext.drawImage(mark, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);
    files[file] = await toDataUrl(icon);
  }
  return { files, bounds: { minX, minY, maxX, maxY } };
}, {
  source: `data:image/png;base64,${readFileSync(SOURCE).toString("base64")}`,
  seed: SEED,
  outputs: OUTPUTS
});
await browser.close();

mkdirSync("public/icons", { recursive: true });
const pngs = {};
for (const [file, dataUrl] of Object.entries(results.files)) {
  pngs[file] = Buffer.from(dataUrl.split(",")[1], "base64");
  writeFileSync(`public/${file}`, pngs[file]);
  console.log(`public/${file}`);
}

// favicon.ico holding the 16, 32 and 48px PNGs (the ICO format allows PNG
// entries, so no conversion is needed).
const icoImages = [16, 32, 48].map(size => ({ size, data: pngs[`icons/favicon-${size}.png`] }));
const header = Buffer.alloc(6 + icoImages.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoImages.length, 4);
let offset = header.length;
icoImages.forEach(({ size, data }, index) => {
  const entry = 6 + index * 16;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});
writeFileSync("public/favicon.ico", Buffer.concat([header, ...icoImages.map(image => image.data)]));
console.log("public/favicon.ico");
console.log("cross found at", JSON.stringify(results.bounds));
