import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const svgPath = resolve(import.meta.dirname, "../public/og-image.svg");
const outPath = resolve(import.meta.dirname, "../public/og-image.png");

const svg = readFileSync(svgPath, "utf-8");

const html = `<!DOCTYPE html>
<html>
<head><style>body { margin: 0; }</style></head>
<body>${svg}</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
const buffer = await page.screenshot({ type: "png" });
writeFileSync(outPath, buffer);
await browser.close();

console.log(`Generated ${outPath}`);
