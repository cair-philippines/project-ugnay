// Per-sector node shapes, as signed-distance-field (SDF) icons.
//
// Why SDF and not plain sprites: an SDF image is a single grayscale mask that MapLibre
// recolors at draw time via `icon-color`, and scales crisply to any `icon-size`. So we
// generate ONE image per shape (not one per shape×color), and the existing colour
// expression — the same `match` on the `fill` property the circle layers used — keeps
// working untouched, including live colour edits and the colorblind palette.
//
// Encoding (MapLibre's, inherited from TinySDF): the alpha channel stores the signed
// distance, remapped so the shape's EDGE lands at alpha ≈ 0.75 — which is exactly the
// cutoff MapLibre's SDF shader tests against:
//
//     alpha = 255 - 255 * (d / SPREAD + CUTOFF)        d > 0 outside, < 0 inside
//
// Get SPREAD/CUTOFF wrong and the shapes come out bloated, eroded, or fuzzy rather than
// simply wrong-looking, so they're pinned here rather than tuned by eye.

const SPREAD = 8; // distance ramp, in px — MapLibre's SDF_PX
const CUTOFF = 0.25; // ⇒ edge at alpha 0.75
const SIZE = 40; // icon bitmap, px (square)
const C = SIZE / 2;

// Half-extents tuned so the four shapes read as the SAME visual weight. Equal *area*,
// not equal width: a same-width triangle looks far smaller than a circle, and a diamond
// looks bigger. Each also stays ≥ 6px from the bitmap edge — the distance ramp reaches
// zero at 6px (see `buildSDF`), so a smaller margin would clip the field and break the
// outline.
const R_CIRCLE = 10;
const B_SQUARE = 8.5; // half-side
const A_DIAMOND = 11.5; // L1 radius (vertex distance on the axes)
const R_TRIANGLE = 12; // circumradius, apex up

// ---------------------------------------------------------------- halo sizing
//
// THE BITMAP SIZE IS NOT FREE — it sets how thick a halo you are allowed to ask for.
//
// MapLibre's SDF shader derives the halo's cutoff as
//     buff = (6 - icon-halo-width / iconSize) / SDF_PX
// where `iconSize` is our `icon-size` (a scale factor, not pixels). If
// `icon-halo-width / iconSize` exceeds 6, **buff goes negative and the shader paints the
// ENTIRE icon quad** with the halo colour — every node grows a translucent white SQUARE.
// It is invisible on the light basemap and glaring on satellite.
//
// That is exactly what happened with a 64px bitmap: `icon-size` was `nodeSize/20`, so at
// the slider's small end (nodeSize 3.25 → iconSize 0.1625) a 1px halo asked for
// 1/0.1625 = 6.15 > 6.
//
// Two changes make it structurally impossible rather than merely unlikely:
//   1. A 40px bitmap (R_CIRCLE = 10) ⇒ icon-size = nodeSize/10, doubling the headroom.
//   2. Halo widths are PROPORTIONAL to node size, so `haloWidth / iconSize` is a CONSTANT
//      ratio — independent of the slider — and stays comfortably under 6 at every size.
const HALO_RATIO = 2.5; // resting outline  → buff = (6 - 2.5)/8 = 0.44
const HALO_RATIO_SELECTED = 3.0; // pinned ring → buff = (6 - 3.0)/8 = 0.38

/** Resting white outline, in screen px. 1px at the default node size of 4. */
export const haloWidthFor = (nodeSize) => (HALO_RATIO * nodeSize) / R_CIRCLE;

/** The pinned node's dark ring. Scaled off its own (larger) icon size. */
export const haloWidthSelectedFor = (selectedSize) =>
  (HALO_RATIO_SELECTED * selectedSize) / R_CIRCLE;

export const NODE_SHAPES = ["circle", "square", "triangle", "diamond"];
export const SHAPE_LABEL = {
  circle: "Circle",
  square: "Square",
  triangle: "Triangle",
  diamond: "Diamond",
};
export const shapeImageId = (shape) => `ugnay-shape-${shape}`;

// ---------------------------------------------------------------- distance fields
// All return SIGNED distance in px: negative inside the shape, positive outside.

const sdCircle = (x, y) => Math.hypot(x - C, y - C) - R_CIRCLE;

function sdSquare(x, y) {
  const qx = Math.abs(x - C) - B_SQUARE;
  const qy = Math.abs(y - C) - B_SQUARE;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside;
}

// |dx| + |dy| = A is a diamond; dividing by √2 converts the L1 value into true
// Euclidean distance (the edges run at 45°).
const sdDiamond = (x, y) => (Math.abs(x - C) + Math.abs(y - C) - A_DIAMOND) / Math.SQRT2;

// Exact polygon SDF: unsigned distance to the nearest edge, signed by an inside test.
// (The cheaper max-of-half-planes trick is exact inside but rounds off the corners
// outside — visible on a triangle at these sizes.)
function sdPolygon(x, y, pts) {
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const ex = xj - xi;
    const ey = yj - yi;
    const wx = x - xi;
    const wy = y - yi;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, Math.hypot(wx - ex * t, wy - ey * t));
    // ray-crossing parity test
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? -best : best;
}

const TRIANGLE_PTS = [-90, 30, 150].map((deg) => {
  const r = (deg * Math.PI) / 180;
  // Nudge down slightly so the centroid — not the circumcentre — sits at the icon's
  // middle; otherwise a triangle pin looks like it's floating above its own coordinate.
  return [C + R_TRIANGLE * Math.cos(r), C + R_TRIANGLE * Math.sin(r) + 1.5];
});

const FIELD = {
  circle: sdCircle,
  square: sdSquare,
  diamond: sdDiamond,
  triangle: (x, y) => sdPolygon(x, y, TRIANGLE_PTS),
};

// ---------------------------------------------------------------- image building

function buildSDF(shape) {
  const sd = FIELD[shape];
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Sample at the pixel CENTRE, else every shape sits a half-pixel up and left.
      const d = sd(x + 0.5, y + 0.5);
      const a = Math.round(255 - 255 * (d / SPREAD + CUTOFF));
      const i = (y * SIZE + x) * 4;
      data[i] = 255; // RGB is ignored for SDF icons — `icon-color` supplies the colour;
      data[i + 1] = 255; // white keeps the image sane if it's ever drawn non-SDF.
      data[i + 2] = 255;
      data[i + 3] = a < 0 ? 0 : a > 255 ? 255 : a;
    }
  }
  return { width: SIZE, height: SIZE, data };
}

/**
 * (Re)register every shape image on a map. Idempotent, and safe to call again after a
 * basemap switch — `setStyle` drops all images the app added, so the shapes silently
 * vanish unless they're re-added on every `style.load`.
 */
export function addShapeImages(map) {
  for (const shape of NODE_SHAPES) {
    const id = shapeImageId(shape);
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, buildSDF(shape), { sdf: true, pixelRatio: 1 });
  }
}

// A shape's drawn diameter in the bitmap is ~2 × R_CIRCLE, so this converts the user's
// node-size slider (a RADIUS in px, as it was for the circle layers) into `icon-size`.
export const iconSizeFor = (nodeSize) => nodeSize / R_CIRCLE;
