#!/usr/bin/env python3
"""
S4 — Pathway-continuity metrics: per-node reachability and per-area
continuity rollups at municipal, provincial, and regional levels.

⚠️ SUPERSEDED (2026-07-13) — THESE PERCENTAGES ARE NOT ROAD DISTANCES.
----------------------------------------------------------------------
Every number here is derived from S3's edge table, whose cross-sector distances are
straight lines from the haversine era. A "continuity %" computed on them overstates
reachability, because only ~53% of pairs within 5 km as the crow flies survive the drive.

S6 no longer ships these rollups into the tiles, and their only consumer (ContinuityPanel)
was never mounted. The network view now answers the same question honestly, from S7's
road-distance chain walk — and it answers a strictly stronger version of it, since S4 only
ever measured whether the NEXT step was reachable, not whether the pathway ever ends
anywhere.

Rebuild on S2b/S7 before trusting these files again. See SPECS §A6.

Reads:
  output/nodes/institutions.parquet      (S1)
  output/graph/progression_edges.parquet (S3)

Writes:
  output/graph/node_metrics.parquet
      Long format: one row per (node, transition) where the node is an
      origin for that transition.
      Columns: node_id, municity_psgc, province, region, source,
               transition, min_dist_km
      min_dist_km = 0.0  → reachable at all bands (self-edge satisfies)
      min_dist_km = NaN  → node is an origin but has no reachable target
                           within the 20 km pre-filter (broken at all bands)

  output/aggregations/continuity_municipal.parquet
  output/aggregations/continuity_provincial.parquet
  output/aggregations/continuity_regional.parquet
      Per-area, per-transition, per-band (1-5 km) continuity metrics.
      Columns: <area keys>, transition, band_km, n_origins, n_reachable,
               continuity_pct, band_label

Plain-language band thresholds (§1.9, provisional):
  ≥75% → "most" | 40–74% → "many" | 1–39% → "few" | 0% → "none"

Usage:
    python scripts/s4_metrics.py
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR))

OUTPUT_DIR = PROJECT_DIR / "output"
NODES_PATH = OUTPUT_DIR / "nodes" / "institutions.parquet"
GRAPH_DIR  = OUTPUT_DIR / "graph"
AGG_DIR    = OUTPUT_DIR / "aggregations"

BANDS = [1, 2, 3, 4, 5]  # km — display band presets (§2.5)

# Origin condition for each transition (§2.1, §2.7)
# Maps transition label → column name (or callable) that marks origin nodes
ORIGIN_CONDITIONS = {
    "ES_JHS":           ("offers_es",),
    "JHS_SHS":          ("offers_jhs",),
    "SHS_HEI":          ("offers_shs",),
    "SHS_TESDA_prov":   ("offers_shs",),
    "HEI_TESDA_prov":   ("_is_hei",),
    "TESDA_prov_assess": ("_is_tesda_prov",),
}


def band_label(pct: float) -> str:
    """Translate continuity % to a plain-language band (§1.9)."""
    if pct >= 75:
        return "most"
    if pct >= 40:
        return "many"
    if pct > 0:
        return "few"
    return "none"


# ---------------------------------------------------------------------------
# Per-node metrics
# ---------------------------------------------------------------------------

def build_node_metrics(nodes: pd.DataFrame, edges: pd.DataFrame) -> pd.DataFrame:
    """
    For every (node, transition) where the node is an origin, compute the
    minimum edge distance (inter-node or intra-node self-edge).
    """
    # Add convenience flags for cross-sector origin conditions
    nodes = nodes.copy()
    nodes["_is_hei"]       = nodes["source"] == "hei"
    nodes["_is_tesda_prov"] = nodes["tesda_role_provider"] == True

    # Min distance from edges: one row per (origin_id, transition)
    min_edges = (
        edges
        .groupby(["origin_id", "transition"])["distance_km"]
        .min()
        .reset_index()
        .rename(columns={"origin_id": "node_id", "distance_km": "min_dist_km"})
    )

    location_cols = ["node_id", "municity_psgc", "province", "region", "source"]

    frames = []
    for transition, (flag_col,) in ORIGIN_CONDITIONS.items():
        # Select origin nodes for this transition
        origins = nodes[nodes[flag_col] == True][location_cols].copy()
        origins["transition"] = transition

        # Left-join: origins without any reachable target get min_dist_km = NaN
        edges_t = min_edges[min_edges["transition"] == transition][
            ["node_id", "min_dist_km"]
        ]
        merged = origins.merge(edges_t, on="node_id", how="left")
        frames.append(merged)

    node_metrics = pd.concat(frames, ignore_index=True)
    print(f"  Node metrics rows: {len(node_metrics):,}")
    print(f"  Broken at all bands (no reachable target): "
          f"{node_metrics['min_dist_km'].isnull().sum():,}")
    print(f"  Reachable via self-edge (min_dist=0): "
          f"{(node_metrics['min_dist_km'] == 0.0).sum():,}")
    return node_metrics


# ---------------------------------------------------------------------------
# Area continuity rollups
# ---------------------------------------------------------------------------

def compute_continuity(node_metrics: pd.DataFrame,
                       group_cols: list[str]) -> pd.DataFrame:
    """
    Compute per-area, per-transition, per-band continuity metrics.

    Parameters
    ----------
    node_metrics : output of build_node_metrics()
    group_cols   : admin-level columns to group by
                   e.g. ['municity_psgc', 'province', 'region'] for municipal
    """
    # Drop nodes without area keys (null municity_psgc, etc.)
    valid = node_metrics.dropna(subset=[group_cols[0]])

    rows = []
    for group_key, grp in valid.groupby(group_cols + ["transition"]):
        # group_key is a tuple of all group values; last element is transition
        *area_values, transition = group_key
        n_origins = len(grp)
        key_dict = dict(zip(group_cols, area_values))
        for band in BANDS:
            # NaN <= band is False in pandas — nodes without any edge are not reachable
            n_reach = int((grp["min_dist_km"] <= band).sum())
            pct = round(n_reach / n_origins * 100, 1) if n_origins > 0 else 0.0
            rows.append({
                **key_dict,
                "transition":      transition,
                "band_km":         band,
                "n_origins":       n_origins,
                "n_reachable":     n_reach,
                "continuity_pct":  pct,
                "band_label":      band_label(pct),
            })

    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="S4: Compute pathway-continuity metrics")
    parser.add_argument("--nodes-path", type=Path, default=NODES_PATH)
    parser.add_argument("--graph-dir",  type=Path, default=GRAPH_DIR)
    parser.add_argument("--agg-dir",    type=Path, default=AGG_DIR)
    args = parser.parse_args()

    AGG_DIR.mkdir(parents=True, exist_ok=True)

    print("=== S4: Pathway-Continuity Metrics ===\n")
    t_total = time.time()

    print("Loading inputs…")
    nodes = pd.read_parquet(args.nodes_path)
    edges = pd.read_parquet(args.graph_dir / "progression_edges.parquet")
    print(f"  nodes: {len(nodes):,} | edges: {len(edges):,}\n")

    # --- Per-node metrics ---
    print("Computing per-node min-distance metrics…")
    node_metrics = build_node_metrics(nodes, edges)

    print("\n  By transition:")
    for t, grp in node_metrics.groupby("transition"):
        n_broken  = grp["min_dist_km"].isnull().sum()
        n_self    = (grp["min_dist_km"] == 0.0).sum()
        n_inter   = len(grp) - n_broken - n_self
        pct_broken = round(n_broken / len(grp) * 100, 1)
        print(f"    {t}: {len(grp):,} origins  "
              f"(self: {n_self:,}  inter: {n_inter:,}  broken: {n_broken:,} = {pct_broken}%)")

    out_node = args.graph_dir / "node_metrics.parquet"
    node_metrics.to_parquet(out_node, index=False)
    print(f"\n  Saved: {out_node}  ({out_node.stat().st_size / 1e6:.1f} MB)")

    # --- Area continuity rollups ---
    print("\nComputing area continuity rollups…")

    levels = [
        ("municipal",  ["municity_psgc", "province", "region"]),
        ("provincial", ["province", "region"]),
        ("regional",   ["region"]),
    ]

    manifests_agg = {}
    for level_name, group_cols in levels:
        t0 = time.time()
        agg = compute_continuity(node_metrics, group_cols)
        elapsed = time.time() - t0

        out_path = args.agg_dir / f"continuity_{level_name}.parquet"
        agg.to_parquet(out_path, index=False)
        n_areas = agg[group_cols[0]].nunique()
        print(f"  {level_name}: {n_areas:,} areas × 6 transitions × 5 bands "
              f"= {len(agg):,} rows  ({elapsed:.1f}s)")
        print(f"    Saved: {out_path}")
        manifests_agg[level_name] = {"rows": len(agg), "areas": n_areas}

    # --- Quick sanity print: worst-continuity transitions at municipal level ---
    muni = pd.read_parquet(args.agg_dir / "continuity_municipal.parquet")
    print("\n  National median continuity_pct at band=5 km by transition:")
    b5 = muni[muni["band_km"] == 5]
    for t, grp in b5.groupby("transition"):
        med = grp["continuity_pct"].median()
        print(f"    {t}: {med:.1f}%")

    elapsed_total = time.time() - t_total

    # --- Manifest ---
    manifest = {
        "stage": "S4",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "bands_km": BANDS,
        "band_thresholds": {"most": ">=75%", "many": "40-74%", "few": "1-39%", "none": "0%"},
        "node_metrics_rows": len(node_metrics),
        "aggregations": manifests_agg,
        "elapsed_s": round(elapsed_total, 1),
    }
    manifest_path = args.graph_dir / "_s4_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\nSaved manifest: {manifest_path}")

    print(f"\n{'='*60}")
    print("DONE.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
