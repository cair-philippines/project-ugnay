"""
Fill spurious holes in the dissolved administrative boundaries.

Why this exists
---------------
`dissolve_municipal_boundaries.py` unions source polygons whose edges are not perfectly
coincident, so the hairline gaps between them survive the union as INTERIOR RINGS.
Rendered as a line layer, every one of those rings draws a broken grey line *inside* the
province — the border looks shattered instead of being a clean outline.

Two kinds of hole must be told apart, and size alone does NOT do it:

  * SPURIOUS — dissolve slivers, and water bodies (Taal 268 km², Lake Lanao 357 km²,
    Laguna de Bay). A lake is not an administrative border. FILL THESE.
  * REAL ENCLAVES — a higher administrative unit carved out of its neighbour:
    Baguio City inside Benguet (61 km²), Angeles City inside Pampanga (126 km²). These
    are separate ADM2 units, so the hole is genuinely part of the border. KEEP THESE.

The test is therefore not area but identity: **keep a hole only if another unit of the
same level actually sits in it.** Everything else gets filled.

    python scripts/clean_boundaries.py
"""

import json
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

BOUNDARIES = Path(__file__).resolve().parents[1] / "output" / "boundaries"

# A hole counts as a real enclave when this much of it is covered by other units.
COVERAGE_KEEP = 0.5

FILES = [
    ("provincial_boundaries.geojson", "ADM2_PCODE"),
    ("municipal_boundaries.geojson", "ADM3_PCODE"),
]


def polygons_of(geom):
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return []


def main():
    for name, id_field in FILES:
        path = BOUNDARIES / name
        data = json.loads(path.read_text())

        geoms = [shape(f["geometry"]).buffer(0) for f in data["features"]]
        tree = STRtree(geoms)

        filled = 0
        kept = 0
        for i, feat in enumerate(data["features"]):
            geom = geoms[i]
            parts = []
            for poly in polygons_of(geom):
                if not poly.interiors:
                    parts.append(poly)
                    continue
                keep_rings = []
                for ring in poly.interiors:
                    hole = Polygon(ring)
                    if hole.area <= 0:
                        continue
                    # Is another administrative unit sitting inside this hole?
                    others = [
                        geoms[j]
                        for j in tree.query(hole)
                        if j != i and geoms[j].intersects(hole)
                    ]
                    covered = 0.0
                    if others:
                        covered = unary_union(others).intersection(hole).area / hole.area
                    if covered >= COVERAGE_KEEP:
                        keep_rings.append(ring)  # real enclave (e.g. an HUC)
                        kept += 1
                    else:
                        filled += 1  # sliver or water body → fill it
                parts.append(Polygon(poly.exterior, keep_rings))
            cleaned = parts[0] if len(parts) == 1 else MultiPolygon(parts)
            feat["geometry"] = mapping(cleaned)

        path.write_text(json.dumps(data))
        print(
            f"{name:32s} features={len(data['features']):5d}  "
            f"holes filled={filled:5d}  enclaves kept={kept:3d}  "
            f"({path.stat().st_size / 1e6:.1f} MB)"
        )


if __name__ == "__main__":
    main()
