// Accessibility statistics for the selected institution — what the detail drawer draws.
//
// All distances are ROUTED ROAD KILOMETRES (OSRM), precomputed in the pipeline. Nothing
// here measures anything; it reads the two tables the tiles carry.
//
// The "pathway ladder" is where a SUBTLE progression intuition lives: rungs are the
// education levels in order, the institution's own rung is marked "you are here", and the
// rung immediately above is flagged as the next step. We count and mark; we never render
// a verdict or a progression edge. The planner draws the conclusion.
//
// Two different scopes, on purpose:
//   counts / sectors — only what is LOADED and VISIBLE, so the numbers always match the
//                      edges actually drawn on the map.
//   nearest          — nationwide and unbounded, so "the nearest HEI is 28 km away" is
//                      true regardless of which tiles happen to be open.

import { fillKey, gapStatus, requirementsOf, tokensOf } from "./graph";

// Bottom → top. TESDA's two roles are separate rungs so that a training provider's real
// next step (an assessment center) is visible, which is also what its halo means.
export const LEVELS = [
  { key: "es", label: "Elementary" },
  { key: "jhs", label: "Junior High" },
  { key: "shs", label: "Senior High" },
  { key: "hei", label: "Higher Ed" },
  { key: "tesda_training", label: "TESDA Training" },
  { key: "tesda_assessment", label: "TESDA Assessment" },
];

const LABEL = Object.fromEntries(LEVELS.map((l) => [l.key, l.label]));

// What follows the level(s) this institution already offers.
// SHS branches to BOTH higher-ed and TESDA training — neither alone is "the" next step.
function nextStepsFor(own) {
  if (own.has("tesda_training") && !own.has("tesda_assessment")) return ["tesda_assessment"];
  if (own.has("shs")) return ["hei", "tesda_training"];
  if (own.has("jhs")) return ["shs"];
  if (own.has("es")) return ["jhs"];
  return []; // HEIs and assessment-only centres are terminal
}

function gapMessage(own, nearest, thresholdKm, status) {
  if (!status) return null;
  const unmet = requirementsOf(own).filter(
    (r) => !r.any.some((k) => nearest[k] != null && nearest[k] <= thresholdKm)
  );
  if (!unmet.length) return null;

  const names = unmet.map((r) => r.any.map((k) => LABEL[k]).join(" or ")).join("; ");
  const best = unmet
    .flatMap((r) => r.any.map((k) => nearest[k]))
    .filter((d) => d != null)
    .sort((a, b) => a - b)[0];

  if (status === "red" || best == null) {
    return { tone: "red", text: `No ${names} within reach by road.` };
  }
  return {
    tone: "amber",
    text: `No ${names} within ${thresholdKm} km by road. The nearest is ${best.toFixed(1)} km away.`,
  };
}

export function accessibilityStats(focus, nodes, accessIndex, nearestIndex, thresholdKm) {
  if (!focus) return null;
  const own = tokensOf(focus);

  const counts = {}; // level → how many are reachable within the threshold
  const sectors = {}; // fill key → how many reachable (matches the edges drawn)
  for (const l of LEVELS) counts[l.key] = 0;

  // Walk the precomputed road adjacency, not the node list — same order, same rule and
  // the same threshold cut-off the map uses to draw.
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const adj = accessIndex[focus.node_id] || [];
  const limitM = thresholdKm * 1000;

  for (const [destId, metres] of adj) {
    if (metres > limitM) break; // sorted nearest-first
    const n = byId.get(destId);
    if (!n) continue; // unloaded tile, or hidden by a filter
    let offersNew = false;
    for (const t of tokensOf(n)) {
      if (own.has(t)) continue;
      offersNew = true;
      counts[t] += 1;
    }
    if (offersNew) {
      const k = fillKey(n);
      sectors[k] = (sectors[k] || 0) + 1;
    }
  }

  const nearest = nearestIndex[focus.node_id] || {};
  const status = gapStatus(focus, nearestIndex, thresholdKm);

  return {
    own,
    counts,
    nearest,
    sectors,
    nextSteps: new Set(nextStepsFor(own)),
    maxCount: Math.max(1, ...LEVELS.map((l) => counts[l.key])),
    gap: gapMessage(own, nearest, thresholdKm, status),
    total: Object.values(sectors).reduce((a, b) => a + b, 0),
  };
}
