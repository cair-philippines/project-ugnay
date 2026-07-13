#!/usr/bin/env python3
"""
S6 — Per-municipality JSON tile slicer + admin index.

For each municipality with at least one institution writes:
  output/tiles/<municity_psgc>.json
    meta           — municity_psgc, region, province, municipality name
    nodes          — institutions within the municipality (selected columns)
    access         — ROAD-distance accessibility adjacency (S2b), origin → [[dest_id, metres]]
    nearest        — nearest institution offering each level the node lacks, by road (S2b)
    edges          — progression edges where origin is in this municipality
    neighbor_nodes — edge destinations outside this municipality (id + coords only)
    continuity     — per-transition per-band stats from S4 municipal aggregation

`access` is what the frontend draws on click. It carries ROUTED ROAD distance from
S2b, replacing the straight-line haversine the browser used to compute. Two rules are
applied here rather than in S2b, so that changing either costs a re-slice and not a
re-route:

  1. the TOKEN RULE — keep a pair only if the destination offers a capability the
     origin lacks (must stay in step with tokensOf() in the frontend's lib/graph.js);
  2. metres as integers — the payload is ~1.5 M pairs, and a rounded int is a third
     the size of a float in JSON, which nobody can perceive on a map.

Destinations may sit outside this municipality; the frontend only draws edges to
nodes it has actually loaded, exactly as it did when it computed them itself.

Also writes:
  output/tiles/admin_index.json
    Nested region → province → [{municity_psgc, name}] hierarchy for the
    geographic picker UI, plus flat metadata counts.

Usage:
    python scripts/s6_tile_slicer.py
    python scripts/s6_tile_slicer.py --tiles-dir output/tiles
"""

import argparse
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR))

from modules.text_clean import find_mojibake

OUTPUT_DIR        = PROJECT_DIR / "output"
NODES_PATH        = OUTPUT_DIR / "nodes" / "institutions.parquet"
GRAPH_DIR         = OUTPUT_DIR / "graph"
AGG_DIR           = OUTPUT_DIR / "aggregations"
DEFAULT_TILES_DIR = OUTPUT_DIR / "tiles"

# Columns included in each tile's node list (excludes spatial/admin-only cols)
NODE_COLS = [
    "node_id", "name", "source", "lat", "lon",
    "offers_es", "offers_jhs", "offers_shs",
    "shs_strand_offerings",
    "hei_sector", "hei_is_public",
    "tesda_role_provider", "tesda_role_assessment",
    "esc_participating", "shsvp_participating", "jdvp_participating",
    "source_vintage",
    # From S2b: this institution sits >2 km from any mapped road, so its routed
    # distances are untrustworthy (usually a broken coordinate). The frontend suppresses
    # its gap halo — a false red dot on a school plotted in open sea reads as a real
    # accessibility gap when it is really a data error.
    "road_unreliable",
]

# Canonical PSGC name crosswalk (from project_coordinates). Keyed on the first
# 7 digits of the 10-digit municity PSGC. Resolves the dirty/heterogeneous
# region/province/municipality names in the node table (casing dupes like
# "QUEZON"/"Quezon", stray "MANILA, NCR, FIRST DISTRICT", numeric PSGC codes on
# HEI/TESDA nodes). NCR's "province" slot is naturally the city name.
CROSSWALK_CANDIDATES = [
    Path("/workspace/project_coordinates/data/silver/psgc_crosswalk.parquet"),
    Path("/workspace/innovation-projects/project_coordinates/data/silver/psgc_crosswalk.parquet"),
]

# Explicit overrides for known-dirty source codes the crosswalk can't resolve.
# 1380600 is a placeholder that HEI/TESDA source data attaches to many NCR
# cities at once (cannot map to a single municipality) — bucket it into the
# canonical NCR region with an honest "unspecified city" label rather than
# spawning a duplicate malformed region entry.
MUNI_OVERRIDES = {
    "1380600": {
        "region": "National Capital Region (NCR)",
        "province": "NCR (city unspecified)",
        "municipality": "NCR (city unspecified)",
    },
}


# Capability tokens an institution offers. MUST stay in step with tokensOf() in
# platform/frontend/src/lib/graph.js — an edge exists only when the destination offers
# a token the origin lacks, and the two sides must agree on what a token is.
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


