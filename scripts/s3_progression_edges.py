#!/usr/bin/env python3
"""
S3 — Progression edges: apply relational rules to distance pairs and
produce the base progression edge table for the platform graph.

⚠️ SUPERSEDED (2026-07-13) — DO NOT USE THESE DISTANCES.
--------------------------------------------------------
This stage's cross-sector distances (SHS→HEI, SHS→TESDA, TESDA→TESDA) come from
`pairs_xsector.parquet`, which is from the HAVERSINE era: they are straight lines, not
roads. Only 53% of pairs within 5 km as the crow flies are still within 5 km once you
have to drive it, so these edges systematically overstate what is reachable.

`scripts/s7_progression_chains.py` replaces this for everything user-facing. It builds the
same edges from `pairs_access.parquet` (OSRM, door-to-door) and also walks the chain.

S6 no longer ships this table to the browser — it was 72.6% of every tile's bytes and
nothing read it. This script and S4 still run, but their outputs now feed nothing that a
planner sees. Rebuild them on S2b distances before trusting them again. See SPECS §A6.

Reads:
  output/nodes/institutions.parquet        (S1)
  output/graph/pairs_basic.parquet         (S2)
  output/graph/pairs_xsector.parquet       (S2)
  output/graph/pairs_tesda.parquet         (S2)

Writes:
  output/graph/progression_edges.parquet

Columns:
  origin_id    — composite node_id (pub:/prv:/hei:/tesda:)
  dest_id      — composite node_id (same as origin_id for self-edges)
  transition   — ES_JHS | JHS_SHS | SHS_HEI | SHS_TESDA_prov |
                 HEI_TESDA_prov | TESDA_prov_assess
  distance_km  — float (0.0 for intra-node self-edges)
  family       — qualification family for TESDA_prov_assess edges;
                 null unless --tesda-families (S5 output) is provided
  intra_node   — True for self-edges (integrated schools, TESDA Both sites)

Two operating modes:
  Role-only (default, M3 milestone): TESDA_prov_assess edges have family=None;
    any reachable assessment center satisfies the step.
  Family-matched (M4, after S5): pass --tesda-families to enrich TESDA edges
    with qualification-family filtering.

Usage:
    python scripts/s3_progression_edges.py
    python scripts/s3_progression_edges.py --tesda-families output/nodes/tesda_families.parquet
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR))

OUTPUT_DIR   = PROJECT_DIR / "output"
NODES_PATH   = OUTPUT_DIR / "nodes" / "institutions.parquet"
GRAPH_DIR    = OUTPUT_DIR / "graph"
MAX_BAND_KM  = 5.0   # maximum display band; S6 client filters 1-5 km within this


# ---------------------------------------------------------------------------
# Inter-node edge builders
# ---------------------------------------------------------------------------

def build_basic_edges(pairs_basic, nodes):
    """
    Apply ES→JHS and JHS→SHS rules to basic-ed pairs.

    Both origin and destination must be in the basic-ed node set and offer
    the correct level for each transition.
    """
    basic_attrs = (
        nodes[nodes["source"].isin(["public", "private"])]
        [["node_id", "offers_es", "offers_jhs", "offers_shs"]]
        .copy()
    )

    pairs = pairs_basic[pairs_basic["distance_km"] <= MAX_BAND_KM].copy()

    # Join origin level flags
    pairs = pairs.merge(
        basic_attrs.rename(columns={
            "node_id": "origin_id",
            "offers_es": "o_es", "offers_jhs": "o_jhs", "offers_shs": "o_shs",
        }),
        on="origin_id", how="inner",
    )
    # Join dest level flags
    pairs = pairs.merge(
        basic_attrs.rename(columns={
            "node_id": "dest_id",
            "offers_es": "d_es", "offers_jhs": "d_jhs", "offers_shs": "d_shs",
        }),
        on="dest_id", how="inner",
    )

    frames = []

    es_jhs = pairs[pairs["o_es"] & pairs["d_jhs"]][
        ["origin_id", "dest_id", "distance_km"]
    ].copy()
    es_jhs["transition"] = "ES_JHS"
    frames.append(es_jhs)

    jhs_shs = pairs[pairs["o_jhs"] & pairs["d_shs"]][
        ["origin_id", "dest_id", "distance_km"]
    ].copy()
    jhs_shs["transition"] = "JHS_SHS"
    frames.append(jhs_shs)

    result = pd.concat(frames, ignore_index=True)
    print(f"  ES→JHS:  {(result['transition']=='ES_JHS').sum():,} edges")
    print(f"  JHS→SHS: {(result['transition']=='JHS_SHS').sum():,} edges")
    return result


def build_xsector_edges(pairs_xsector):
    """
    Cross-sector edges (SHS→HEI, SHS→TESDA_prov, HEI→TESDA_prov).

    S2 already enforced origin/destination type, so only a distance filter
    is needed here.
    """
    pairs = pairs_xsector[pairs_xsector["distance_km"] <= MAX_BAND_KM].copy()
    for t in ["SHS_HEI", "SHS_TESDA_prov", "HEI_TESDA_prov"]:
        n = (pairs["transition"] == t).sum()
        print(f"  {t}: {n:,} edges")
    return pairs[["origin_id", "dest_id", "transition", "distance_km"]].copy()


def build_tesda_edges(pairs_tesda, tesda_families_path=None):
    """
    TESDA provider→assessment edges.

    Without tesda_families_path (role-only mode, M3): family=None; any
    reachable assessment center satisfies the step regardless of program.

    With tesda_families_path (family-matched mode, M4): edges are expanded
    to one row per shared qualification family between provider and assessment
    center. Null-family edges are replaced by family-specific ones.
    """
    pairs = pairs_tesda[pairs_tesda["distance_km"] <= MAX_BAND_KM].copy()

    if tesda_families_path is None:
        print(f"  TESDA_prov_assess: {len(pairs):,} edges  [role-only, family=null]")
        pairs["family"] = None
        return pairs[["origin_id", "dest_id", "transition", "distance_km", "family"]].copy()

    # Family-matched mode (M4)
    fam = pd.read_parquet(tesda_families_path)
    # Expected columns: node_id, family (one row per institution-family pair)

    # Join provider families
    enriched = pairs.merge(
        fam.rename(columns={"node_id": "origin_id", "family": "prov_family"}),
        on="origin_id", how="inner",
    )
    # Join assessment families
    enriched = enriched.merge(
        fam.rename(columns={"node_id": "dest_id", "family": "assess_family"}),
        on="dest_id", how="inner",
    )
    # Keep only matching families
    matched = enriched[enriched["prov_family"] == enriched["assess_family"]].copy()
    matched["family"] = matched["prov_family"]
    matched = matched[["origin_id", "dest_id", "transition", "distance_km", "family"]]
    print(f"  TESDA_prov_assess: {len(matched):,} edges  [family-matched, {matched['family'].nunique()} families]")
    return matched.reset_index(drop=True)


# ---------------------------------------------------------------------------
# Self-edge (intra-node) builders
# ---------------------------------------------------------------------------

def build_self_edges(nodes):
    """
    Intra-node self-edges for integrated schools and TESDA Both sites.

    These satisfy a pathway-continuity step without requiring an inter-node
    connection — the progression happens within the same institution.
    """
    frames = []

    basic = nodes[nodes["source"].isin(["public", "private"])]

    # ES→JHS: school offers both elementary and JHS
    es_jhs = basic[basic["offers_es"] & basic["offers_jhs"]][["node_id"]].copy()
    es_jhs["transition"] = "ES_JHS"
    frames.append(es_jhs)

    # JHS→SHS: school offers both JHS and SHS
    jhs_shs = basic[basic["offers_jhs"] & basic["offers_shs"]][["node_id"]].copy()
    jhs_shs["transition"] = "JHS_SHS"
    frames.append(jhs_shs)

    self_edges = pd.concat(frames, ignore_index=True)
    self_edges["origin_id"] = self_edges["node_id"]
    self_edges["dest_id"]   = self_edges["node_id"]
    self_edges = self_edges.drop(columns="node_id")

    # TESDA Both: provider and assessment at the same site
    tesda = nodes[nodes["source"] == "tesda"]
    both = tesda[
        (tesda["tesda_role_provider"] == True) &
        (tesda["tesda_role_assessment"] == True)
    ][["node_id"]].copy()
    both["transition"] = "TESDA_prov_assess"
    both["origin_id"]  = both["node_id"]
    both["dest_id"]    = both["node_id"]
    both = both.drop(columns="node_id")

    result = pd.concat([self_edges, both], ignore_index=True)
    result["distance_km"] = 0.0
    result["family"]      = None
    result["intra_node"]  = True

    print(f"  ES→JHS self-edges  (integrated schools): {(result['transition']=='ES_JHS').sum():,}")
    print(f"  JHS→SHS self-edges (integrated schools): {(result['transition']=='JHS_SHS').sum():,}")
    print(f"  TESDA Both self-edges:                   {(result['transition']=='TESDA_prov_assess').sum():,}")
    return result[["origin_id", "dest_id", "transition", "distance_km", "family", "intra_node"]]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="S3: Build progression edge table")
    parser.add_argument("--nodes-path",   type=Path, default=NODES_PATH)
    parser.add_argument("--graph-dir",    type=Path, default=GRAPH_DIR)
    parser.add_argument(
        "--tesda-families", type=Path, default=None,
        help="Path to S5 output (tesda_families.parquet) for family-matched mode. "
             "Omit for role-only mode (M3 milestone).",
    )
    args = parser.parse_args()

    graph_dir = args.graph_dir
    graph_dir.mkdir(parents=True, exist_ok=True)

    print("=== S3: Progression Edges ===\n")
    mode = "family-matched" if args.tesda_families else "role-only"
    print(f"Mode: {mode}\n")
    t_total = time.time()

    print("Loading inputs…")
    nodes        = pd.read_parquet(args.nodes_path)
    pairs_basic  = pd.read_parquet(graph_dir / "pairs_basic.parquet")
    pairs_xsector = pd.read_parquet(graph_dir / "pairs_xsector.parquet")
    pairs_tesda  = pd.read_parquet(graph_dir / "pairs_tesda.parquet")
    print(f"  nodes: {len(nodes):,} | basic pairs: {len(pairs_basic):,} | "
          f"xsector: {len(pairs_xsector):,} | tesda: {len(pairs_tesda):,}\n")

    # --- Inter-node edges ---
    print("Building basic-ed inter-node edges (ES→JHS, JHS→SHS)…")
    edges_basic = build_basic_edges(pairs_basic, nodes)

    print("\nBuilding cross-sector inter-node edges…")
    edges_xsector = build_xsector_edges(pairs_xsector)

    print("\nBuilding TESDA provider→assessment inter-node edges…")
    edges_tesda = build_tesda_edges(pairs_tesda, args.tesda_families)

    # --- Self-edges ---
    print("\nBuilding intra-node self-edges…")
    edges_self = build_self_edges(nodes)

    # --- Assemble ---
    print("\nAssembling final edge table…")
    for df in [edges_basic, edges_xsector, edges_tesda]:
        if "intra_node" not in df.columns:
            df["intra_node"] = False
        if "family" not in df.columns:
            df["family"] = None

    all_edges = pd.concat(
        [edges_basic, edges_xsector, edges_tesda, edges_self],
        ignore_index=True,
    )

    # Canonical column order
    all_edges = all_edges[[
        "origin_id", "dest_id", "transition", "distance_km", "family", "intra_node"
    ]]

    # Sanity check
    n_dup = all_edges.duplicated(["origin_id", "dest_id", "transition"]).sum()
    if n_dup:
        print(f"  NOTE: {n_dup:,} duplicate (origin, dest, transition) rows — keeping all "
              "(expected for family-matched TESDA edges sharing same pair across families)")

    elapsed = time.time() - t_total

    # --- Summary ---
    print(f"\nTotal edges: {len(all_edges):,}  ({elapsed:.1f}s)")
    print(f"  Intra-node: {all_edges['intra_node'].sum():,}")
    print(f"  Inter-node: {(~all_edges['intra_node']).sum():,}")
    print("\n  By transition:")
    for t, grp in all_edges.groupby("transition"):
        n_self = grp["intra_node"].sum()
        n_inter = (~grp["intra_node"]).sum()
        print(f"    {t}: {len(grp):,}  (inter: {n_inter:,}  self: {n_self:,})")

    # --- Write ---
    out_path = graph_dir / "progression_edges.parquet"
    all_edges.to_parquet(out_path, index=False)
    size_mb = out_path.stat().st_size / 1e6
    print(f"\nSaved: {out_path}")
    print(f"       {len(all_edges):,} rows  |  {size_mb:.1f} MB  |  {len(all_edges.columns)} columns")

    manifest = {
        "stage": "S3",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "max_band_km": MAX_BAND_KM,
        "total_edges": len(all_edges),
        "intra_node_edges": int(all_edges["intra_node"].sum()),
        "inter_node_edges": int((~all_edges["intra_node"]).sum()),
        "by_transition": {
            t: int(len(grp))
            for t, grp in all_edges.groupby("transition")
        },
        "elapsed_s": round(elapsed, 1),
    }
    manifest_path = graph_dir / "_s3_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Saved: {manifest_path}")

    print(f"\n{'='*60}")
    print("DONE.")
    if not args.tesda_families:
        print("NOTE: Running in role-only mode. Re-run with --tesda-families")
        print("      after S5 completes for full family-matched TESDA edges.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
