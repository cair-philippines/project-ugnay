// Graph helpers for the map.
//
// EVERY DISTANCE HERE IS ROUTED ROAD DISTANCE (OSRM), precomputed by scripts/
// s2b_access_distances.py and baked into the tiles. Nothing is measured in the browser
// any more. The old client-side haversine flattered reality — it ignored rivers,
// coastlines and the fact that roads bend — and it cut both ways: of all pairs within
// 5 km straight-line, only 54.5% are still within 5 km once you have to drive it. The
// median detour is 1.37x.
//
// TWO distinct ideas live here — keep them straight (see frontend_design.md §5):
//
//  1. ACCESSIBILITY EDGES (what we DRAW), from `tile.access`: origin → [[dest_id,
//     metres], …], sorted nearest-first, already filtered to destinations offering a
//     capability the origin lacks (the "token rule" now lives in the pipeline). We draw
//     an edge only to a destination that is actually loaded and visible — the same rule
//     as when the browser computed these itself.
//
//  2. PROGRESSION GAPS (what we HALO), from `tile.nearest`: node → {level: road km to
//     the nearest institution offering it}. Unbounded and nationwide, so a halo is a
//     property of the institution and not of whichever tiles you happen to have open.
//     Progression is otherwise deprioritised to post-demo; this is the one place it
//     still surfaces.

// A gap is "amber" (an option exists, just too far) up to this distance, and "red"
// (nothing at all in reach) beyond it. Matches the 5 km cap of the accessibility slider.
export const MAX_BAND_KM = 5;

// ---------------------------------------------------------------- node identity

// Which fill bucket a node paints with. HEI is split into public/private because
// planners care where public vs private higher-ed sits.
export function fillKey(n) {
  if (n.source === "hei") return n.hei_is_public === true ? "hei_public" : "hei_private";
  if (n.source === "tesda") return "tesda";
  return n.source === "private" ? "private" : "public";
}

export const SECTOR_LABEL = {
  public: "DepEd Public",
  private: "DepEd Private",
  hei_public: "Higher Ed — Public",
  hei_private: "Higher Ed — Private",
  tesda: "TESDA",
};

// The same five buckets, grouped the way a planner talks about them. The network view's
// colour filter is built from this: a sector header that turns its whole group on, and the
// sub-sector rows beneath it. TESDA has one fill (training and assessment are ROLES, not
// separate fills), so it is a group of one rather than a fake split.
export const SECTOR_GROUPS = [
  { key: "basic", title: "Basic Education", fills: ["public", "private"] },
  { key: "higher", title: "Higher Education", fills: ["hei_public", "hei_private"] },
  { key: "techvoc", title: "Technical–Vocational", fills: ["tesda"] },
];

export const ALL_FILL_KEYS = SECTOR_GROUPS.flatMap((g) => g.fills);

// What an institution offers, as capability tokens. Two institutions are "the same"
// only if their token sets match; an edge is drawn when a neighbour offers a token the
// selected institution lacks.
export function tokensOf(n) {
  const t = new Set();
  if (n.source === "public" || n.source === "private") {
    if (n.offers_es) t.add("es");
    if (n.offers_jhs) t.add("jhs");
    if (n.offers_shs) t.add("shs");
  } else if (n.source === "hei") {
    t.add("hei");
  } else if (n.source === "tesda") {
    if (n.tesda_role_provider) t.add("tesda_training");
    if (n.tesda_role_assessment) t.add("tesda_assessment");
  }
  return t;
}

// NOTE: the "does this neighbour offer something new?" test used to live here. It now
// runs in the pipeline (s6_tile_slicer.tokens_of), which filters `tile.access` before it
// ships — so the two definitions must be kept in step.

// ---------------------------------------------------------------- visibility & emphasis

// A node renders when its sector layer is on AND it offers ≥1 enabled subcategory.
export function nodeVisible(n, activeSectors, subcats) {
  const s = n.source;
  if (s === "public" || s === "private") {
    if (!activeSectors.has("basic")) return false;
    const sc = subcats.basic;
    return (
      (n.offers_es && sc.has("es")) ||
      (n.offers_jhs && sc.has("jhs")) ||
      (n.offers_shs && sc.has("shs"))
    );
  }
  if (s === "hei") {
    if (!activeSectors.has("higher")) return false;
    const sc = subcats.higher;
    return n.hei_is_public === true ? sc.has("public") : sc.has("private");
  }
  if (s === "tesda") {
    if (!activeSectors.has("techvoc")) return false;
    const sc = subcats.techvoc;
    return (
      (n.tesda_role_provider && sc.has("training")) ||
      (n.tesda_role_assessment && sc.has("assessment"))
    );
  }
  return false;
}

