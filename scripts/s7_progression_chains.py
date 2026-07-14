#!/usr/bin/env python3
"""
S7 — Progression chains: directed progression edges over ROAD distance, and the
per-institution verdict the network view is built to show — can a learner starting
here actually reach the end of a pathway?

Why this stage exists
---------------------
The map answers a ONE-HOP question: "does this school have a next level nearby?"
That is the gap halo, and it is computed in the browser from the access adjacency.

It is not the whole truth. An institution can have a perfectly good next step and
still be stranded, because the place that next step leads to is itself a dead end.
Nationwide at 5 km there are ~1,600 clusters — ~8,500 institutions — that are richly
connected to each other and contain no higher-ed institution and no assessment centre
anywhere inside them. A learner can go ES → JHS → SHS and then the pathway simply
stops. Every one of those schools looks HEALTHY on the map.

Answering that needs a walk of the whole chain, and the chain does not respect the
area the user happens to have loaded — it can leave the province entirely. So it
cannot be computed in the browser from loaded tiles, and it is computed here, once,
over the national graph. This is the ONLY thing this stage produces that the frontend
could not derive for itself.

The ruleset (resolved with the team, 2026-07-13)
-----------------------------------------------
Two pathways are tracked SEPARATELY. They share a spine and diverge at SHS:

    academic:   ES → JHS → SHS → HEI                      terminal: HEI
    tech-voc:   ES → JHS → SHS → TESDA training → TESDA assessment
                                 TESDA training → TESDA assessment (standalone entry)
                                                        terminal: assessment centre

An SHS that can reach a training centre but no HEI is tech-voc complete and academic
cut. Collapsing those into one verdict would hide which of the two doors is shut, so
we do not collapse them.

  · HEI is TERMINAL. The HEI → TESDA "reskilling" edge is still emitted (it is real
    policy — tertiary students are encouraged into TESDA skills courses) but it is
    flagged `counts_toward_chain = False` and is excluded from both walks. It is an
    overlay, not a pathway; letting it count would mean a chain could "complete" by
    detouring backwards through a university.

  · Self-satisfaction. An institution offering consecutive levels satisfies that step
    INSIDE itself and emits no edge for it: an ES+JHS school needs a JHS→SHS edge, not
    an ES→JHS one. A TESDA site with both roles internalises train→assess. This is why
    outgoing edges leave from an institution's TOP offered level, and it is what makes
    a plain node-level walk correct.

Reads:
  output/nodes/institutions.parquet   (S1)
  output/graph/pairs_access.parquet   (S2b — routed, door-to-door, every pair ≤5 km)

Writes:
  output/graph/progression_road_edges.parquet
  output/graph/chain_reach.parquet
  output/graph/_s7_manifest.json

Note on S3. `s3_progression_edges.py` also emits a progression edge table, but its
cross-sector distances are from the haversine era (pairs_xsector), so its SHS→HEI and
TESDA distances are straight lines. This stage supersedes it for anything user-facing.
S3/S4 are left alone here; the continuity aggregations they feed are still on the old
distances and should be rebuilt separately.

Usage:
    python scripts/s7_progression_chains.py
"""

import argparse
import json
import sys
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR))

OUTPUT_DIR = PROJECT_DIR / "output"
NODES_PATH = OUTPUT_DIR / "nodes" / "institutions.parquet"
GRAPH_DIR = OUTPUT_DIR / "graph"

# The thresholds the UI slider can actually take (FilterPanel: min 1, max 5, step 1).
# A verdict is stored as the SMALLEST of these at which the chain closes, so the
# frontend can answer "complete at the threshold the user is on" with one comparison.
THRESHOLDS = [1, 2, 3, 4, 5]
UNREACHABLE = 0  # sentinel: chain never closes, at any threshold we serve

