// THE TILE CONTRACT — the fields the frontend requires of every tile the pipeline ships.
//
// This file exists because of a real failure. The network view was deployed while the GCS
// bucket still held pre-S7 tiles. `academic_applies` came back `undefined`, which is falsy,
// so all 3,825 institutions in view were quietly reported "not on this pathway" and the
// readout showed 0 cut · 0 dead-end · 0 complete. The page looked finished. It was a graph
// with no data in it, and nothing — not the build, not the deploy, not the browser — said so.
//
// The lesson is not "remember to upload the tiles". It is that the contract between the
// pipeline and the frontend was never written down, so nothing could check it. It is written
// down here, once, and both sides read it:
//
//   · the frontend  (lib/progression.js — to detect stale tiles at runtime)
//   · CI            (scripts/check_tile_contract.mjs — to refuse to deploy them at all)
//
// Adding a field the frontend depends on? Add it here. CI will then fail on any tile that
// lacks it, which is the whole point.

// Top-level keys every tile must carry.
export const REQUIRED_TILE_KEYS = ["meta", "nodes"];

// Fields every NODE must carry. Presence is what is checked, not truthiness — `min_km: 0`
// is a meaningful value ("the chain never closes"), not a missing one.
export const REQUIRED_NODE_FIELDS = [
  "node_id",
  "name",
  "source",
  "lat",
  "lon",
  "offers_es",
  "offers_jhs",
  "offers_shs",
  // S2b: institution sits >2 km from any mapped road, so its routed distances are junk.
  "road_unreliable",
  // S7: the chain verdicts. THESE are the ones that went missing.
  ...["academic", "techvoc"].flatMap((p) => [`${p}_applies`, `${p}_min_km`]),
];

// The S7 subset, called out on its own: `lib/progression.js` uses it to tell "this tile
// predates the progression stage" apart from "this institution is not on the pathway".
export const S7_NODE_FIELDS = [
  "academic_applies",
  "academic_min_km",
  "techvoc_applies",
  "techvoc_min_km",
];

// The thresholds S7 computes a verdict for; `min_km` must be one of these, or 0 for "never".
// A value outside this set means S7 and the UI slider have drifted apart.
export const CHAIN_THRESHOLDS_KM = [1, 2, 3, 4, 5];
