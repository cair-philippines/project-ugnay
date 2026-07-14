#!/usr/bin/env node
//
// Refuse to ship tiles the frontend cannot read.
//
// Why this exists: the network view was deployed against a GCS bucket that still held
// pre-S7 tiles. `academic_applies` came back `undefined`, which is falsy, so every one of
// the 3,825 institutions on screen was reported "not on this pathway" and the readout showed
// 0 cut · 0 dead-end · 0 complete. It looked like a finished feature. Nothing failed. The
// build was green, the deploy was green, and the product was silently telling planners that
// no school in the country has a broken pathway — the exact opposite of what it is for.
//
// A missing field is the cheap version of this bug. The expensive version is a field that is
// PRESENT and WRONG, which a presence check waves straight through. So this does three
// things, in increasing order of how much they would have hurt:
//
//   1. STRUCTURE — every tile has the required keys; every node has the required fields.
//   2. TYPE + RANGE — the values are the right kind of thing (`min_km` is a number in the
//      set of thresholds S7 computes, not a string, not 7).
//   3. SIGNAL — the verdicts are not degenerate. A pipeline that emitted `applies: false`
//      for every institution, or `min_km: 0` for every one, would satisfy 1 and 2 perfectly
//      and still be worthless. If NOTHING is on a pathway, or NOTHING completes one, that is
//      not a dataset — it is a bug, and it fails here.
//
// Usage:
//     node scripts/check_tile_contract.mjs <tiles-dir>
//     node scripts/check_tile_contract.mjs platform/frontend/dist/tiles

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  REQUIRED_TILE_KEYS,
  REQUIRED_NODE_FIELDS,
  CHAIN_THRESHOLDS_KM,
} from "../platform/frontend/src/lib/tileContract.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/check_tile_contract.mjs <tiles-dir>");
  process.exit(2);
}

const NUMERIC = new Set(["lat", "lon", "academic_min_km", "techvoc_min_km"]);
const BOOLEAN = new Set([
  "offers_es",
  "offers_jhs",
  "offers_shs",
  "road_unreliable",
  "academic_applies",
  "techvoc_applies",
]);
const VALID_MIN_KM = new Set([0, ...CHAIN_THRESHOLDS_KM]);

const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
if (!files.length) {
  console.error(`FAIL: no tiles found in ${dir}`);
  process.exit(1);
}

const errors = [];
const push = (msg) => {
  // Cap the noise: 5,000 broken nodes is the same bug reported 5,000 times, and burying the
  // one useful line under it helps nobody.
  if (errors.length < 15) errors.push(msg);
  else if (errors.length === 15) errors.push("… (further errors suppressed)");
};

let nodeCount = 0;
let tileCount = 0;
const applies = { academic: 0, techvoc: 0 };
const completes = { academic: 0, techvoc: 0 };

for (const file of files) {
  if (file === "admin_index.json") continue;
  let tile;
  try {
    tile = JSON.parse(readFileSync(join(dir, file), "utf8"));
  } catch (e) {
    push(`${file}: not valid JSON — ${e.message}`);
    continue;
  }
  tileCount += 1;

  for (const key of REQUIRED_TILE_KEYS) {
    if (!(key in tile)) push(`${file}: missing top-level key "${key}"`);
  }
  if (!Array.isArray(tile.nodes)) {
    push(`${file}: "nodes" is not an array`);
    continue;
  }

  for (const node of tile.nodes) {
    nodeCount += 1;
    for (const f of REQUIRED_NODE_FIELDS) {
      if (!(f in node)) {
        push(`${file}: node ${node.node_id ?? "?"} missing field "${f}"`);
        continue;
      }
      const v = node[f];
      if (NUMERIC.has(f) && typeof v !== "number") {
        push(`${file}: node ${node.node_id} field "${f}" is ${typeof v}, expected number`);
      }
      if (BOOLEAN.has(f) && typeof v !== "boolean") {
        push(`${file}: node ${node.node_id} field "${f}" is ${typeof v}, expected boolean`);
      }
    }
    for (const p of ["academic", "techvoc"]) {
      const min = node[`${p}_min_km`];
      if (typeof min === "number" && !VALID_MIN_KM.has(min)) {
        push(
          `${file}: node ${node.node_id} ${p}_min_km = ${min}, outside the thresholds S7 ` +
            `computes (${[...VALID_MIN_KM].join(", ")}) — S7 and the UI slider have drifted`
        );
      }
      if (node[`${p}_applies`] === true) {
        applies[p] += 1;
        if (typeof min === "number" && min > 0) completes[p] += 1;
      }
    }
  }
}

// --- Signal: are the verdicts degenerate? ---
// Everything above can pass on a dataset that says nothing. These two cannot.
for (const p of ["academic", "techvoc"]) {
  if (nodeCount > 0 && applies[p] === 0) {
    push(
      `NO institution is on the ${p} pathway (${nodeCount.toLocaleString()} nodes checked). ` +
        `That is not a dataset, it is a bug — S7 has not run, or has run wrong.`
    );
  } else if (applies[p] > 0 && completes[p] === 0) {
    push(
      `NO institution completes the ${p} pathway at any threshold ` +
        `(${applies[p].toLocaleString()} are on it). S7's chain walk is almost certainly broken.`
    );
  }
}

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : "0.0");
console.log(`Checked ${tileCount.toLocaleString()} tiles, ${nodeCount.toLocaleString()} nodes`);
for (const p of ["academic", "techvoc"]) {
  console.log(
    `  ${p.padEnd(9)} on pathway: ${applies[p].toLocaleString().padStart(7)}  |  ` +
      `completes it: ${completes[p].toLocaleString().padStart(7)} (${pct(completes[p], applies[p])}%)`
  );
}

if (errors.length) {
  console.error(`\nFAIL — tiles do not satisfy the contract:\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(
    `\nThe frontend reads these fields (platform/frontend/src/lib/tileContract.js).\n` +
      `Re-run scripts/s7_progression_chains.py and scripts/s6_tile_slicer.py, then re-seed\n` +
      `the GCS bucket AND bump the cache key in .github/workflows/deploy.yml — re-seeding\n` +
      `alone will not help, CI caches the pull.\n`
  );
  process.exit(1);
}

console.log("\nOK — tiles satisfy the frontend's contract.");