# Capability tokens. MUST stay in step with tokens_of() in s6_tile_slicer.py and
# tokensOf() in platform/frontend/src/lib/graph.js — three copies of one rule, and a
# progression edge is only as correct as the weakest of them.
def tokens_of(r):
    src = r["source"]
    t = set()
    if src in ("public", "private"):
        if r.get("offers_es"):
            t.add("es")
        if r.get("offers_jhs"):
            t.add("jhs")
        if r.get("offers_shs"):
            t.add("shs")
    elif src == "hei":
        t.add("hei")
    elif src == "tesda":
        if r.get("tesda_role_provider"):
            t.add("tesda_training")
        if r.get("tesda_role_assessment"):
            t.add("tesda_assessment")
    return frozenset(t)


# level a learner holds  →  what they can step into next
NEXT_LEVELS = {
    "es": ["jhs"],
    "jhs": ["shs"],
    "shs": ["hei", "tesda_training"],  # the branch point — tracked separately downstream
    "tesda_training": ["tesda_assessment"],
    "hei": ["tesda_training"],  # reskilling; emitted, but never counts toward a chain
}

TRANSITION = {
    ("es", "jhs"): "ES_JHS",
    ("jhs", "shs"): "JHS_SHS",
    ("shs", "hei"): "SHS_HEI",
    ("shs", "tesda_training"): "SHS_TESDA_TRAINING",
    ("tesda_training", "tesda_assessment"): "TESDA_TRAINING_ASSESS",
    ("hei", "tesda_training"): "HEI_TESDA_TRAINING",
}

RESKILLING = "HEI_TESDA_TRAINING"

# Which transitions each pathway walks, and where it ends. The two share the basic-ed
# spine: an elementary school's tech-voc prospects run through JHS and SHS like anyone
# else's, so ES_JHS and JHS_SHS appear in both.
PATHWAYS = {
    "academic": {
        "terminal_token": "hei",
        "transitions": {"ES_JHS", "JHS_SHS", "SHS_HEI"},
        # tokens whose holder is ON this pathway and not already at its end
        "origin_tokens": {"es", "jhs", "shs"},
    },
    "techvoc": {
        "terminal_token": "tesda_assessment",
        "transitions": {"ES_JHS", "JHS_SHS", "SHS_TESDA_TRAINING", "TESDA_TRAINING_ASSESS"},
        "origin_tokens": {"es", "jhs", "shs", "tesda_training"},
    },
}


def outstanding_steps(own):
    """
    The progression steps this institution CANNOT satisfy inside itself.

    Offering a level whose successor you also offer is a step already taken — an
    integrated ES+JHS school does not need a neighbouring JHS. So a step is
    outstanding only when the institution holds the level and lacks every level it
    could step into. Yields (from_level, to_level) pairs.
    """
    for lvl, nxts in NEXT_LEVELS.items():
        if lvl not in own:
            continue
        if any(n in own for n in nxts):
            continue  # satisfied internally
        for nxt in nxts:
            yield lvl, nxt


def build_edges(nodes, access):
    """
    Progression edges = the access pairs whose destination offers a level the origin
    needs NEXT.

    This is a strict subset of the access adjacency (a needed next level is by
    definition a token the origin lacks), which is why the frontend can derive the
    same edges from the tiles it already has. We build them here anyway because the
    chain walk below needs them, and because the edge table is a useful artefact in
    its own right.
    """
    tok = {r["node_id"]: tokens_of(r) for r in nodes.to_dict(orient="records")}

    # Precompute each origin's outstanding steps once — 66k nodes, reused 2.1M times.
    steps = {nid: tuple(outstanding_steps(own)) for nid, own in tok.items()}

    origins, dests, transitions, kms, counts = [], [], [], [], []
    for o, d, km in zip(access["origin_id"].values,
                        access["dest_id"].values,
                        access["road_km"].values):
        d_tok = tok.get(d)
        if not d_tok:
            continue
        for lvl, nxt in steps.get(o, ()):
            if nxt in d_tok:
                t = TRANSITION[(lvl, nxt)]
                origins.append(o)
                dests.append(d)
                transitions.append(t)
                kms.append(km)
                counts.append(t != RESKILLING)

    return pd.DataFrame({
        "origin_id": origins,
        "dest_id": dests,
        "transition": pd.Categorical(transitions),
        "road_km": kms,
        "counts_toward_chain": counts,
    })


