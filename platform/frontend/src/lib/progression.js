// The PROGRESSION graph — the network view's model. Distinct from the map's model, and
// the difference is the whole point of the second view.
//
// The map asks a ONE-HOP question: "is there a next level nearby?" That question flatters
// reality. Adams Central Elementary has a junior high 0.76 km away, so the map's halo calls
// it healthy — but its nearest university is 63 km away and its nearest TESDA centre 44 km,
// so a learner starting there cannot finish ANY pathway. Nationwide, ~19,900 institutions
// look fine on the map and can never reach higher ed.
//
// Finding those needs a walk of the whole chain, and a chain can leave the area the user
// has loaded — so it CANNOT be computed here. It is precomputed nationwide by
// scripts/s7_progression_chains.py and arrives on each node as four fields:
//
//   {academic,techvoc}_applies   is this institution even ON that pathway?
//   {academic,techvoc}_min_km    smallest threshold at which its chain closes (0 = never)
//
// THREE SOURCES OF TRUTH, and it matters which answers what:
//   · chain verdict  ← the S7 node fields   (nationwide, exact, tile-independent)
//   · one-hop verdict ← `nearest` index     (nationwide, exact, tile-independent)
//   · drawn edges    ← `access` index       (only among LOADED, VISIBLE nodes — a
//                                            rendering limit, stated in the legend)
// A node near the edge of the loaded area may have neighbours we cannot draw. Its VERDICT
// is still right, because the verdict never consults the drawn edges.

import { tokensOf } from "./graph";

// Mirror of NEXT_LEVELS in scripts/s7_progression_chains.py. The two must agree — a
// progression edge is only as correct as the weakest copy of this rule (there is a third,
// in s6_tile_slicer.tokens_of, for the tokens themselves).
export const NEXT_LEVELS = {
  es: ["jhs"],
  jhs: ["shs"],
  shs: ["hei", "tesda_training"], // the branch point
  tesda_training: ["tesda_assessment"],
  hei: ["tesda_training"], // reskilling — drawn, but never completes a pathway
};

// The two pathways are tracked SEPARATELY, on purpose. An SHS that can reach a training
// centre but no university is tech-voc complete and academic cut; one combined verdict
// would hide WHICH of the two doors is shut. They share the basic-ed spine and diverge at
// SHS, so an elementary school has a verdict on both.
export const PATHWAYS = {
  academic: {
    label: "Academic",
    ends: "higher ed",
    // next-levels that count as progress along THIS pathway
    steps: new Set(["jhs", "shs", "hei"]),
  },
  techvoc: {
    label: "Tech-Voc",
    ends: "an assessment centre",
    steps: new Set(["jhs", "shs", "tesda_training", "tesda_assessment"]),
  },
};

export const RESKILLING = "hei>tesda_training";

// The steps this institution cannot satisfy INSIDE itself.
//
// Offering a level whose successor you also offer is a step already taken: an integrated
// ES+JHS school does not need a neighbouring junior high, it needs a senior high. So
// outgoing edges leave from an institution's TOP offered level, which is what makes a
// plain node-level walk of the graph correct.
export function outstandingSteps(own) {
  const out = [];
  for (const [level, nexts] of Object.entries(NEXT_LEVELS)) {
    if (!own.has(level)) continue;
    if (nexts.some((n) => own.has(n))) continue; // satisfied in-house
    for (const next of nexts) out.push([level, next]);
  }
  return out;
}

// Directed progression edges among the nodes we can actually draw.
//
// Derived from the accessibility adjacency rather than shipped separately: a level you
// NEED next is by definition a level you LACK, so every progression edge is already an
// access edge. The pipeline therefore ships no edge payload for this view at all.
export function progressionEdges(nodes, accessIndex, thresholdKm, pathway) {
  const steps = PATHWAYS[pathway].steps;
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const tokens = new Map(nodes.map((n) => [n.node_id, tokensOf(n)]));
  const limitM = thresholdKm * 1000;

  const edges = [];
  for (const n of nodes) {
    const outstanding = outstandingSteps(tokens.get(n.node_id));
    if (!outstanding.length) continue;
    const adj = accessIndex[n.node_id] || [];

    for (const [destId, metres] of adj) {
      if (metres > limitM) break; // sorted nearest-first
      const dest = byId.get(destId);
      if (!dest) continue; // unloaded tile, or hidden by a filter
      const destTokens = tokens.get(destId);

      for (const [level, next] of outstanding) {
        if (!destTokens.has(next)) continue;
        const key = `${level}>${next}`;
        const reskilling = key === RESKILLING;
        // Reskilling edges are drawn (higher-ed graduates really do take TESDA courses)
        // but they belong to NO pathway, so they never lay track a chain could run on.
        if (!reskilling && !steps.has(next)) continue;
        edges.push({
          source: n.node_id,
          target: destId,
          key,
          km: metres / 1000,
          reskilling,
        });
      }
    }
  }
  return edges;
}

