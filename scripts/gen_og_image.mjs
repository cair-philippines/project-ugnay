/**
 * Generates public/og-image.png at 1200×630 px.
 * Run from any directory; paths are absolute.
 */
import pkg from "/workspace/innovation-projects/project_ugnay/tests/e2e/node_modules/playwright-core/index.js";
const { chromium } = pkg;
import { readFileSync, writeFileSync } from "fs";

const CHROME = "/home/node/.cache/ms-playwright/chromium-1228/chrome-linux/chrome";
const OUT    = "/workspace/innovation-projects/project_ugnay/platform/frontend/public/og-image.png";

const depedB64 = readFileSync(
  "/workspace/innovation-projects/project_ugnay/platform/frontend/public/logos/deped.svg"
).toString("base64");
const ecairB64 = readFileSync(
  "/workspace/innovation-projects/project_ugnay/platform/frontend/public/logos/ecair.png"
).toString("base64");

const depedSrc = `data:image/svg+xml;base64,${depedB64}`;
const ecairSrc = `data:image/png;base64,${ecairB64}`;

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:1200px; height:630px; overflow:hidden; }
  body {
    background: linear-gradient(135deg, #1e293b 0%, #1e293b 55%, #1e3a5f 100%);
    display: flex;
    align-items: stretch;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  /* left content column */
  .col {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 60px 72px;
  }
  /* agency logo pill */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    background: white;
    border-radius: 14px;
    padding: 10px 18px;
    margin-bottom: 40px;
    width: fit-content;
  }
  .pill img.deped { height: 44px; width: auto; }
  .pill .sep      { width: 1px; height: 30px; background: #d1d5db; flex-shrink: 0; }
  .pill img.ecair { height: 44px; width: auto; }

  h1 {
    font-size: 88px;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: -3px;
    line-height: 1;
    margin-bottom: 14px;
  }
  .sub {
    font-size: 26px;
    font-weight: 500;
    color: rgba(147,197,253,0.65);
    margin-bottom: 30px;
  }
  .tagline {
    font-size: 21px;
    color: rgba(219,234,254,0.80);
    line-height: 1.55;
    max-width: 620px;
  }
  .tagline strong { color: #ffffff; font-weight: 600; }
  .domain {
    margin-top: 40px;
    font-size: 17px;
    color: rgba(147,197,253,0.45);
    letter-spacing: 0.04em;
  }

  /* right accent strip — map-pin motif made of circles */
  .strip {
    width: 260px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
  }
  .dot {
    position: absolute;
    border-radius: 50%;
    opacity: 0.12;
    background: #60a5fa;
  }
  /* scatter of translucent dots to suggest a map */
  .d1  { width:220px; height:220px; top: 30px;  right:-60px; }
  .d2  { width:140px; height:140px; top:120px;  right: 60px; background:#a78bfa; }
  .d3  { width: 90px; height: 90px; top:280px;  right: 20px; }
  .d4  { width:160px; height:160px; top:380px;  right:-40px; background:#34d399; }
  .d5  { width: 60px; height: 60px; top:200px;  right:150px; background:#f472b6; }
  .d6  { width:100px; height:100px; top:480px;  right:100px; background:#fbbf24; }
</style>
</head>
<body>
  <div class="col">
    <div class="pill">
      <img class="deped" src="${depedSrc}" alt="Department of Education"/>
      <div class="sep"></div>
      <img class="ecair" src="${ecairSrc}" alt="Education Center for AI Research"/>
    </div>
    <h1>Ugnay</h1>
    <div class="sub">Education Institutions Map</div>
    <div class="tagline">
      See where a learner can keep going —<br/>
      and <strong>where the next step isn't there.</strong>
    </div>
    <div class="domain">ugnay.cair.ph</div>
  </div>
  <div class="strip">
    <div class="dot d1"></div>
    <div class="dot d2"></div>
    <div class="dot d3"></div>
    <div class="dot d4"></div>
    <div class="dot d5"></div>
    <div class="dot d6"></div>
  </div>
</body>
</html>`;

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});
const page = await browser.newPage();
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(html, { waitUntil: "networkidle" });
const buf = await page.screenshot({ type: "png" });
await browser.close();

writeFileSync(OUT, buf);
console.log(`Written ${buf.length} bytes → ${OUT}`);
