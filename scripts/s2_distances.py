#!/usr/bin/env python3
"""
S2 — Distances: assemble all candidate distance pairs for progression edge
generation in S3.

Three outputs (all pairs <= 20 km, stored as distance_km):

  pairs_basic.parquet     — DepEd ↔ DepEd (OSRM road distances, reused from
                            output/edges/all_edges.parquet, school_ids mapped
                            to composite node_ids)

  pairs_xsector.parquet  — SHS→HEI, SHS→TESDA_prov, HEI→TESDA_prov
                            (haversine, OSRM is the committed post-demo upgrade)

  pairs_tesda.parquet    — TESDA_prov→TESDA_assess (haversine, inter-node only;
                           self-satisfaction for 'Both' sites is added in S3)

Usage:
    python scripts/s2_distances.py
    python scripts/s2_distances.py --max-km 20 --nodes-path output/nodes/institutions.parquet
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.spatial import KDTree

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR))

OUTPUT_DIR = PROJECT_DIR / "output"
NODES_PATH = OUTPUT_DIR / "nodes" / "institutions.parquet"
EDGES_PATH = OUTPUT_DIR / "edges" / "all_edges.parquet"

MAX_KM = 20.0
# KDTree pre-filter radius in degrees. 0.20° ≈ 22 km — slightly larger than
# MAX_KM to avoid dropping border-case pairs due to the Euclidean approximation.
BBOX_DEG = 0.20


# ---------------------------------------------------------------------------
# Haversine
# ---------------------------------------------------------------------------

def haversine_km(lat1, lon1, lat2_arr, lon2_arr):
    """Haversine distance in km: scalar origin vs array of destinations."""
    R = 6371.0
    rl1 = np.radians(lat1)
    rl2 = np.radians(lat2_arr)
    dlat = rl2 - rl1
    dlon = np.radians(lon2_arr) - np.radians(lon1)
    a = np.sin(dlat / 2) ** 2 + np.cos(rl1) * np.cos(rl2) * np.sin(dlon / 2) ** 2
    return 2.0 * R * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


# ---------------------------------------------------------------------------
# Pair computation helpers
# ---------------------------------------------------------------------------

def compute_pairs_kdtree(origins, dests, transition_label, max_km=MAX_KM,
                         bbox_deg=BBOX_DEG, exclude_self=False, log_every=2000):
    """
    Compute haversine pairs between origins and dests within max_km.

    Uses KDTree on dest lat/lon for a bounding-box pre-filter, then
    computes exact haversine for the filtered candidates.

    Parameters
    ----------
    origins, dests : pd.DataFrame with columns node_id, lat, lon
    transition_label : str  — stored in the 'transition' column
    exclude_self : bool     — drop pairs where origin_id == dest_id

    Returns
    -------
    pd.DataFrame with columns: origin_id, dest_id, transition, distance_km
    """
    dest_lats = dests["lat"].values
    dest_lons = dests["lon"].values
    dest_ids  = dests["node_id"].values
    dest_coords = np.column_stack([dest_lats, dest_lons])
    tree = KDTree(dest_coords)

    orig_lats = origins["lat"].values
    orig_lons = origins["lon"].values
    orig_ids  = origins["node_id"].values

    records = []
    n = len(orig_lats)

    for i in range(n):
        if log_every and i > 0 and i % log_every == 0:
            print(f"    {i:,}/{n:,} origins processed…")

        neighbor_idx = tree.query_ball_point([orig_lats[i], orig_lons[i]], r=bbox_deg)
        if not neighbor_idx:
            continue

        ni = np.asarray(neighbor_idx)
        dists = haversine_km(orig_lats[i], orig_lons[i], dest_lats[ni], dest_lons[ni])

        mask = dists <= max_km
        if not mask.any():
            continue

        ni_keep = ni[mask]
        d_keep  = dists[mask]

        for j, d in zip(ni_keep, d_keep):
            oid = orig_ids[i]
            did = dest_ids[j]
            if exclude_self and oid == did:
                continue
            records.append((oid, did, transition_label, float(d)))

    if not records:
        return pd.DataFrame(columns=["origin_id", "dest_id", "transition", "distance_km"])

    return pd.DataFrame(records, columns=["origin_id", "dest_id", "transition", "distance_km"])


# ---------------------------------------------------------------------------
# Part 1 — Basic-ed pairs (reuse OSRM edge table)
# ---------------------------------------------------------------------------

def compute_basic_pairs(nodes, edges_path):
    """
    Map all_edges.parquet school_ids → composite node_ids.
    Keeps all pairs (already <= 20 km in the source table).
    """
    print("  Loading all_edges.parquet…")
    edges = pd.read_parquet(edges_path)
    n_raw = len(edges)

    # Build raw_school_id → composite node_id lookup from S1 output
    basic = nodes[nodes["source"].isin(["public", "private"])].copy()
    basic["raw_id"] = basic["node_id"].str.split(":").str[1]
    id_map = dict(zip(basic["raw_id"], basic["node_id"]))

    edges["origin_id"] = edges["source_id"].astype(str).map(id_map)
    edges["dest_id"]   = edges["target_id"].astype(str).map(id_map)

    # Drop pairs where either side wasn't in S1 (filtered-out schools)
    unmapped = edges["origin_id"].isnull() | edges["dest_id"].isnull()
    n_dropped = unmapped.sum()
    if n_dropped:
        print(f"  Dropped {n_dropped:,} pairs with IDs not in S1 node table")
    edges = edges[~unmapped].copy()

    # Convert distance to km (source is meters)
    edges["distance_km"] = (edges["road_distance_m"] / 1000.0).round(4)

    out = edges[["origin_id", "dest_id", "distance_km", "is_sea_separated"]].copy()
    print(f"  Basic-ed pairs: {n_raw:,} raw → {len(out):,} mapped  "
          f"(≤5 km: {(out['distance_km'] <= 5).sum():,})")
    return out


# ---------------------------------------------------------------------------
# Part 2 — Cross-sector pairs (haversine)
# ---------------------------------------------------------------------------

def compute_xsector_pairs(nodes):
    """
    Compute SHS→HEI, SHS→TESDA_prov, and HEI→TESDA_prov haversine pairs.
    """
    shs   = nodes[nodes["offers_shs"]].copy()
    hei   = nodes[nodes["source"] == "hei"].copy()
    tprov = nodes[nodes["tesda_role_provider"] == True].copy()

    transitions = [
        ("SHS_HEI",       shs,  hei,   "SHS → HEI"),
        ("SHS_TESDA_prov", shs,  tprov, "SHS → TESDA provider"),
        ("HEI_TESDA_prov", hei,  tprov, "HEI → TESDA provider"),
    ]

    frames = []
    for label, orig, dest, desc in transitions:
        print(f"\n  {desc}: {len(orig):,} origins × {len(dest):,} dests")
        t0 = time.time()
        df = compute_pairs_kdtree(orig, dest, label)
        elapsed = time.time() - t0
        print(f"  → {len(df):,} pairs ≤ {MAX_KM} km  ({elapsed:.1f}s)")
        frames.append(df)

    return pd.concat(frames, ignore_index=True)


# ---------------------------------------------------------------------------
# Part 3 — TESDA provider → assessment pairs (haversine)
# ---------------------------------------------------------------------------

def compute_tesda_pairs(nodes):
    """
    Compute TESDA provider → assessment center haversine pairs (inter-node only).
    Self-satisfaction for 'Both' sites is recorded as an intra-node self-edge in S3.
    """
    tprov   = nodes[nodes["tesda_role_provider"]   == True].copy()
    tassess = nodes[nodes["tesda_role_assessment"]  == True].copy()

    print(f"\n  TESDA provider → assessment: {len(tprov):,} origins × {len(tassess):,} dests")
    t0 = time.time()
    df = compute_pairs_kdtree(tprov, tassess, "TESDA_prov_assess", exclude_self=True)
    elapsed = time.time() - t0
    print(f"  → {len(df):,} pairs ≤ {MAX_KM} km  ({elapsed:.1f}s)")
    return df


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="S2: Compute distance pairs")
    parser.add_argument("--nodes-path", type=Path, default=NODES_PATH)
    parser.add_argument("--edges-path", type=Path, default=EDGES_PATH)
    parser.add_argument("--max-km", type=float, default=MAX_KM)
    args = parser.parse_args()

    graph_dir = OUTPUT_DIR / "graph"
    graph_dir.mkdir(parents=True, exist_ok=True)

    print("=== S2: Distances ===\n")
    t_total = time.time()

    print("Loading S1 node table…")
    nodes = pd.read_parquet(args.nodes_path)
    print(f"  {len(nodes):,} nodes loaded\n")

    # --- Part 1: Basic-ed ---
    print("Part 1 — Basic-ed (OSRM, reuse existing edge table)")
    pairs_basic = compute_basic_pairs(nodes, args.edges_path)

    out_basic = graph_dir / "pairs_basic.parquet"
    pairs_basic.to_parquet(out_basic, index=False)
    print(f"  Saved: {out_basic}  ({out_basic.stat().st_size / 1e6:.1f} MB)")

    # --- Part 2: Cross-sector ---
    print("\nPart 2 — Cross-sector (haversine placeholder)")
    pairs_xsector = compute_xsector_pairs(nodes)

    out_xsector = graph_dir / "pairs_xsector.parquet"
    pairs_xsector.to_parquet(out_xsector, index=False)
    print(f"\n  Saved: {out_xsector}  ({out_xsector.stat().st_size / 1e6:.1f} MB)")

    print("\n  Cross-sector breakdown:")
    for t, grp in pairs_xsector.groupby("transition"):
        n5 = (grp["distance_km"] <= 5).sum()
        print(f"    {t}: {len(grp):,} pairs  (≤5 km: {n5:,})")

    # --- Part 3: TESDA ---
    print("\nPart 3 — TESDA provider → assessment (haversine)")
    pairs_tesda = compute_tesda_pairs(nodes)

    out_tesda = graph_dir / "pairs_tesda.parquet"
    pairs_tesda.to_parquet(out_tesda, index=False)
    print(f"  Saved: {out_tesda}  ({out_tesda.stat().st_size / 1e6:.1f} MB)")

    n_tesda5 = (pairs_tesda["distance_km"] <= 5).sum()
    print(f"  TESDA pairs ≤5 km: {n_tesda5:,}")

    # --- Summary & manifest ---
    elapsed = time.time() - t_total
    print(f"\nTotal time: {elapsed:.1f}s")

    manifest = {
        "stage": "S2",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "max_km": MAX_KM,
        "distance_method": {
            "basic_ed": "OSRM (reused from all_edges.parquet)",
            "cross_sector": "haversine (MVP placeholder; OSRM is committed post-demo)",
            "tesda": "haversine (MVP placeholder)",
        },
        "outputs": {
            "pairs_basic":   {"rows": len(pairs_basic),   "le5km": int((pairs_basic["distance_km"] <= 5).sum())},
            "pairs_xsector": {"rows": len(pairs_xsector), "le5km": int((pairs_xsector["distance_km"] <= 5).sum())},
            "pairs_tesda":   {"rows": len(pairs_tesda),   "le5km": int(n_tesda5)},
        },
        "elapsed_s": round(elapsed, 1),
    }
    manifest_path = graph_dir / "_s2_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Saved: {manifest_path}")

    print(f"\n{'='*60}")
    print("DONE.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
