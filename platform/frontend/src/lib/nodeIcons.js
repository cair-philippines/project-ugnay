// Runtime-generated ring-segment icons for institution nodes.
//
// Node visualization grammar (see documentation / SPECS):
//   fill color = sector          (handled by the circle layer)
//   outer arcs = capabilities    (handled by these icons + a symbol layer)
//
// Arcs are NEUTRAL — a darker shade of the sector fill. Only offered
// capabilities are drawn, each in a FIXED slot position, so "which"
// capability is readable by position:
//   basic-ed (public/private):  slots  [ES | JHS | SHS]
//   tech-voc (tesda):           slots  [Provider | Assessment]
//   higher-ed (hei):            no arcs (single capability)
//
// The icon is only the arcs on a transparent field; the sector-colored
// dot beneath (circle layer) shows through the ring's center.

const SECTOR_HEX = {
  public: "#3B82F6",
  private: "#F97316",
  hei: "#10B981",
  tesda: "#A855F7",
};

// Icon geometry (logical px; rendered at 2x for crispness)
const LOGICAL = 30;
const PR = 2;
const CENTER = LOGICAL / 2;
const R_INNER = 8.5;
const R_OUTER = 12.5;

// Fixed slot geometry, degrees. 0° = east, positive = clockwise (canvas y-down),
// so 270° = up (12 o'clock).
const BASIC_GAP = 16;
const BASIC_HALF = 120 / 2 - BASIC_GAP / 2; // half-width of each 120° slot
const BASIC_SLOTS = {
  E: 270, // top
  J: 30, // lower-right
  S: 150, // lower-left
};

const TESDA_GAP = 26;
const TESDA_HALF = 180 / 2 - TESDA_GAP / 2;
const TESDA_SLOTS = {
  P: 180, // left half  (Provider)
  A: 0, // right half (Assessment)
};

function darken(hex, f = 0.55) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

function deg2rad(d) {
  return (d * Math.PI) / 180;
}

function newCanvas() {
  const c = document.createElement("canvas");
  c.width = LOGICAL * PR;
  c.height = LOGICAL * PR;
  const ctx = c.getContext("2d");
  ctx.scale(PR, PR);
  return { c, ctx };
}

function drawArc(ctx, centerDeg, halfDeg, color) {
  const s = deg2rad(centerDeg - halfDeg);
  const e = deg2rad(centerDeg + halfDeg);
  ctx.beginPath();
  ctx.arc(CENTER, CENTER, R_OUTER, s, e, false);
  ctx.arc(CENTER, CENTER, R_INNER, e, s, true);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function imageData(ctx) {
  return ctx.getImageData(0, 0, LOGICAL * PR, LOGICAL * PR);
}

// All non-empty subsets of an ordered slot list, as concatenated keys.
function subsets(letters) {
  const out = [];
  const n = letters.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    let key = "";
    for (let i = 0; i < n; i++) if (mask & (1 << i)) key += letters[i];
    out.push(key);
  }
  return out;
}

// Compute the icon id for a node given its capabilities.
export function computeArcIcon(node) {
  const s = node.source;
  if (s === "public" || s === "private") {
    let c = "";
    if (node.offers_es) c += "E";
    if (node.offers_jhs) c += "J";
    if (node.offers_shs) c += "S";
    return c ? `${s}-${c}` : "arc-none";
  }
  if (s === "tesda") {
    let c = "";
    if (node.tesda_role_provider) c += "P";
    if (node.tesda_role_assessment) c += "A";
    return c ? `tesda-${c}` : "arc-none";
  }
  return "arc-none"; // hei (and any unknown) — single capability, no arcs
}

// Generate and register every arc icon on the given maplibre map.
// Safe to call repeatedly (e.g. after a basemap/style switch) — guarded by hasImage.
export function addNodeIcons(map) {
  // Transparent placeholder for no-arc nodes (hei, or a school with no level flags).
  if (!map.hasImage("arc-none")) {
    const { ctx } = newCanvas();
    map.addImage("arc-none", imageData(ctx), { pixelRatio: PR });
  }

  // Basic-ed: public & private, subsets of [E,J,S] in fixed slots.
  for (const sector of ["public", "private"]) {
    const color = darken(SECTOR_HEX[sector]);
    for (const combo of subsets(["E", "J", "S"])) {
      const id = `${sector}-${combo}`;
      if (map.hasImage(id)) continue;
      const { ctx } = newCanvas();
      for (const letter of combo) drawArc(ctx, BASIC_SLOTS[letter], BASIC_HALF, color);
      map.addImage(id, imageData(ctx), { pixelRatio: PR });
    }
  }

  // Tech-voc: tesda, subsets of [P,A] in fixed slots.
  {
    const color = darken(SECTOR_HEX.tesda);
    for (const combo of subsets(["P", "A"])) {
      const id = `tesda-${combo}`;
      if (map.hasImage(id)) continue;
      const { ctx } = newCanvas();
      for (const letter of combo) drawArc(ctx, TESDA_SLOTS[letter], TESDA_HALF, color);
      map.addImage(id, imageData(ctx), { pixelRatio: PR });
    }
  }
}

export { SECTOR_HEX };