// Does this institution have ANY valid next step along this pathway, within the threshold?
//
// Answered from the NATIONWIDE `nearest` table, not from the edges we drew — otherwise an
// institution at the edge of the loaded area, whose only junior high sits in the next
// province, would be branded "cut" for no reason but the user's tile selection.
function hasNextStep(node, pathway, thresholdKm, nearestIndex) {
  const steps = PATHWAYS[pathway].steps;
  const near = nearestIndex[node.node_id] || {};
  for (const [, next] of outstandingSteps(tokensOf(node))) {
    if (!steps.has(next)) continue;
    const km = near[next];
    if (km != null && km <= thresholdKm) return true;
  }
  return false;
}

// The verdict, in three nested states plus N/A:
//
//   complete  — the chain closes: a learner starting here can reach the end of the pathway
//   deadend   — there IS a next step, but nothing downstream ever reaches the end.
//               THIS IS THE STATE THE MAP CANNOT SEE. It is the reason this view exists.
//   cut       — no next step at all within the threshold
//   na        — not on this pathway (an assessment centre has no academic verdict; an HEI
//               has no tech-voc one). N/A is NOT a failure and must never be painted as one.
export function chainStatus(node, pathway, thresholdKm, nearestIndex) {
  // A tile without the S7 fields is a STALE DATA CONTRACT, not an institution that happens
  // to sit off the pathway — and the two must never be confused. When the network view first
  // shipped, the frontend went out ahead of the tiles: `academic_applies` was `undefined`,
  // which is falsy, so all 3,825 institutions in view were quietly reported "not on this
  // pathway" and the readout showed 0 · 0 · 0. It looked like a finished graph. It was a
  // graph with no data in it. Absence of the field is now a loud, separate state.
  if (node[`${pathway}_applies`] === undefined) return "unknown";
  if (!node[`${pathway}_applies`]) return "na";
  // Plotted off the road network (usually a broken coordinate — several sit in open sea),
  // so its routed distances are meaningless and it would always read as a gap. Same
  // suppression as the map's halos: a data error must not masquerade as an access gap.
  if (node.road_unreliable) return "na";

  const minKm = node[`${pathway}_min_km`] ?? 0;
  if (minKm > 0 && minKm <= thresholdKm) return "complete";
  return hasNextStep(node, pathway, thresholdKm, nearestIndex) ? "deadend" : "cut";
}

// Severity fill. Complete recedes; broken advances — the eye should land on the failures,
// because they are the point of the view.
//
// Shares the map's red/amber severity ramp deliberately: in BOTH views red means "the next
// step is missing" and amber means "the next step is there, but it doesn't get you out".
// The exact wording differs per view, so each legend spells its own out.
// Complete recedes but must not VANISH: the healthy core is the baseline the broken ones
// are read against, and a first pass that faded it to near-nothing turned the connected
// cluster into a grey smudge — you could see that something was there, but not that it was
// the thing working. It sits back; it does not disappear.
export const STATUS_STYLE = {
  complete: { fill: "#94A3B8", label: "Complete", r: 3, alpha: 0.7 },
  deadend: { fill: "#F59E0B", label: "Dead-end chain", r: 4, alpha: 1 },
  cut: { fill: "#DC2626", label: "Cut", r: 4.5, alpha: 1 },
  na: { fill: "#E2E8F0", label: "Not on this pathway", r: 2, alpha: 0.35 },
  unknown: { fill: "#7C3AED", label: "No verdict in this tile", r: 3, alpha: 0.6 },
};

export const STATUS_ORDER = ["na", "complete", "deadend", "cut", "unknown"]; // worst on top

export function statusCounts(nodes, pathway, thresholdKm, nearestIndex) {
  const counts = { complete: 0, deadend: 0, cut: 0, na: 0, unknown: 0 };
  for (const n of nodes) counts[chainStatus(n, pathway, thresholdKm, nearestIndex)] += 1;
  return counts;
}

// Are the tiles we loaded old enough to predate S7? If so the whole view is meaningless and
// must SAY so, rather than drawing an authoritative-looking graph of nothing.
export function tilesArePreS7(nodes) {
  return nodes.length > 0 && nodes.every((n) => n.academic_applies === undefined);
}
