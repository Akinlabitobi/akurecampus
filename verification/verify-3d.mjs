import { chromium } from "playwright";

const viewports = [
  { name: "desktop", width: 1440, height: 950 },
  { name: "mobile", width: 390, height: 844 }
];

function pixelProbeScript() {
  const canvas = document.querySelector("[data-hero-3d]");
  const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  let colored = 0;
  let checksum = 0;
  const stride = Math.max(4, Math.floor(pixels.length / 2400));
  for (let index = 0; index < pixels.length; index += stride) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const alpha = pixels[index + 3];
    if (red + green + blue > 18 && alpha > 0) colored += 1;
    checksum = (checksum + red * 3 + green * 5 + blue * 7 + alpha * 11 + index) % 1000000007;
  }

  const box = canvas.getBoundingClientRect();
  return { width, height, colored, checksum, box: { width: box.width, height: box.height } };
}

const browser = await chromium.launch({ headless: true });
const results = [];

for (const viewport of viewports) {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1
  });

  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.waitForSelector("[data-hero-3d]");
  await page.waitForTimeout(800);
  const first = await page.evaluate(pixelProbeScript);
  await page.waitForTimeout(1000);
  const second = await page.evaluate(pixelProbeScript);
  await page.screenshot({ path: `verification/${viewport.name}.png`, fullPage: false });
  await page.close();

  results.push({
    viewport: viewport.name,
    canvas: first,
    secondCanvas: second,
    nonblank: first.colored > 120,
    moving: first.checksum !== second.checksum,
    framed: first.box.width > viewport.width * 0.92 && first.box.height > viewport.height * 0.72
  });
}

await browser.close();
console.log(JSON.stringify(results, null, 2));

if (results.some(result => !result.nonblank || !result.moving || !result.framed)) {
  process.exit(1);
}
