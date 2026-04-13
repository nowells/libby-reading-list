import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const svgPath = resolve(import.meta.dirname, "../public/favicon.svg");
const svg = readFileSync(svgPath, "utf-8");

const browser = await chromium.launch();

async function renderIcon(size: number): Promise<Buffer> {
  const html = `<!DOCTYPE html>
<html><head><style>body { margin: 0; }</style></head>
<body>${svg.replace('viewBox="0 0 64 64"', `viewBox="0 0 64 64" width="${size}" height="${size}"`)}</body>
</html>`;

  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html);
  const buffer = await page.screenshot({ type: "png" });
  await page.close();
  return buffer;
}

// Generate apple-touch-icon (180x180)
const appleTouchIcon = await renderIcon(180);
writeFileSync(resolve(import.meta.dirname, "../public/apple-touch-icon.png"), appleTouchIcon);
console.log("Generated apple-touch-icon.png (180x180)");

// Generate favicon as 32x32 PNG (modern browsers prefer this over .ico)
const favicon32 = await renderIcon(32);
writeFileSync(resolve(import.meta.dirname, "../public/favicon-32x32.png"), favicon32);
console.log("Generated favicon-32x32.png");

// Generate a 48x48 for ICO
const favicon48 = await renderIcon(48);
writeFileSync(resolve(import.meta.dirname, "../public/favicon-48x48.png"), favicon48);
console.log("Generated favicon-48x48.png");

await browser.close();
console.log("Done! Note: favicon.svg is the primary favicon, these are fallbacks.");