def chain_reach(nodes, edges, pathway):
    """
    For one pathway: the smallest threshold at which each institution can reach the
    pathway's terminal, walking progression edges. UNREACHABLE if it never can.

    Implemented as a reverse BFS from the terminals — one sweep marks every node that
    can reach ANY terminal, which is what "complete" means. Walking forward from each
    of 66k origins instead would be 66k searches for the same answer.

    Thresholds are walked smallest-first and a node's answer is recorded the first time
    it is reached, so the value is the minimum by construction.
    """
    spec = PATHWAYS[pathway]
    tok = {r["node_id"]: tokens_of(r) for r in nodes.to_dict(orient="records")}

    # Only this pathway's transitions, and never the reskilling overlay.
    e = edges[edges["transition"].isin(spec["transitions"]) & edges["counts_toward_chain"]]

    terminals = [n for n, t in tok.items() if spec["terminal_token"] in t]
    # An institution is JUDGED on this pathway only if it holds one of the pathway's
    # non-terminal levels. A pure assessment centre has no academic verdict; an HEI has
    # no tech-voc one (reskilling doesn't count). Those are N/A, not failures — the
    # frontend must not paint them as gaps.
    applies = {n: bool(t & spec["origin_tokens"]) for n, t in tok.items()}

    reached = {n: UNREACHABLE for n in tok}
    for n in terminals:
        reached[n] = 1  # a terminal trivially "reaches" itself, at any threshold

    for th in THRESHOLDS:
        rev = defaultdict(list)
        sub = e[e["road_km"] <= th]
        for o, d in zip(sub["origin_id"].values, sub["dest_id"].values):
            rev[d].append(o)

        # Seed with everything already known to reach a terminal at this threshold.
        # (Nodes settled at a SMALLER threshold still reach it here — the edge set only
        # grows — so re-seeding them is correct and lets shorter chains extend.)
        frontier = deque(n for n, v in reached.items() if v != UNREACHABLE)
        seen = set(frontier)
        while frontier:
            x = frontier.popleft()
            for y in rev.get(x, ()):
                if y in seen:
                    continue
                seen.add(y)
                if reached[y] == UNREACHABLE:
                    reached[y] = th
                frontier.append(y)

    return pd.DataFrame({
        "node_id": list(tok),
        f"{pathway}_applies": [applies[n] for n in tok],
        f"{pathway}_min_km": [reached[n] for n in tok],
    })


