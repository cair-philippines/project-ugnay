#!/usr/bin/env node
/**
 * COPY LINT — the platform's voice, enforced.
 *
 * Two things this catches, both of which shipped:
 *
 *  1. EM DASHES IN RENDERED TEXT. They are the single most reliable tell that a sentence was
 *     machine-written, and there were sixteen of them across the setup screen, both legends,
 *     the filter panel and the detail drawer. Use a colon, a comma, a period or parentheses.
 *     (A bare "—" standing alone as a "no data" placeholder in a table cell is fine, and is
 *     allowed below.)
 *
 *  2. BRITISH SPELLING. The app could not decide which side of the Atlantic it was on:
 *     "Assessment centre" in lib/graph.js while InstitutionCard said "Assessment center", and
 *     "Colour by sector" sitting directly above "Colorblind-safe palette" IN THE SAME PANEL.
 *     That is a worse credibility tell than the dashes. House style is US English: center,
 *     color, gray, neighbor, enroll.
 *
 * Only RENDERED text is checked — JSX text nodes, and string literals in title / aria-label /
 * placeholder. Code comments are free to say whatever they like; nobody ships a comment.
 *
 * Usage: node scripts/check_copy.mjs [srcDir]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.argv[2] || "platform/frontend/src";

const BRITISH = /\b(colour|colours|coloured|colouring|centre|centres|grey|greyscale|neighbour|neighbours|enrol|enrols|enrolment|behaviour|favour|labour|organis\w+|analyse|analysed|recognise)\b/gi;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if ([".jsx", ".js"].includes(extname(p))) out.push(p);
  }
  return out;
}

// Strip every kind of comment, so the rules apply to what a USER can read and nothing else.
function stripComments(src) {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "") // {/* JSX comment */}
    .replace(/\/\*[\s\S]*?\*\//g, "") // /* block */
    .replace(/^\s*\/\/.*$/gm, "") // // whole-line
    .replace(/([^:"'`\\])\/\/[^"'`\n]*$/gm, "$1"); // trailing //
}

// The user-visible strings on one line: JSX text nodes plus a few attributes.
function renderedText(line) {
  const parts = [];
  for (const m of line.matchAll(/>([^<>{}]*[A-Za-z]{2}[^<>{}]*)</g)) parts.push(m[1]);
  for (const m of line.matchAll(/(?:title|aria-label|placeholder|label)=\{?["`]([^"`]+)["`]/g)) {
    parts.push(m[1]);
  }
  for (const m of line.matchAll(/(?:text|label):\s*["`]([^"`]+)["`]/g)) parts.push(m[1]);
  for (const m of line.matchAll(/["`]([A-Z][^"`\n]{10,})["`]/g)) parts.push(m[1]);
  return parts.join(" ");
}

const problems = [];
for (const file of walk(ROOT)) {
  const lines = stripComments(readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, i) => {
    const txt = renderedText(line);
    if (!txt.trim()) return;

    // A lone em dash is a legitimate "no data" glyph (`{d == null ? "—" : …}`).
    const emDashInProse = /—/.test(txt) && !/^\s*—\s*$/.test(txt.trim());
    if (emDashInProse) {
      problems.push({
        file, line: i + 1, rule: "em-dash",
        detail: txt.trim().slice(0, 78),
      });
    }
    for (const m of txt.matchAll(BRITISH)) {
      problems.push({
        file, line: i + 1, rule: "en-GB",
        detail: `“${m[0]}” — house style is US English`,
      });
    }
  });
}

if (!problems.length) {
  console.log("copy lint: clean (no em dashes, no British spelling in rendered text)");
  process.exit(0);
}

console.error(`copy lint: ${problems.length} problem(s)\n`);
for (const p of problems.slice(0, 40)) {
  console.error(`  ${p.rule.padEnd(8)} ${p.file}:${p.line}\n           ${p.detail}`);
}
if (problems.length > 40) console.error(`\n  …and ${problems.length - 40} more`);
console.error(
  "\nEm dashes read as machine-written: use a colon, comma, period or parentheses.\n" +
    "House style is US English (center, color, gray, neighbor, enroll)."
);
process.exit(1);