// De-emphasis (alpha), as distinct from hiding. A node fades only when EVERY subcategory
// it actually offers has been dimmed — otherwise a school offering both a dimmed and an
// un-dimmed level would vanish from view when the user only meant to push one level back.
export function nodeDimmed(n, subcats, dimmed) {
  const s = n.source;
  const anyBright = (pairs, dimSet, subSet) =>
    pairs.some(([has, key]) => has && subSet.has(key) && !dimSet.has(key));

  if (s === "public" || s === "private") {
    return !anyBright(
      [
        [n.offers_es, "es"],
        [n.offers_jhs, "jhs"],
        [n.offers_shs, "shs"],
      ],
      dimmed.basic,
      subcats.basic
    );
  }
  if (s === "hei") {
    const key = n.hei_is_public === true ? "public" : "private";
    return !anyBright([[true, key]], dimmed.higher, subcats.higher);
  }
  if (s === "tesda") {
    return !anyBright(
      [
        [n.tesda_role_provider, "training"],
        [n.tesda_role_assessment, "assessment"],
      ],
      dimmed.techvoc,
      subcats.techvoc
    );
  }
  return false;
}

// Visible nodes + the place each one sits in (from its tile's meta).
export function collectNodes(tiles, activeSectors, subcats) {
  const nodes = [];
  const places = {};
  const seen = new Set();
  for (const tile of Object.values(tiles)) {
    const place = tile.meta || {};
    for (const n of tile.nodes || []) {
      if (seen.has(n.node_id) || n.lat == null || n.lon == null) continue;
      seen.add(n.node_id);
      places[n.node_id] = place;
      if (nodeVisible(n, activeSectors, subcats)) nodes.push(n);
    }
  }
  return { nodes, places };
}

// ---------------------------------------------------------------- tile indices

// origin node_id → [[dest_id, metres], …], nearest first. Road distance, ≤ 5 km,
// token rule already applied by the pipeline.
export function buildAccessIndex(tiles) {
  const out = {};
  for (const t of Object.values(tiles)) Object.assign(out, t.access || {});
  return out;
}

// node_id → {level: road km to the nearest institution offering it}. Unbounded and
// nationwide — it does not depend on which tiles are loaded.
export function buildNearestIndex(tiles) {
  const out = {};
  for (const t of Object.values(tiles)) Object.assign(out, t.nearest || {});
  return out;
}

// ---------------------------------------------------------------- accessibility edges

// Everything reachable from `focus` within `thresholdKm` BY ROAD that offers something
// it lacks. A straight line is still what we DRAW — we have the routed length, not the
// routed geometry — so the line is a connection, not a path. See the legend caveat.
export function accessibilityEdges(focus, visibleNodes, thresholdKm, accessIndex) {
  if (!focus) return { fc: { type: "FeatureCollection", features: [] }, connectedIds: [] };

  const byId = new Map(visibleNodes.map((n) => [n.node_id, n]));
  const adj = accessIndex[focus.node_id] || [];
  const limitM = thresholdKm * 1000;

  const features = [];
  const connectedIds = [];
  for (const [destId, metres] of adj) {
    if (metres > limitM) break; // sorted nearest-first, so nothing further can qualify
    const n = byId.get(destId);
    if (!n) continue; // in another (unloaded) tile, or hidden by a filter
    features.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [focus.lon, focus.lat],
          [n.lon, n.lat],
        ],
      },
      properties: { distance_km: metres / 1000, dest_fill: fillKey(n) },
    });
    connectedIds.push(destId);
  }
  return { fc: { type: "FeatureCollection", features }, connectedIds };
}

// ---------------------------------------------------------------- progression gaps

// What must this institution be able to reach?
//  ES → a JHS · JHS → an SHS · SHS → an HEI *or* a TESDA training provider
//  TESDA training provider → an assessment center
// Terminal (never flagged): HEIs, and assessment-only TESDA centres.
// A school that offers the next level ITSELF satisfies the requirement internally —
// which falls out for free, since `nearest` only ever holds levels a node lacks.
export function requirementsOf(own) {
  const reqs = [];
  if (own.has("es")) reqs.push({ label: "Junior High", any: ["jhs"] });
  if (own.has("jhs")) reqs.push({ label: "Senior High", any: ["shs"] });
  if (own.has("shs")) reqs.push({ label: "Higher Ed or TESDA", any: ["hei", "tesda_training"] });
  if (own.has("tesda_training")) reqs.push({ label: "Assessment centre", any: ["tesda_assessment"] });
  return reqs.filter((r) => !r.any.some((t) => own.has(t))); // satisfied in-house → no gap
}

// "" = fine/terminal · "amber" = an option exists, but only beyond the threshold
// · "red" = nothing within MAX_BAND_KM by road (a structural dead end).
//
// Driven by the nationwide `nearest` table, so a halo means the same thing regardless of
// what the user has loaded — and it is now measured in road kilometres, like everything
// else. (It used to read the progression-edge table, whose cross-sector distances were
// still haversine.)
export function gapStatus(n, nearestIndex, thresholdKm) {
  // A node plotted off the road network (usually a broken coordinate — some sit in open
  // sea) has meaningless routed distances, so it would always read as a red "no next
  // level in reach" gap. Suppress it: that is a data error, not an accessibility gap.
  if (n.road_unreliable) return "";
  const reqs = requirementsOf(tokensOf(n));
  if (!reqs.length) return "";
  const near = nearestIndex[n.node_id] || {};

  let worst = "";
  for (const req of reqs) {
    const best = Math.min(...req.any.map((t) => (near[t] == null ? Infinity : near[t])));
    if (best <= thresholdKm) continue; // reachable → no gap
    if (best <= MAX_BAND_KM) worst = worst === "red" ? "red" : "amber";
    else worst = "red";
  }
  return worst;
}