def main():
    ap = argparse.ArgumentParser(
        description="S7: road-based progression edges + chain completeness")
    ap.add_argument("--nodes-path", type=Path, default=NODES_PATH)
    ap.add_argument("--graph-dir", type=Path, default=GRAPH_DIR)
    args = ap.parse_args()

    args.graph_dir.mkdir(parents=True, exist_ok=True)

    print("=== S7: Progression chains ===\n")
    t_total = time.time()

    print("Loading inputs…")
    nodes = pd.read_parquet(args.nodes_path)
    access = pd.read_parquet(args.graph_dir / "pairs_access.parquet")
    print(f"  institutions: {len(nodes):,}")
    print(f"  access pairs (road ≤5 km, door-to-door): {len(access):,}")

    print("\nBuilding progression edges…")
    edges = build_edges(nodes, access)
    print(f"  progression edges: {len(edges):,}")
    for t, n in edges["transition"].value_counts().items():
        tag = "  (reskilling — excluded from chains)" if t == RESKILLING else ""
        print(f"    {t:<24} {n:>8,}{tag}")

    print("\nWalking chains (reverse BFS from each pathway's terminal)…")
    reach = None
    for pathway in PATHWAYS:
        r = chain_reach(nodes, edges, pathway)
        reach = r if reach is None else reach.merge(r, on="node_id", how="outer")

        applies = r[f"{pathway}_applies"]
        mins = r[f"{pathway}_min_km"]
        judged = int(applies.sum())
        cut = int((applies & (mins == UNREACHABLE)).sum())
        print(f"  {pathway:<9} judged: {judged:>6,}   "
              f"never completes (≤5 km): {cut:>6,} ({cut / judged * 100:.1f}%)")
        for th in THRESHOLDS:
            done = int((applies & (mins != UNREACHABLE) & (mins <= th)).sum())
            print(f"      ≤{th} km: complete {done:>6,} ({done / judged * 100:>4.1f}%)")

    # --- Invariants. A silently wrong chain flag paints a stranded school green. ---
    # The BFS above is INCREMENTAL: it reuses each threshold's result to seed the next,
    # which is only sound because the edge set grows monotonically with the threshold.
    # That is exactly the kind of optimisation that is right until it isn't, so the
    # widest threshold is recomputed from scratch and the two must agree.
    print("\nChecking invariants…")
    for pathway, spec in PATHWAYS.items():
        mins = reach[f"{pathway}_min_km"]
        assert mins.isin([UNREACHABLE] + THRESHOLDS).all(), \
            f"{pathway}: min_km outside the served thresholds"

        e = edges[edges["transition"].isin(spec["transitions"]) & edges["counts_toward_chain"]]
        e = e[e["road_km"] <= max(THRESHOLDS)]
        rev = defaultdict(list)
        for o, d in zip(e["origin_id"].values, e["dest_id"].values):
            rev[d].append(o)
        tok = {r["node_id"]: tokens_of(r) for r in nodes.to_dict(orient="records")}
        seen = {n for n, t in tok.items() if spec["terminal_token"] in t}
        q = deque(seen)
        while q:
            x = q.popleft()
            for y in rev.get(x, ()):
                if y not in seen:
                    seen.add(y)
                    q.append(y)
        incremental = set(reach.loc[mins != UNREACHABLE, "node_id"])
        assert incremental == seen, (
            f"{pathway}: incremental chain walk disagrees with a from-scratch walk at "
            f"{max(THRESHOLDS)} km — {len(incremental ^ seen):,} nodes differ"
        )
        print(f"  {pathway:<9} from-scratch walk agrees ({len(seen):,} nodes reach a terminal)")

    edges_path = args.graph_dir / "progression_road_edges.parquet"
    reach_path = args.graph_dir / "chain_reach.parquet"
    edges.to_parquet(edges_path, index=False)
    reach.to_parquet(reach_path, index=False)
    print(f"\nWrote {edges_path}  ({len(edges):,} rows)")
    print(f"Wrote {reach_path}  ({len(reach):,} rows)")

    elapsed = time.time() - t_total
    manifest = {
        "stage": "S7",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "distance_source": "pairs_access.parquet (S2b — OSRM door-to-door road distance)",
        "thresholds_km": THRESHOLDS,
        "pathways": {
            p: {
                "terminal": PATHWAYS[p]["terminal_token"],
                "transitions": sorted(PATHWAYS[p]["transitions"]),
            }
            for p in PATHWAYS
        },
        "hei_is_terminal": True,
        "reskilling_edge": f"{RESKILLING} is emitted but counts_toward_chain=False "
                           "(overlay only — never completes a pathway)",
        "self_satisfaction": "an institution offering consecutive levels satisfies that "
                             "step internally and emits no edge for it",
        "min_km_semantics": f"smallest threshold at which the chain closes; "
                            f"{UNREACHABLE} = never, at any threshold served",
        "progression_edges": int(len(edges)),
        "elapsed_s": round(elapsed, 1),
    }
    with open(args.graph_dir / "_s7_manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nTotal time: {elapsed:.0f}s")
    print("\n" + "=" * 60)
    print("DONE.")
    print("=" * 60)


if __name__ == "__main__":
    main()
