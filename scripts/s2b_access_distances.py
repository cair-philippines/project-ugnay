#!/usr/bin/env python3
"""
S2b — Accessibility distances: routed ROAD distance for every institution pair
within reach, replacing the client-side haversine the frontend used to compute.

Why this stage exists
---------------------
The accessibility feature (click an institution → see everything reachable within
1–5 km that offers something it lacks) was computing straight-line distance in the
browser. Straight-line flatters reality: it ignores rivers, coastlines, one-way
streets and the simple fact that roads bend. This stage precomputes the real thing.

Two outputs
-----------
  pairs_access.parquet     — every ordered pair within MAX_KM BY ROAD. Feeds the
                             edges drawn on click, the reachable-counts, and the
                             gap halos. Complete and exact.

  nearest_by_level.parquet — for each institution, the nearest institution offering
                             each level it does NOT itself offer, at ANY distance.
                             Feeds the drawer's "nearest of each level" panel, which
                             must be able to say "the nearest HEI is 28 km away" —
                             a question a 5 km table cannot answer.

Method
------
For pairs_access: the candidate set is every ordered pair within MAX_KM *straight-
line*. Road distance is always >= straight-line distance, so any pair within MAX_KM
by road is necessarily within MAX_KM straight-line — the candidate set is a complete
superset and no true pair can be missed. This output is therefore EXACT.

For nearest_by_level there is no such bound (the nearest HEI could be 100 km away),
so we route the NEAREST_K nearest candidates per level by straight line and take the
minimum road distance among them. This is exact unless the true road-nearest is
farther in a straight line than all NEAREST_K candidates — pathological river/coast
geometry. It is an orientation figure, not an edge, so the trade is worth it.

Both are routed through OSRM's /table service in spatially-blocked batches (origins
that sit near each other share almost all of their candidate destinations, so one
rectangular table query serves a whole neighbourhood).

Unroutable pairs — no road path at all, typically across water — are DROPPED, not
back-filled with haversine. An edge means "you can actually get there by road"; a
strait with no bridge is a real barrier, and quietly substituting a straight line
would reintroduce the very dishonesty this stage removes. They are counted and
reported.

NOTE: we do NOT reuse output/edges/all_edges.parquet (the existing DepEd↔DepEd OSRM
table). Spot-checking found it only ~89.5% complete at 5 km, so reusing it would
silently drop ~1 in 10 real edges. Everything here is computed fresh and uniformly.

The token rule ("dest offers something the origin lacks") is deliberately NOT applied
here — pairs_access stays rule-agnostic, and S6 filters when it slices the tiles. A
change to the rule then costs a re-slice, not a re-route.

Usage:
    python scripts/s2b_access_distances.py
    python scripts/s2b_access_distances.py --skip-pairs      # only redo nearest_by_level
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from sklearn.neighbors import BallTree

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_DIR / "output"
NODES_PATH = OUTPUT_DIR / "nodes" / "institutions.parquet"

MAX_KM = 5.0            # the frontend's accessibility slider tops out at 5 km
OSRM_URL = "http://172.18.0.2:5000"
EARTH_R = 6371.0

# OSRM is started with --max-table-size 10000, but the whole coordinate list travels
# in the URL, so keep requests well clear of both that cap and any URL-length limit.
MAX_COORDS = 2500
ORIGIN_CHUNK = 200

# For nearest_by_level: how many straight-line-nearest candidates per level to route
# before taking the minimum road distance. See the module docstring for the trade.
NEAREST_K = 12

# An institution this far from any mapped road has an unusable routed distance — either
# its coordinate is wrong (several "valid" ones plot in open sea) or OSM has no roads for
# the area. Flagged, and excluded from gap halos, rather than mislabelled as a real gap.
UNRELIABLE_SNAP_M = 2000

# How far below the straight-line floor a routed distance may fall before we call it a bug
# rather than rounding. OSRM measures the snap leg on its own spheroid; we measure the
# chord on ours, so sub-metre disagreement is expected. Metres are not.
TOLERANCE_KM = 0.05

# The capability tokens a node offers — must stay in step with tokensOf() in
# platform/frontend/src/lib/graph.js.
LEVELS = ["es", "jhs", "shs", "hei", "tesda_training", "tesda_assessment"]


def level_masks(nodes):
    """Boolean mask per level: which nodes offer it."""
    src = nodes["source"].to_numpy()
    basic = np.isin(src, ["public", "private"])
    col = lambda c: nodes[c].fillna(False).to_numpy().astype(bool)  # noqa: E731
    return {
        "es": basic & col("offers_es"),
        "jhs": basic & col("offers_jhs"),
        "shs": basic & col("offers_shs"),
        "hei": src == "hei",
        "tesda_training": (src == "tesda") & col("tesda_role_provider"),
        "tesda_assessment": (src == "tesda") & col("tesda_role_assessment"),
    }


def haversine_km(lat1, lon1, lat2, lon2):
    rl1, rl2 = np.radians(lat1), np.radians(lat2)
    dlat = rl2 - rl1
    dlon = np.radians(lon2) - np.radians(lon1)
    a = np.sin(dlat / 2) ** 2 + np.cos(rl1) * np.cos(rl2) * np.sin(dlon / 2) ** 2
    return 2.0 * EARTH_R * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def snap_distances(session, base_url, lat, lon):
    """
    How far OSRM has to move each institution to put it on the road network.

    This matters more than it sounds. OSRM's /table distances are measured between the
    SNAPPED points, not the coordinates you handed it. Two schools set back from the same
    highway snap to nearly the same spot, and the "road distance" between them comes out
    SHORTER than the straight line — which is impossible, and produced 41,120 such pairs
    (p95 shortfall 3.8 km) before this was accounted for.

    We therefore report door-to-door distance as  snap_origin + road + snap_dest.  By the
    triangle inequality that is guaranteed to be >= the straight-line distance between the
    true coordinates, so the impossibility becomes unrepresentable rather than merely rare.

    A large snap also flags a broken coordinate: several "valid" institutions snap 100+ km
    because they are plotted in open sea.
    """
    out = np.zeros(len(lat), dtype=float)
    CH = 2000
    for start in range(0, len(lat), CH):
        idx = range(start, min(start + CH, len(lat)))
        coords = [(lat[i], lon[i]) for i in idx]
        # sources = everything, destinations = one throwaway: we only want the snapped
        # waypoint metadata, not the matrix.
        j = osrm_table(session, base_url, coords, len(coords), 0, dest_first_only=True)
        for k, w in enumerate(j.get("sources", [])):
            if w and w.get("distance") is not None:
                out[start + k] = float(w["distance"])
    return out


def osrm_table(session, base_url, coords, n_src, n_dst, dest_first_only=False):
    """One /table call. coords = sources followed by destinations."""
    coord_str = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in coords)
    src = ";".join(str(i) for i in range(n_src))
    # dest_first_only: we want the snapped-waypoint metadata, not the matrix, so ask for
    # a single throwaway destination (OSRM rejects an empty destination list).
    dst = "0" if dest_first_only else ";".join(str(i) for i in range(n_src, n_src + n_dst))
    url = (
        f"{base_url}/table/v1/driving/{coord_str}"
        f"?sources={src}&destinations={dst}&annotations=distance"
    )
    for attempt in range(3):
        try:
            r = session.get(url, timeout=600)
            r.raise_for_status()
            j = r.json()
            if j.get("code") != "Ok":
                raise RuntimeError(f"OSRM code={j.get('code')}: {j.get('message')}")
            return j
        except Exception as exc:  # noqa: BLE001
            if attempt == 2:
                raise
            print(f"      retry {attempt + 1} after: {exc}")
            time.sleep(2)
    return None


def route_candidates(session, base_url, lat, lon, cand, label, snap):
    """
    Route every (origin i → dest j) in `cand` (list of index arrays, one per origin).

    Origins are visited in spatial order and batched: neighbours share almost all of
    their candidate destinations, so one rectangular /table query serves a whole
    neighbourhood. Returns (origin_idx, dest_idx, road_km) arrays plus diagnostics.

    Distance reported is DOOR TO DOOR:  snap[origin] + road network + snap[dest].
    See snap_distances() for why the bare network distance is not usable on its own.
    """
    # Coarse grid sort → each chunk's destination union stays small and overlapping.
    cell = np.round(lat / 0.045).astype(int) * 100000 + np.round(lon / 0.045).astype(int)
    order = np.lexsort((lat, cell))
    order = np.array([i for i in order if len(cand[i]) > 0], dtype=int)

    o_out, d_out, km_out = [], [], []
    n_unroutable = 0
    cells = 0
    t0 = time.time()

    queue = [order[i:i + ORIGIN_CHUNK] for i in range(0, len(order), ORIGIN_CHUNK)]
    print(f"  {label}: {len(order):,} origins, ~{len(queue):,} table calls…")
    done = 0

    while queue:
        chunk = queue.pop(0)
        dests = np.unique(np.concatenate([cand[i] for i in chunk]))

        # Too many coordinates for one URL → split the origins and retry both halves.
        if len(chunk) + len(dests) > MAX_COORDS and len(chunk) > 1:
            mid = len(chunk) // 2
            queue.insert(0, chunk[mid:])
            queue.insert(0, chunk[:mid])
            continue

        coords = [(lat[i], lon[i]) for i in chunk] + [(lat[j], lon[j]) for j in dests]
        j = osrm_table(session, base_url, coords, len(chunk), len(dests))
        dm = j["distances"]

        dpos = {int(dj): k for k, dj in enumerate(dests)}
        for r, i in enumerate(chunk):
            row = dm[r]
            for jj in cand[i]:
                v = row[dpos[int(jj)]]
                if v is None:
                    n_unroutable += 1
                    continue
                # max(v, 0): OSRM returns tiny negatives for coincident snapped points.
                metres = max(float(v), 0.0) + snap[i] + snap[jj]
                o_out.append(int(i))
                d_out.append(int(jj))
                km_out.append(metres / 1000.0)

        cells += len(chunk) * len(dests)
        done += 1
        if done % 60 == 0 or not queue:
            print(f"    {done:,} calls · {len(o_out):,} routed · "
                  f"{cells:,} cells · {time.time() - t0:.0f}s")

    return np.array(o_out), np.array(d_out), np.array(km_out), n_unroutable, cells


def main():
    ap = argparse.ArgumentParser(description="S2b: OSRM road distances for accessibility pairs")
    ap.add_argument("--nodes-path", type=Path, default=NODES_PATH)
    ap.add_argument("--max-km", type=float, default=MAX_KM)
    ap.add_argument("--osrm", default=OSRM_URL)
    ap.add_argument("--skip-pairs", action="store_true",
                    help="reuse an existing pairs_access.parquet; only redo nearest_by_level")
    args = ap.parse_args()

    graph_dir = OUTPUT_DIR / "graph"
    graph_dir.mkdir(parents=True, exist_ok=True)

    print("=== S2b: Accessibility road distances (OSRM) ===\n")
    t_total = time.time()

    nodes = pd.read_parquet(args.nodes_path)
    before = len(nodes)
    nodes = nodes.dropna(subset=["lat", "lon"]).reset_index(drop=True)
    print(f"Nodes: {before:,} → {len(nodes):,} with coordinates")

    lat = nodes["lat"].to_numpy()
    lon = nodes["lon"].to_numpy()
    ids = nodes["node_id"].to_numpy()

    rad_pts = np.radians(np.column_stack([lat, lon]))
    session = requests.Session()
    graph_dir.mkdir(parents=True, exist_ok=True)
    out = graph_dir / "pairs_access.parquet"
    snap_path = graph_dir / "node_snap.parquet"
    stats = {}

    # --- Part 0 — how far each institution sits from the road network ---------
    print("\nPart 0 — snapping institutions to the road network…")
    snap = snap_distances(session, args.osrm, lat, lon)
    unreliable = snap > UNRELIABLE_SNAP_M
    pd.DataFrame({
        "node_id": ids,
        "snap_m": np.round(snap, 1),
        "road_unreliable": unreliable,
    }).to_parquet(snap_path, index=False)

    print(f"  median {np.median(snap):.0f} m · p95 {np.quantile(snap, 0.95):.0f} m · "
          f"max {snap.max() / 1000:.0f} km")
    print(f"  {int(unreliable.sum()):,} institutions sit >{UNRELIABLE_SNAP_M / 1000:g} km "
          f"from any mapped road — flagged road_unreliable")
    print("  (either a broken coordinate — several 'valid' ones plot in open sea — or an "
          "area OSM has no roads for. Either way their routed distances can't be trusted.)")
    stats.update({
        "snap_median_m": float(np.median(snap)),
        "snap_p95_m": float(np.quantile(snap, 0.95)),
        "nodes_road_unreliable": int(unreliable.sum()),
    })

    # =========================================================================
    # Part 1 — pairs_access: every ordered pair within MAX_KM BY ROAD (exact)
    # =========================================================================
    if args.skip_pairs and out.exists():
        print(f"\nPart 1 — skipped, reusing {out.name}")
        df = pd.read_parquet(out)
    else:
        print(f"\nPart 1 — pairs within {args.max_km:g} km by road")
        print(f"  Candidate set (≤ {args.max_km:g} km straight-line — a complete superset)…")
        tree = BallTree(rad_pts, metric="haversine")
        cand = tree.query_radius(rad_pts, r=args.max_km / EARTH_R)
        cand = [c[c != i] for i, c in enumerate(cand)]  # drop self
        n_cand = sum(len(c) for c in cand)
        print(f"  {n_cand:,} ordered candidate pairs")

        oi, di, km, n_unroutable, cells = route_candidates(
            session, args.osrm, lat, lon, cand, "pairs_access", snap)

        df = pd.DataFrame({"origin_id": ids[oi], "dest_id": ids[di], "road_km": km})
        df["haversine_km"] = haversine_km(lat[oi], lon[oi], lat[di], lon[di])
        df["road_haversine_ratio"] = df["road_km"] / df["haversine_km"].clip(lower=0.001)

        # Sanity gate. With the snap legs added, the triangle inequality guarantees
        # road >= straight-line, so any violation is either floating-point noise (OSRM
        # measures the snap leg on its own spheroid, we measure the chord on ours) or a
        # broken distance model. Clamp the noise; fail loudly on anything material, rather
        # than ship impossible edges as we nearly did.
        viol = df["haversine_km"] - df["road_km"]
        bad = viol > 1e-9
        if bad.any():
            worst = float(viol[bad].max())
            print(f"  road < straight-line on {int(bad.sum()):,} pairs "
                  f"(max {worst * 1000:.1f} m) → clamped to the straight-line floor")
            if worst > TOLERANCE_KM:
                raise AssertionError(
                    f"{int(bad.sum()):,} pairs are shorter than a straight line by up to "
                    f"{worst * 1000:.0f} m — far beyond rounding. The snap correction is "
                    "not being applied correctly."
                )
            df["road_km"] = df[["road_km", "haversine_km"]].max(axis=1)
            df["road_haversine_ratio"] = df["road_km"] / df["haversine_km"].clip(lower=0.001)

        n_routed = len(df)
        df = df[df["road_km"] <= args.max_km].reset_index(drop=True)
        for c in ("road_km", "haversine_km", "road_haversine_ratio"):
            df[c] = df[c].round(4)
        df.to_parquet(out, index=False)

        print(f"\n  Candidates (≤{args.max_km:g} km straight-line): {n_cand:,}")
        print(f"  Unroutable (no road path — dropped):     {n_unroutable:,} "
              f"({100 * n_unroutable / max(n_cand, 1):.2f}%)")
        print(f"  Routed:                                  {n_routed:,}")
        print(f"  Within {args.max_km:g} km BY ROAD (kept):          {len(df):,} "
              f"({100 * len(df) / max(n_cand, 1):.1f}% of candidates)")
        print(f"  Median road / straight-line ratio:       "
              f"{df['road_haversine_ratio'].median():.2f}×")
        print(f"  Impossible (road < straight-line):       0  ✓")
        print(f"  Saved: {out}  ({out.stat().st_size / 1e6:.1f} MB)")

        stats.update({
            "candidates": int(n_cand),
            "unroutable": int(n_unroutable),
            "kept_within_max_km_by_road": int(len(df)),
            "median_road_haversine_ratio": float(df["road_haversine_ratio"].median()),
            "table_cells_pairs": int(cells),
        })

    # =========================================================================
    # Part 2 — nearest_by_level: nearest institution offering each level a node
    #          does NOT offer, at ANY distance (feeds the drawer's panel)
    # =========================================================================
    print("\nPart 2 — nearest of each level, by road (unbounded)")
    masks = level_masks(nodes)

    # One candidate list per origin: the NEAREST_K nearest by straight line for every
    # level the origin lacks, unioned. Routing the union in one pass is far cheaper
    # than one pass per level, since the batches overlap heavily.
    cand2 = [[] for _ in range(len(nodes))]
    want = []  # (origin_idx, level, dest_idx) — which pairs answer which level
    for lv in LEVELS:
        offers = masks[lv]
        dest_idx = np.flatnonzero(offers)
        if len(dest_idx) == 0:
            continue
        lacks = np.flatnonzero(~offers)
        tree_l = BallTree(rad_pts[dest_idx], metric="haversine")
        k = min(NEAREST_K, len(dest_idx))
        _, nn = tree_l.query(rad_pts[lacks], k=k)
        for row, i in enumerate(lacks):
            for j in dest_idx[nn[row]]:
                cand2[i].append(int(j))
                want.append((int(i), lv, int(j)))
        print(f"  {lv}: {len(dest_idx):,} offer it · {len(lacks):,} lack it")

    cand2 = [np.unique(np.array(c, dtype=int)) if c else np.array([], dtype=int) for c in cand2]
    print(f"  {sum(len(c) for c in cand2):,} distinct pairs to route "
          f"(K={NEAREST_K} nearest per level)")

    oi2, di2, km2, unroutable2, cells2 = route_candidates(
        session, args.osrm, lat, lon, cand2, "nearest_by_level", snap)

    # Look up the routed distance for each (origin, level, candidate) and keep the min.
    routed = {}
    for a, b, d in zip(oi2, di2, km2):
        routed[(int(a), int(b))] = float(d)

    best = {}
    for i, lv, j in want:
        d = routed.get((i, j))
        if d is None:
            continue
        key = (i, lv)
        if key not in best or d < best[key][0]:
            best[key] = (d, j)

    near = pd.DataFrame(
        [(ids[i], lv, round(d, 4), ids[j]) for (i, lv), (d, j) in best.items()],
        columns=["node_id", "level", "road_km", "nearest_id"],
    )
    near_path = graph_dir / "nearest_by_level.parquet"
    near.to_parquet(near_path, index=False)

    print(f"\n  {len(near):,} (institution, level) nearest distances")
    print(f"  Unroutable candidates skipped: {unroutable2:,}")
    print(f"  Median nearest-by-road distance: {near['road_km'].median():.1f} km")
    print(f"  Saved: {near_path}  ({near_path.stat().st_size / 1e6:.1f} MB)")

    stats.update({
        "nearest_rows": int(len(near)),
        "nearest_k": NEAREST_K,
        "table_cells_nearest": int(cells2),
    })

    elapsed = time.time() - t_total
    print(f"\nTotal time: {elapsed:.0f}s")

    manifest = {
        "stage": "S2b",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "max_km": args.max_km,
        "distance_method": "OSRM /table driving, annotations=distance (routed road distance)",
        "candidate_rule": "pairs_access: all ordered pairs <= max_km straight-line "
                          "(road >= straight-line, so this is a complete superset — output is EXACT)",
        "nearest_rule": f"nearest_by_level: min road distance over the {NEAREST_K} nearest "
                        "candidates per level by straight line (near-exact; an orientation "
                        "figure, not an edge)",
        "unroutable_policy": "dropped (no road path); NOT back-filled with haversine",
        "distance_definition": "door-to-door: snap_origin + OSRM road network + snap_dest. "
                               "The bare network distance is measured between SNAPPED points "
                               "and can come out shorter than the straight line; adding the "
                               "snap legs makes road >= straight-line by the triangle "
                               "inequality (asserted in-script).",
        "unreliable_snap_m": UNRELIABLE_SNAP_M,
        "token_rule_applied": False,
        "elapsed_s": round(elapsed, 1),
        **stats,
    }
    with open(graph_dir / "_s2b_manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print("\n" + "=" * 60)
    print("DONE.")
    print("=" * 60)


if __name__ == "__main__":
    main()
