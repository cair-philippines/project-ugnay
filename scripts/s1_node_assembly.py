#!/usr/bin/env python3
"""
S1 — Node assembly: build unified institution table from all four sector
gold parquets and assign composite node IDs.

Reads from project_coordinates/data/gold/:
  public_school_coordinates.parquet   (~48k rows)
  private_school_coordinates.parquet  (~12k rows)
  hei_coordinates.parquet             (~2.4k rows)
  tesda_coordinates.parquet           (~8k rows)

Writes:
  output/nodes/institutions.parquet
  output/nodes/_manifest.json

Usage:
    python scripts/s1_node_assembly.py
    python scripts/s1_node_assembly.py --coordinates-dir /path/to/gold
"""

import argparse
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from modules.text_clean import fix_mojibake_df

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR))

COORDINATES_DIR = PROJECT_DIR.parent / "project_coordinates" / "data" / "gold"
OUTPUT_DIR = PROJECT_DIR / "output"

# Philippine bounding box — same as modules/coordinates.py
PH_LAT_MIN, PH_LAT_MAX = 4.5, 21.5
PH_LON_MIN, PH_LON_MAX = 116.0, 127.0

# Coord rejection reasons that make basic-ed coordinates unusable
_EXCLUDE_REJECTION_REASONS = {
    "placeholder_default",
    "coordinate_cluster",
    "outside_all_polygons",
    "no_coordinate_source",
    "no_submission",
    "invalid",
    "out_of_bounds",
    "not_in_lis",
}

# TESDA coord_status values with no usable coordinates
_TESDA_EXCLUDE_STATUS = {"out_of_bounds", "null_coords"}

# Per-layer vintage strings for UI display (§2.0 item #8)
# Capture exact strings from project_coordinates source manifests when available.
VINTAGE = {
    "public":  "SY2024-25",
    "private": "SY2024-25",
    "hei":     "AY2024-25",
    "tesda":   "as-of 2026-06",
}

