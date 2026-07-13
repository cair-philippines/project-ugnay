#!/usr/bin/env python3
"""
One-off repair: fix mojibaked strings in ALREADY-BUILT tiles, in place.

S1 now repairs mojibake at ingest and S6 refuses to write a corrupt tile, so a fresh
pipeline run produces clean tiles. But a full rerun needs OSRM and the source parquets,
which is a heavy price for correcting a handful of names — this script fixes the tiles
we already have so the fix can ship immediately.

Idempotent: running it on clean tiles changes nothing.

Usage:
    python scripts/repair_tiles_mojibake.py               # report only
    python scripts/repair_tiles_mojibake.py --write       # apply the repair
"""

import argparse
import json
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR))

from modules.text_clean import find_mojibake, fix_mojibake

TILES_DIR = PROJECT_DIR / "output" / "tiles"
BOUNDARIES_DIR = PROJECT_DIR / "output" / "boundaries"


def repair(obj):
    """Walk a nested structure, repairing every string. Returns (obj, n_changed)."""
    n = 0
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            nk = fix_mojibake(k)
            n += nk != k
            nv, cn = repair(v)
            n += cn
            out[nk] = nv
        return out, n
    if isinstance(obj, list):
        out = []
        for v in obj:
            nv, cn = repair(v)
            n += cn
            out.append(nv)
        return out, n
    if isinstance(obj, str):
        fixed = fix_mojibake(obj)
        return fixed, int(fixed != obj)
    return obj, 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="apply the repair (default: report only)")
    args = ap.parse_args()

    targets = sorted(TILES_DIR.glob("*.json")) + sorted(BOUNDARIES_DIR.glob("*.geojson"))
    print(f"Scanning {len(targets)} files…\n")

    total_cells = 0
    touched = []
    for fp in targets:
        with open(fp, encoding="utf-8") as fh:
            data = json.load(fh)
        fixed, n = repair(data)
        if not n:
            continue
        touched.append((fp.name, n))
        total_cells += n
        # show what actually changed
        for s in (s for s in _walk_strings(data) if find_mojibake(s)):
            print(f"  {fp.name}: {s!r}\n      -> {fix_mojibake(s)!r}")
        if args.write:
            # Keep the writer's conventions: compact for tiles, and ensure_ascii (the
            # existing tiles escape non-ASCII as \uXXXX, which is valid JSON and exactly
            # what json.dump does by default).
            with open(fp, "w", encoding="utf-8") as fh:
                json.dump(fixed, fh, separators=(",", ":"))

    print(f"\n{'REPAIRED' if args.write else 'WOULD REPAIR'}: "
          f"{total_cells} string(s) across {len(touched)} file(s)")
    for name, n in touched:
        print(f"  {name}: {n}")
    if not args.write and touched:
        print("\nRe-run with --write to apply.")


def _walk_strings(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _walk_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_strings(v)
    elif isinstance(obj, str):
        yield obj


if __name__ == "__main__":
    main()