def _iter_strings(obj):
    """Every string anywhere in a nested tile — for the mojibake backstop."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _iter_strings(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _iter_strings(v)
    elif isinstance(obj, str):
        yield obj


def _strip(v):
    return v.strip() if isinstance(v, str) else v


def _hei_is_public(v):
    """SUC/LUC → public; Private* → private; else None."""
    if not isinstance(v, str):
        return None
    if "SUC" in v or "LUC" in v:
        return True
    if "Private" in v:
        return False
    return None


def build_muni_lookup(municity_keys):
    """Return {municity_psgc(7) → {region, province, municipality}} using the
    canonical PSGC crosswalk, with a last-5-digit fallback for region-prefix
    mismatches (e.g. Sulu, moved into BARMM). Unmatched keys are omitted."""
    cw_path = next((p for p in CROSSWALK_CANDIDATES if p.exists()), None)
    if cw_path is None:
        print("  WARNING: PSGC crosswalk not found — falling back to raw node names.")
        return {}
    cw = pd.read_parquet(
        cw_path,
        columns=["psgc_region_name", "psgc_province_name", "psgc_municity", "psgc_municity_name"],
    )
    cw["k7"] = cw["psgc_municity"].astype(str).str.zfill(10).str[:7]
    cw = cw.drop_duplicates("k7")

    by7 = {}
    by5 = {}  # province+municity digits, ignoring region prefix (for Sulu et al.)
    for _, r in cw.iterrows():
        rec = {
            "region": _strip(r["psgc_region_name"]),
            "province": _strip(r["psgc_province_name"]),
            "municipality": _strip(r["psgc_municity_name"]),
        }
        k7 = r["k7"]
        by7[k7] = rec
        by5.setdefault(k7[2:7], rec)

    out = {}
    n_fallback = 0
    for key in municity_keys:
        k = str(key)
        if k in MUNI_OVERRIDES:
            out[k] = MUNI_OVERRIDES[k]
        elif k in by7:
            out[k] = by7[k]
        elif len(k) >= 7 and k[2:7] in by5:
            out[k] = by5[k[2:7]]
            n_fallback += 1
    print(f"  Canonical names: {len(out):,}/{len(municity_keys):,} resolved "
          f"(crosswalk {cw_path.name}; {n_fallback} via 5-digit fallback)")
    return out

# Minimal columns for neighbor nodes (rendered as edge endpoints only)
NEIGHBOR_COLS = ["lat", "lon", "source"]

# Edge columns in tile
EDGE_COLS = ["origin_id", "dest_id", "transition", "distance_km", "intra_node"]


def clean_val(v):
    """Convert numpy scalars and NaN/inf to JSON-safe Python types."""
    if isinstance(v, bool):
        return v
    if isinstance(v, np.bool_):
        return bool(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, (float, np.floating)):
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    # pandas NaT / None
    if v is None or v is pd.NaT:
        return None
    # Catch-all pandas NA
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return v


def clean_record(d: dict) -> dict:
    return {k: clean_val(v) for k, v in d.items()}


def build_continuity_dict(cont_by_muni: dict, municity: str) -> dict:
    """Return nested continuity dict: transition → band_km → {stats}."""
    sub = cont_by_muni.get(municity)
    if sub is None:
        return {}
    result = {}
    for _, row in sub.iterrows():
        t = str(row["transition"])
        b = int(row["band_km"])
        result.setdefault(t, {})[b] = {
            "n_origins":     int(row["n_origins"]),
            "n_reachable":   int(row["n_reachable"]),
            "continuity_pct": float(row["continuity_pct"]),
            "band_label":    str(row["band_label"]),
        }
    return result


def main():
    parser = argparse.ArgumentParser(description="S6: Per-municipality tile slicer")
    parser.add_argument("--tiles-dir",  type=Path, default=DEFAULT_TILES_DIR)
    parser.add_argument("--nodes-path", type=Path, default=NODES_PATH)
    parser.add_argument("--graph-dir",  type=Path, default=GRAPH_DIR)
    parser.add_argument("--agg-dir",    type=Path, default=AGG_DIR)
    args = parser.parse_args()

    tiles_dir = args.tiles_dir
    tiles_dir.mkdir(parents=True, exist_ok=True)

    print("=== S6: Per-Municipality Tile Slicer ===\n")
    t_total = time.time()

    # --- Load inputs ---
    print("Loading inputs…")
    nodes     = pd.read_parquet(args.nodes_path)
    if "hei_sector" in nodes.columns:
        nodes["hei_is_public"] = nodes["hei_sector"].map(_hei_is_public)
    edges     = pd.read_parquet(args.graph_dir / "progression_edges.parquet")
    cont_muni = pd.read_parquet(args.agg_dir / "continuity_municipal.parquet")
    access    = pd.read_parquet(args.graph_dir / "pairs_access.parquet")
    nearest   = pd.read_parquet(args.graph_dir / "nearest_by_level.parquet")
    snap      = pd.read_parquet(args.graph_dir / "node_snap.parquet")
    print(f"  nodes: {len(nodes):,}  |  edges: {len(edges):,}  "
          f"|  cont_muni: {len(cont_muni):,} rows")
    print(f"  access pairs (road ≤5 km): {len(access):,}  |  nearest rows: {len(nearest):,}")

    # Attach the S2b road-reliability flag; default False for any node S2b didn't see.
    unreliable = dict(zip(snap["node_id"], snap["road_unreliable"]))
    nodes["road_unreliable"] = nodes["node_id"].map(unreliable).fillna(False).astype(bool)
    print(f"  road_unreliable nodes: {int(nodes['road_unreliable'].sum()):,}")

    # --- Token rule: keep only pairs where the destination offers something new ---
    tok = {r["node_id"]: tokens_of(r) for r in nodes.to_dict(orient="records")}
    o_tok = access["origin_id"].map(tok)
    d_tok = access["dest_id"].map(tok)
    keep = [bool(d - o) for o, d in zip(o_tok, d_tok)]
    n_before = len(access)
    access = access[keep]
    print(f"  access after token rule: {len(access):,} "
          f"({100 * len(access) / max(n_before, 1):.0f}% of {n_before:,})")

    # Group once: origin → [[dest_id, metres], …]. Integer metres, not float km.
    access = access.sort_values(["origin_id", "road_km"])
    access_by_origin = {
        oid: [[d, int(round(k * 1000))] for d, k in zip(g["dest_id"], g["road_km"])]
        for oid, g in access.groupby("origin_id", sort=False)
    }

    # node_id → {level: road_km to the nearest institution offering it}
    nearest_by_node = {
        nid: {lv: float(k) for lv, k in zip(g["level"], g["road_km"])}
        for nid, g in nearest.groupby("node_id", sort=False)
    }

    # --- Pre-group continuity by municipality ---
    cont_by_muni = {k: g for k, g in cont_muni.groupby("municity_psgc")}

    # --- Map node_id → municity_psgc for edge routing ---
    node_municity = nodes.set_index("node_id")["municity_psgc"].to_dict()

    edges = edges.copy()
    edges["origin_municity"] = edges["origin_id"].map(node_municity)
    edges_valid = edges.dropna(subset=["origin_municity"])
    edges_by_muni = {k: g for k, g in edges_valid.groupby("origin_municity")}

    # --- Node lookup for neighbor coords (ALL nodes, incl. null-municity) ---
    node_lookup = nodes.set_index("node_id")[NEIGHBOR_COLS].to_dict(orient="index")

    # --- Group institutions by municipality (excludes null-municity) ---
    nodes_with_muni = nodes.dropna(subset=["municity_psgc"])
    muni_groups = list(nodes_with_muni.groupby("municity_psgc"))
    print(f"  Municipalities to tile: {len(muni_groups):,}\n")

    # Canonical region/province/municipality names per municity (see build_muni_lookup).
    muni_lookup = build_muni_lookup([m for m, _ in muni_groups])

    # --- Per-municipality tile loop ---
    n_written = 0
    total_edge_count = 0
    total_access_pairs = 0
    tile_node_cols = [c for c in NODE_COLS if c in nodes.columns]
    edge_cols_avail = [c for c in EDGE_COLS if c in edges.columns]

    for municity, node_grp in muni_groups:
        first = node_grp.iloc[0]

        canon = muni_lookup.get(str(municity))
        meta = {
            "municity_psgc": municity,
            "region":        canon["region"]       if canon else clean_val(first.get("region")),
            "province":      canon["province"]      if canon else clean_val(first.get("province")),
            "municipality":  canon["municipality"]  if canon else clean_val(first.get("municipality")),
        }

        # Tile nodes
        tile_nodes = [
            clean_record(r)
            for r in node_grp[tile_node_cols].to_dict(orient="records")
        ]

        # Tile edges (origins in this municipality)
        muni_edges_df = edges_by_muni.get(municity)
        if muni_edges_df is not None and len(muni_edges_df):
            tile_edges = [
                clean_record(r)
                for r in muni_edges_df[edge_cols_avail].to_dict(orient="records")
            ]
        else:
            tile_edges = []
        total_edge_count += len(tile_edges)

        # Neighbor nodes: edge destinations outside this municipality
        muni_node_ids = set(node_grp["node_id"])
        neighbor_ids = {
            r["dest_id"]
            for r in tile_edges
            if not r.get("intra_node") and r.get("dest_id") not in muni_node_ids
        }
        neighbor_nodes = []
        for nid in neighbor_ids:
            if nid in node_lookup:
                info = node_lookup[nid]
                neighbor_nodes.append({
                    "node_id": nid,
                    "lat":     clean_val(info.get("lat")),
                    "lon":     clean_val(info.get("lon")),
                    "source":  clean_val(info.get("source")),
                })

        # Continuity
        continuity = build_continuity_dict(cont_by_muni, municity)

        # Road-distance accessibility for the institutions in this tile (S2b).
        tile_access = {}
        tile_nearest = {}
        for nid in node_grp["node_id"]:
            adj = access_by_origin.get(nid)
            if adj:
                tile_access[nid] = adj
                total_access_pairs += len(adj)
            nr = nearest_by_node.get(nid)
            if nr:
                tile_nearest[nid] = nr

        tile = {
            "meta":           meta,
            "nodes":          tile_nodes,
            "access":         tile_access,
            "nearest":        tile_nearest,
            "edges":          tile_edges,
            "neighbor_nodes": neighbor_nodes,
            "continuity":     continuity,
        }

        # Nothing mojibaked may reach a tile. S1 repairs it at ingest; this is the
        # backstop, because a corrupt name ("MontaÃ±eza NHS") is the kind of defect that
        # ships silently and quietly discredits the whole dataset in a planner's eyes.
        # Fail the build rather than serve it.
        bad = [s for s in _iter_strings(tile) if find_mojibake(s)]
        if bad:
            raise SystemExit(
                f"S6: mojibake in tile {municity}: {bad[:5]}\n"
                f"     Expected S1 to have repaired this (modules/text_clean.py). "
                f"Re-run s1_node_assembly.py."
            )

        out_path = tiles_dir / f"{municity}.json"
        with open(out_path, "w") as fh:
            json.dump(tile, fh, separators=(",", ":"))

        n_written += 1
        if n_written % 300 == 0:
            print(f"  {n_written:,} / {len(muni_groups):,} tiles written…")

    print(f"  {n_written:,} tiles written  ({total_edge_count:,} total edges, "
          f"{total_access_pairs:,} road-distance accessibility pairs)")

    # --- Admin index ---
    print("\nBuilding admin_index.json…")

    # Build the region → province → municipality hierarchy from CANONICAL names,
    # falling back to raw node names only for municities the crosswalk can't resolve.
    raw_first = (
        nodes_with_muni.groupby("municity_psgc")[["region", "province", "municipality"]]
        .first()
        .to_dict(orient="index")
    )

    def _clean_name(v, default):
        return str(v) if (v is not None and pd.notna(v)) else default

    region_tree: dict = {}
    for municity, _ in muni_groups:
        key = str(municity)
        canon = muni_lookup.get(key)
        if canon:
            reg, prov, mname = canon["region"], canon["province"], canon["municipality"]
        else:
            r = raw_first.get(municity, {})
            reg, prov, mname = r.get("region"), r.get("province"), r.get("municipality")
        reg  = _clean_name(reg, "Unknown")
        prov = _clean_name(prov, "Unknown")
        mname = _clean_name(mname, key)
        region_tree.setdefault(reg, {}).setdefault(prov, []).append(
            {"municity_psgc": key, "name": mname}
        )

    admin = {"regions": [], "total_tiles": n_written,
             "created_at": datetime.now(timezone.utc).isoformat()}
    for reg in sorted(region_tree):
        prov_list = []
        for prov in sorted(region_tree[reg]):
            munis = sorted(region_tree[reg][prov], key=lambda x: x["name"])
            prov_list.append({"province": prov, "municipalities": munis})
        admin["regions"].append({"region": reg, "provinces": prov_list})

    idx_path = tiles_dir / "admin_index.json"
    with open(idx_path, "w") as fh:
        json.dump(admin, fh, separators=(",", ":"))
    print(f"  Saved: {idx_path}")

    # --- Size report ---
    tile_sizes = [
        (tiles_dir / f"{m}.json").stat().st_size
        for m, _ in muni_groups
        if (tiles_dir / f"{m}.json").exists()
    ]
    if tile_sizes:
        total_mb  = sum(tile_sizes) / 1e6
        median_kb = sorted(tile_sizes)[len(tile_sizes) // 2] / 1e3
        max_kb    = max(tile_sizes) / 1e3
        max_muni  = max(
            [(tiles_dir / f"{m}.json").stat().st_size for m, _ in muni_groups],
            key=lambda x: x,
        )
        # Find which tile is the largest
        largest = sorted(
            [(m, (tiles_dir / f"{m}.json").stat().st_size) for m, _ in muni_groups],
            key=lambda x: x[1], reverse=True,
        )[:3]
        print(f"\n  Tile sizes: total={total_mb:.1f} MB, "
              f"median={median_kb:.1f} KB, max={max_kb:.1f} KB")
        print(f"  Largest tiles: {[f'{m} ({s/1e3:.0f} KB)' for m, s in largest]}")

    elapsed = time.time() - t_total
    print(f"\nTotal time: {elapsed:.1f}s")

    manifest = {
        "stage": "S6",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "tiles_dir": str(tiles_dir),
        "total_tiles": n_written,
        "total_edge_rows_in_tiles": total_edge_count,
        "elapsed_s": round(elapsed, 1),
    }
    manifest_path = tiles_dir / "_s6_manifest.json"
    with open(manifest_path, "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"  Saved manifest: {manifest_path}")

    print(f"\n{'='*60}")
    print("DONE.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