# Canonical output columns (in order)
CANONICAL_COLS = [
    "node_id", "source", "name",
    "lat", "lon",
    "region", "province", "municipality", "municity_psgc", "barangay",
    "offers_es", "offers_jhs", "offers_shs", "shs_strand_offerings",
    "hei_sector",
    "tesda_role_provider", "tesda_role_assessment",
    "esc_participating", "shsvp_participating", "jdvp_participating",
    "coord_status", "source_vintage",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _in_ph_bounds(df):
    """Boolean Series: True if lat/lon is within Philippine bounding box."""
    return (
        df["lat"].notna() & df["lon"].notna()
        & df["lat"].between(PH_LAT_MIN, PH_LAT_MAX)
        & df["lon"].between(PH_LON_MIN, PH_LON_MAX)
    )


def _hei_surrogate(name, psgc):
    """Deterministic, stable node_id suffix for HEIs with null uii_code."""
    h = hashlib.sha256(f"{name}|{psgc}".encode()).hexdigest()[:12]
    return f"NOUII_{h}"


def _to_canonical(df):
    """Fill missing canonical columns with None and return in canonical order."""
    for col in CANONICAL_COLS:
        if col not in df.columns:
            df[col] = None
    return df[CANONICAL_COLS].copy()


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def load_basic_ed(coordinates_dir):
    """Load public + private schools, filter coordinates, assign node IDs."""
    frames = []

    for source, filename in [
        ("public",  "public_school_coordinates.parquet"),
        ("private", "private_school_coordinates.parquet"),
    ]:
        df = pd.read_parquet(coordinates_dir / filename)
        n_raw = len(df)

        # Exclude unusable coordinates by rejection reason
        if "coord_rejection_reason" in df.columns:
            bad = df["coord_rejection_reason"].isin(_EXCLUDE_REJECTION_REASONS)
            df = df[~bad].copy()

        df = df.rename(columns={
            "latitude":    "lat",
            "longitude":   "lon",
            "school_name": "name",
        })

        # PH bounding box
        df = df[_in_ph_bounds(df)].copy()

        # Composite node_id
        prefix = "pub" if source == "public" else "prv"
        df["node_id"] = prefix + ":" + df["school_id"].astype(str).str.strip()
        df["source"] = source

        # municity_psgc: prefer psgc_municity, fallback to psgc_observed_municity
        df["municity_psgc"] = df.get("psgc_municity", pd.Series(dtype=object))
        if "psgc_observed_municity" in df.columns:
            df["municity_psgc"] = df["municity_psgc"].fillna(df["psgc_observed_municity"])

        # Standardized municipality / province names from PSGC where available
        if "psgc_municity_name" in df.columns:
            df["municipality"] = df["psgc_municity_name"].fillna(df.get("municipality", pd.Series(dtype=object)))
        if "psgc_province_name" in df.columns:
            df["province"] = df["psgc_province_name"].fillna(df.get("province", pd.Series(dtype=object)))

        # Barangay: prefer PSGC name
        if "psgc_barangay_name" in df.columns:
            df["barangay"] = df["psgc_barangay_name"].fillna(df.get("barangay", pd.Series(dtype=object)))

        # Level offerings stored as string 'True'/'False' (not bool dtype).
        # isin handles both string and actual bool True without misreading 'False'.
        for col in ["offers_es", "offers_jhs", "offers_shs"]:
            df[col] = df[col].isin([True, "True"]) if col in df.columns else False

        # Program flags exist only on private; public gets None
        for flag in ["esc_participating", "shsvp_participating", "jdvp_participating"]:
            if flag not in df.columns:
                df[flag] = None

        df["source_vintage"] = VINTAGE[source]

        n_kept = len(df)
        print(f"  {source}: {n_raw:,} raw → {n_kept:,} with valid coords (dropped {n_raw - n_kept:,})")
        frames.append(df)

    return pd.concat(frames, ignore_index=True)


def load_hei(coordinates_dir):
    """Load HEI parquet and assign composite node IDs with null-uii surrogates."""
    df = pd.read_parquet(coordinates_dir / "hei_coordinates.parquet")
    n_raw = len(df)

    df = df.rename(columns={
        "latitude":             "lat",
        "longitude":            "lon",
        "city_municipality":    "municipality",
        "psgc_observed_municity": "municity_psgc",
        "psgc_observed_barangay": "barangay",
        "sector":               "hei_sector",
    })

    # All HEI rows are coord_status='valid', but apply bounding box as a sanity check
    df = df[_in_ph_bounds(df)].copy()

    # Composite node_id
    null_uii = df["uii_code"].isnull()
    df["node_id"] = None

    valid_mask = ~null_uii
    df.loc[valid_mask, "node_id"] = (
        "hei:" + df.loc[valid_mask, "uii_code"].astype(str)
    )
    if null_uii.any():
        df.loc[null_uii, "node_id"] = df.loc[null_uii].apply(
            lambda r: "hei:" + _hei_surrogate(
                str(r["name"]), str(r.get("municity_psgc", ""))
            ),
            axis=1,
        )

    df["source"] = "hei"
    df["source_vintage"] = VINTAGE["hei"]

    # Province from PSGC-observed where available
    if "psgc_observed_province" in df.columns:
        df["province"] = df["psgc_observed_province"].fillna(df.get("province", pd.Series(dtype=object)))

    # Level offerings not applicable for HEI
    for col in ["offers_es", "offers_jhs", "offers_shs"]:
        df[col] = False

    n_kept = len(df)
    print(f"  HEI: {n_raw:,} raw → {n_kept:,} (null uii_code → surrogate: {null_uii.sum()})")
    return df


def load_tesda(coordinates_dir):
    """Load TESDA parquet, filter bad coords, assign node IDs and role booleans."""
    df = pd.read_parquet(coordinates_dir / "tesda_coordinates.parquet")
    n_raw = len(df)

    # Exclude institutions without usable coordinates
    if "coord_status" in df.columns:
        bad = df["coord_status"].isin(_TESDA_EXCLUDE_STATUS)
        if bad.any():
            breakdown = df.loc[bad, "coord_status"].value_counts().to_dict()
            print(f"  TESDA: excluding {bad.sum()} rows by coord_status {breakdown}")
        df = df[~bad].copy()

    df = df.rename(columns={
        "latitude":               "lat",
        "longitude":              "lon",
        "city_municipality":      "municipality",
        "psgc_observed_municity": "municity_psgc",
        "psgc_observed_barangay": "barangay",
    })

    # Bounding box — belt-and-suspenders after coord_status filter
    oob = ~_in_ph_bounds(df)
    if oob.any():
        print(f"  TESDA: dropping {oob.sum()} additional rows outside PH bounds")
    df = df[~oob].copy()

    df["node_id"] = "tesda:" + df["tesda_inst_id"].astype(str)
    df["source"] = "tesda"
    df["source_vintage"] = VINTAGE["tesda"]

    # Role booleans (§2.7)
    ic = df["institution_classification"]
    df["tesda_role_provider"]   = ic.isin(["Provider Only", "Both"])
    df["tesda_role_assessment"] = ic.isin(["Assessment Center Only", "Both"])

    # Province from PSGC-observed where available
    if "psgc_observed_province" in df.columns:
        df["province"] = df["psgc_observed_province"].fillna(df.get("province", pd.Series(dtype=object)))

    # Level offerings not applicable for TESDA
    for col in ["offers_es", "offers_jhs", "offers_shs"]:
        df[col] = False

    n_kept = len(df)
    print(f"  TESDA: {n_raw:,} raw → {n_kept:,} with valid coords (dropped {n_raw - n_kept:,})")
    return df


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="S1: Build unified institution node table")
    parser.add_argument(
        "--coordinates-dir", type=Path, default=COORDINATES_DIR,
        help="Path to project_coordinates/data/gold/",
    )
    args = parser.parse_args()

    coord_dir = Path(args.coordinates_dir)
    nodes_dir = OUTPUT_DIR / "nodes"
    nodes_dir.mkdir(parents=True, exist_ok=True)

    print("=== S1: Node Assembly ===\n")
    t0 = time.time()

    print("Loading basic-ed (public + private)...")
    df_basic = load_basic_ed(coord_dir)

    print("\nLoading HEI...")
    df_hei = load_hei(coord_dir)

    print("\nLoading TESDA...")
    df_tesda = load_tesda(coord_dir)

    print("\nAssembling unified node table...")
    df = pd.concat(
        [_to_canonical(df_basic), _to_canonical(df_hei), _to_canonical(df_tesda)],
        ignore_index=True,
    )

    # Repair mojibake before anything downstream sees it. Some upstream names arrive
    # double-encoded — `ñ` as `Ã±` — and in a country full of Parañaque, Los Baños and
    # Santo Niño that is not an edge case: a planner who sees "MontaÃ±eza NHS" reasonably
    # concludes the whole dataset is untrustworthy. Repairing here (rather than in the
    # frontend) means every consumer of institutions.parquet gets clean text, and a silent
    # upstream regression shows up in this log instead of on the map.
    df, n_repaired = fix_mojibake_df(df)
    if n_repaired:
        print(f"\n  Repaired mojibake in {n_repaired} text cell(s) — see modules/text_clean.py")

    # Normalize municity_psgc to 7-digit PSGC (strip barangay-level trailing zeros).
    # Basic-ed sources use 10-digit codes (e.g. '0105532000'); HEI/TESDA already use
    # 7-digit codes (e.g. '0105532'). All 10-digit codes verified to end in '000'.
    mask = df["municity_psgc"].notna()
    df.loc[mask, "municity_psgc"] = df.loc[mask, "municity_psgc"].astype(str).str[:7]

    elapsed = time.time() - t0

    # --- Validation ---
    n_dup = df["node_id"].duplicated().sum()
    n_null_id = df["node_id"].isnull().sum()
    n_null_municity = df["municity_psgc"].isnull().sum()

    print(f"\nTotal nodes: {len(df):,}  ({elapsed:.1f}s)")
    source_counts = {}
    for src in ["public", "private", "hei", "tesda"]:
        n = (df["source"] == src).sum()
        source_counts[src] = int(n)
        print(f"  {src}: {n:,}")

    if n_dup:
        print(f"\n  WARNING: {n_dup} duplicate node_ids — investigate")
    if n_null_id:
        print(f"  WARNING: {n_null_id} null node_ids")
    if n_null_municity:
        print(f"  NOTE: {n_null_municity} nodes with null municity_psgc — excluded from tile slicing")

    # --- Write ---
    out_path = nodes_dir / "institutions.parquet"
    df.to_parquet(out_path, index=False)
    size_mb = out_path.stat().st_size / 1e6
    print(f"\nSaved: {out_path}")
    print(f"       {len(df):,} rows  |  {size_mb:.1f} MB  |  {len(df.columns)} columns")

    manifest = {
        "stage": "S1",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "output": "nodes/institutions.parquet",
        "total_nodes": len(df),
        "source_counts": source_counts,
        "null_municity_psgc": int(n_null_municity),
        "duplicate_node_ids": int(n_dup),
        "vintages": VINTAGE,
        "columns": list(df.columns),
    }
    manifest_path = nodes_dir / "_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Saved: {manifest_path}")

    print(f"\n{'='*60}")
    print("DONE.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
