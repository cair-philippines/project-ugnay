# project_ugnay — Pipeline Implementation Plan

**Status:** Draft for review
**Companions:** `SPECS.md` (canonical product/data decisions), `ugnay_overhaul_brief.md` (scope). Ops/deployment detail lives in a separate doc; this plan covers the **data pipeline** that produces the platform's served artifacts, plus the contract with the frontend.

---

## 0. Objective & constraints

| Constraint | Value |
|---|---|
| **Demo date** | **July 16, 2026** (7 days from the Jul 9 plan start) — on-stage demo + QR check-in for ~100 concurrent users on personal devices |
| **Target** | Full SPECS MVP, **nationwide** coverage (all ~1,700 municipalities) |
| **Serving** | **Static per-municipality JSON** on Firebase (host: `ugnay.cair.ph`); **no live backend** |
| **Deploy** | GitHub Actions → Firebase (pattern mirrors platform_aral) |
| **Cross-sector distance (demo)** | **Haversine** (SPECS-sanctioned placeholder); OSRM is the committed post-demo upgrade |

**Build order.** The pipeline is built in **dependency order**, so each milestone (§5) yields a self-contained, demoable state. TESDA supports two configurations — full two-stage (with family matching) and role-only — both valid outputs of the same stages.

---

## 1. Architecture — data flow

```
project_coordinates gold (4 parquets)  ─┐
  public / private / hei / tesda        │
tesda_programs.parquet (silver)         │
existing output/edges/all_edges.parquet ┤
existing output/boundaries/*.geojson    │
                                        ▼
   [S1] Node assembly ── unified institutions table (composite IDs)
                                        ▼
   [S2] Distances ── basic-ed (reuse) + cross-sector (haversine) + TESDA↔TESDA   [progression graph]
                                        ▼
   [S2b] Accessibility road distances (OSRM) ── pairs_access (≤5 km by road) + nearest_by_level (unbounded)
                                        ▼
   [S3] Progression edges ── relational rules × bands → base edge table
                                        ▼
   [S4] Metrics ── stepwise continuity + gap flags (node & area)
                                        ▼
   [S5] TESDA family mapping ── program → qualification family (feeds S3/S4 for provider→assessment)
                                        ▼
   [S6] Per-municipality JSON slicer + admin index  ← the served artifact
                                        ▼
   [S7] Publish to Firebase (GitHub Actions)
```

The **frontend rebuild (MapLibre GL + deck.gl)** is a parallel workstream; its only contract with the pipeline is the **JSON schema (§6)** and the **admin index (§6.2)**.

---

## 2. Reuse map (build on, don't rebuild)

| Existing asset | Reuse for | Change needed |
|---|---|---|
| `modules/coordinates.py` | Node assembly (public+private loader) | Extend to load HEI + TESDA, assign composite IDs & surrogates |
| `output/edges/all_edges.parquet` (≤20 km OSRM, DepEd) | All basic-ed distances | Filter ≤5 km for edges; keep nearest for detail. **No recompute** |
| `modules/osrm_client.py` + `sparse_edges.py` | Post-demo OSRM cross-sector upgrade | Reuse as-is when upgrading from haversine |
| `modules/accessibility_metrics.py` | Metrics scaffolding | Adapt from desert/isolation logic to progression continuity |
| `modules/aggregation.py` | Municipal/provincial/regional rollups | Adapt to continuity % per transition |
| `output/boundaries/*.geojson` | Map boundaries + slice geometry | Reuse municipal boundaries for slicing/index |
| `modules/gcs_utils.py`, `inter_island.py` | I/O + island-group signal | Reuse as-is |

---

## 3. Pipeline stages (detail)

### S1 — Node assembly → `output/nodes/institutions.parquet`
- Load the four gold parquets; concatenate into one node table.
- **Composite node_id** (§2.6 SPECS): `pub:<school_id>`, `prv:<school_id>`, `hei:<uii_code>`, `tesda:<tesda_inst_id>`.
- **HEI null-uii surrogate:** `hei:NOUII_<hash(name, psgc)>` for the 109 null rows — deterministic, stable across re-runs.
- Columns: `node_id, sector, name, lat, lon, region, province, municity_psgc, barangay, offers_es, offers_jhs, offers_shs, shs_strands, hei_sector, tesda_role{provider,assessment,both}, tesda_families[], program_flags{esc,shsvp,jdvp}, coord_status(DepEd only), source_vintage`.
- **Level classification:** ES/JHS/SHS from `offers_*`; HEI = higher; TESDA roles from `institution_classification`.
- **Vintage:** attach per-layer vintage string (item #8; capture from project_coordinates — see §7 open items).
- *Risk:* low. *Depends on:* nothing new.

### S2 — Distances
- **Basic-ed (reuse):** load `all_edges.parquet`; keep ≤5 km for candidate edges; retain nearest-per-sector (any distance ≤20 km) for node detail.
- **Cross-sector (haversine, demo):** bounding-box-prefiltered haversine (proven in scoping: ~11.7K SHS × 2.4K HEI runs in seconds in pure Python) for SHS→HEI, SHS→TESDA-provider, HEI→TESDA-provider. Store pairs ≤5 km (edges) + nearest-per-target-type ≤20 km (detail/gap).
- **TESDA provider→assessment (haversine):** among TESDA nodes, pairs ≤5 km, later family-filtered (S5).
- Output: `output/graph/pairs_basic.parquet`, `pairs_xsector.parquet`, `pairs_tesda.parquet`.
- *Note:* S2 feeds the **progression graph** (S3/S4). It still uses haversine for cross-sector, which is fine — the progression graph only drives the gap halos, and those are now derived from S2b's road distances instead (see the frontend). The **accessibility feature reads S2b, not S2.**

### S2b — Accessibility road distances (OSRM) → `output/graph/pairs_access.parquet` + `nearest_by_level.parquet` **(added 2026-07-12)**
Routes every institution pair through the OSRM `/table` service and bakes road distances into the tiles, replacing the client-side haversine the frontend used to compute. Script: `scripts/s2b_access_distances.py`. ~13 min against the `osrm-routing` container (`http://172.18.0.2:5000`).
- **`pairs_access`** — every ordered pair **≤5 km by road**. Candidate set = all pairs ≤5 km straight-line (road ≥ straight-line, so this is a complete superset → the output is *exact*). Feeds the edges drawn on click, the reachable-counts, and (via nearest) the halos. 4.06 M candidates → **2.16 M kept (53.2%)**; median detour **1.41×**.
- **`nearest_by_level`** — nearest institution offering each level a node *lacks*, at **any distance** (K=12 nearest per level, unbounded). Feeds the drawer's "nearest of each level" panel, which a 5 km cap could not answer.
- **Door-to-door distance** = `snap_origin + road + snap_dest`. OSRM measures between *road-snapped* points; that alone produced 41,120 pairs shorter than a straight line (impossible). Adding the snap legs makes road ≥ straight-line by the triangle inequality — asserted in-script (0 violations shipped).
- **`node_snap.parquet`** carries each node's snap distance + a `road_unreliable` flag (>2 km from any road — usually a broken coordinate; **2,311 nodes**). S6 propagates the flag; the frontend suppresses their gap halos.
- **Pre-filter:** deliberately *not* the §2.6 20 km — edges cap at the 5 km slider max; nearest is unbounded. (S2's 20 km still governs the progression graph.)
- **Token rule is applied in S6, not here** — `pairs_access` stays rule-agnostic, so changing the rule costs a re-slice, not a re-route.
- *Idempotent:* `--skip-pairs` reuses `pairs_access` and only redoes the nearest pass.

### S3 — Progression edges → `output/graph/progression_edges.parquet`
- Apply relational rules to distance pairs. Edge exists when: origin offers the transition's origin level, destination satisfies the target level/sector/role, **and** distance ≤ 5 km (max display band). Store `distance_km` so client filters to 1–5 km bands.
- Transitions: `ES→JHS, JHS→SHS, SHS→HEI, SHS→TESDA_provider, HEI→TESDA_provider, TESDA_provider→TESDA_assessment`.
- **Self-edges:** integrated schools (consecutive `offers_*`); TESDA `Both` self-satisfies provider→assessment.
- Columns: `origin_id, dest_id, transition, distance_km, family(nullable), intra_node(bool)`.
- *Risk:* med (core new logic). *Depends on:* S1, S2, (S5 for the family field on provider→assessment).

### S4 — Metrics → `output/graph/node_metrics.parquet` + extended `output/aggregations/`
- **Per-node (stepwise, §1.8):** for each transition the node originates, boolean `reachable@band` for bands 1–5 km; `broken_pathway` flag (offers origin level, no reachable target within band). Reachability via inter-node OR self-edge.
- **Per-area (§1.9):** per-transition continuity % (school-count based, unweighted) per band, per municipality; translate to plain-language band (≥75 most / 40–74 many / 1–39 few / 0 none — provisional).
- Reuse `aggregation.py` grouping; write municipal/provincial/regional.
- *Risk:* med. *Depends on:* S3.

### S5 — TESDA qualification-family mapping → `output/nodes/tesda_families.parquet`
- Input: `project_coordinates/data/silver/tesda_programs.parquet` (`tesda_inst_id, program, institution_classification, …`).
- Derive a **qualification family** from free-text `program` (map to TESDA's ~22 qualification sectors via keyword/lookup table). **Validity: include all** (ignore `expiration_date` for v1).
- Feeds the `family` field of provider→assessment edges (S3) and the assessment-gap metric (S4).
- **Role-only configuration:** dropping the family constraint yields the role-only model — any reachable assessment center satisfies the step (two-stage structure, minus program matching).
- *Complexity:* high (free-text normalization). Runs as the final data stage; the family and role-only configurations are both supported outputs.

### S6 — Per-municipality JSON slicer → `output/tiles/…` **(serving-critical, new)**
- For each of ~1,700 municipalities, emit one JSON containing:
  - **Own nodes** (PSGC municity = M).
  - **Boundary-spanning neighbors:** any node in an adjacent municipality that is an edge-endpoint (≤5 km) of an M-node — so cross-boundary edges render. Marked `foreign:true` for styling.
  - **Edges** among included nodes (≤5 km, with `distance_km`, `transition`, `family`).
  - **Per-node** nearest-by-sector (for detail panel) + `broken_pathway` flags.
  - **Area metrics:** per-transition continuity % + plain-language band; per-layer **vintage** strings.
- **Slice policy:** 1-hop band-neighbor inclusion across municipal lines; client filters bands/layers in-browser (SPECS §2.4).
- Output layout: `output/tiles/<region>/<municity_psgc>.json` (+ gzip). Worst-case dense municipality (e.g. Quezon City) is the size/perf gate — measure and, if needed, cap rendered edges client-side (log any cap, SPECS principle).
- *Risk:* med (novel; size for dense areas). *Depends on:* S1, S3, S4.

- **Canonical names (added 2026-07-11):** region/province/municipality names in tile `meta` and the admin index are resolved from `project_coordinates/data/silver/psgc_crosswalk.parquet`, joined on the first 7 digits of the municity PSGC (region 2 + province 3 + municity 2). This fixes the dirty node-table names (casing dupes "QUEZON"/"Quezon", trailing spaces, numeric-PSGC provinces on HEI/TESDA). NCR's "province" slot is naturally the city name. 9 codes resolve via a 5-digit (province+municity) fallback for region-prefix mismatches (Sulu → BARMM); the dirty NCR placeholder `1380600` is hardcoded in `MUNI_OVERRIDES`. Resolves 1,664/1,664.

### S6.2 — Admin index → `output/tiles/admin_index.json`
- Region → province → municipality tree (canonical names + PSGC) driving the drill-down entry (§1.2). Shape: `{regions:[{region, provinces:[{province, municipalities:[{municity_psgc, name}]}]}], total_tiles, created_at}`.

### S6.3 — Administrative boundaries → `output/boundaries/*.geojson` **(serving artifact, added 2026-07-12)**

The frontend draws admin borders as a quiet visual guide (province borders for region/province views; municipality borders when drilling into cities — `frontend_design.md` §5.6).

| Script | Output | Notes |
|---|---|---|
| `dissolve_municipal_boundaries.py` | `provincial_boundaries.geojson` (118), `municipal_boundaries.geojson` (1,642) | Dissolves source polygons to ADM2 / ADM3, simplifies |
| **`clean_boundaries.py`** *(new, REQUIRED)* | rewrites both files in place | Fills spurious holes left by the dissolve |

- **⚠️ `clean_boundaries.py` must be run after any re-dissolve.** GeoPandas `.dissolve()` unions polygons whose edges are not perfectly coincident, so the hairline gaps survive as **interior rings** (Cavite 94, Laguna 78, Rizal 55 — 3,959+ in total). Drawn as a line layer, every ring renders as a broken grey line *inside* the province.
- **The test is identity, not size.** A long thin sliver can exceed any area threshold, and a lake is large but is *not* an administrative border. So: **keep a hole only if another administrative unit actually sits inside it.** Real enclaves survive (Baguio City in Benguet, Angeles City in Pampanga, Cotabato City); Taal Lake, Lake Lanao and Laguna de Bay are filled. Result: 20 holes filled, 4 enclaves kept (provincial); 9 filled, 2 kept (municipal).
- **Consumed by the frontend** as `/boundaries/<file>.geojson`, matched to the loaded tiles **by PCODE, never by name** (`ADM3_PCODE "PH0102801"` → municity key `0102801`; `ADM2_PCODE` → its first 5 digits). Name-matching would break on the very casing/NCR quirks S6 exists to canonicalise.
- Dev serving: a Vite middleware mounts `output/boundaries` at `/boundaries` with **`Cache-Control: no-store`** — a long max-age silently served stale geometry after a regeneration.

### S7 — Publish → Firebase
- Upload `output/tiles/**` **and `output/boundaries/**`** to Firebase Hosting/Storage; wire `ugnay.cair.ph`.
- GitHub Actions workflow (mirror platform_aral): build frontend, deploy hosting, sync tiles + boundaries. Detail in the ops doc; the pipeline's responsibility ends at producing `output/tiles/**` and `output/boundaries/**`.

---

## 4. Execution environment
- Runs inside the **`experiments-innovations-lab`** Docker container (numpy/pandas/scipy; per project memory). Host↔container path map: `/workspace/innovation-projects/` → `/workspace/`.
- **OSRM (`osrm-routing`, v6.0.0) is up** — available for the post-demo cross-sector upgrade; not on the demo critical path.
- Pipeline is **scripts, not notebooks** (notebooks for verification only — existing convention).

---

## 5. Sequencing toward July 16 (staged, always-demoable)

| Milestone | Days | Delivers | Demoable state | Status |
|---|---|---|---|---|
| **M1** | Jul 9–10 | S1 nodes + S2 basic-ed & cross-sector haversine | All institutions plotted nationwide | ✅ done |
| **M2** | Jul 10–12 | S3 edges (basic-ed + SHS→HEI) + S4 metrics + S6 slicer + index | Basic-ed progression + SHS→HEI, nationwide | ✅ done (data); **Firebase deploy NOT done** |
| **M3** | Jul 12–13 | TESDA role-only (nodes + SHS/HEI→provider + provider→assessment, no family) | TESDA pathway visible | ✅ done (role-only) |
| **M4** | Jul 13–14 | S5 family mapping → full two-stage | Full SPECS graph | ❌ **not started** — TESDA stays role-only; UI carries the caveat |
| **M5** | Jul 14–16 | Frontend integration, hardening, dense-area load check, buffer | Stage-ready | 🟡 in progress |

### Status as of 2026-07-12 (reconciled against reality)

- **The pipeline is done through M3.** Data stages S1–S4 + S6 are complete and verified; the frontend runs locally against the real tiles.
- **The frontend scope changed after this table was written** (SPECS Amendment A1): edges now express **accessibility**, not progression. Most of the recent work is frontend (accessibility edges, gap halos, detail drawer, admin borders, filter/appearance panel) rather than pipeline.
- **Open gaps against this plan:**
  - **S5 / M4 (TESDA qualification-family matching) — not started.** TESDA reachability stays *role-based*, which **understates** the assessment gap. The UI states this caveat explicitly.
  - **S7 / Firebase deploy — not done.** The demo currently runs on the local Vite dev server. Deploying must ship **both** `output/tiles/**` and `output/boundaries/**`.
  - **~~OSRM road distances for accessibility pairs — deferred.~~ DONE (2026-07-12).** New stage `scripts/s2b_access_distances.py` routes all accessibility pairs through OSRM (door-to-door: snap + road + snap). Baked into the tiles as `access` (≤5 km by road) and `nearest` (unbounded); the frontend no longer computes haversine. Only 53.2% of straight-line-≤5 km pairs survive as ≤5 km by road (median detour 1.41×). See Amendment A2. **Re-run order after any node change: S2b → S6.**
  - **Dense-area load check (M5) — not yet run** as a formal measurement.
- **Not in the original plan, now shipped:** `scripts/clean_boundaries.py` (S6.3) and the boundary serving path.

Frontend rebuild ran in **parallel** from Jul 9 against the M2 JSON schema (§6 is the contract).

---

## 6. Frontend contract — JSON schema

> **As-built (2026-07-11).** The shape below reflects the tiles S6 actually emits, superseding the earlier aspirational draft. Field names are verbatim.

### 6.1 Municipality tile (`<municity_psgc>.json`)
```json
{
  "meta": {"municity_psgc":"0105532", "region":"Region I (Ilocos Region)",
           "province":"Pangasinan", "municipality":"City of San Carlos"},
  "nodes": [
    {"node_id":"pub:...", "source":"public", "name":"...", "lat":.., "lon":..,
     "offers_es":true, "offers_jhs":true, "offers_shs":false,
     "shs_strand_offerings":"...",
     "hei_sector":null, "hei_is_public":null,
     "tesda_role_provider":false, "tesda_role_assessment":false,
     "esc_participating":false, "shsvp_participating":false, "jdvp_participating":false,
     "source_vintage":"...", "road_unreliable":false}
  ],
  "access": {
    "pub:..": [["pub:..", 670], ["prv:..", 1240]]
  },
  "nearest": {
    "pub:..": {"jhs":0.67, "shs":0.67, "hei":63.44, "tesda_training":44.05}
  },
  "edges": [
    {"origin_id":"pub:..","dest_id":"hei:..","transition":"SHS_HEI",
     "distance_km":3.7,"intra_node":false}
  ],
  "neighbor_nodes": [
    {"node_id":"hei:..","lat":..,"lon":..,"source":"hei"}
  ],
  "continuity": {
    "ES_JHS": {"1":{"n_origins":..,"n_reachable":..,"continuity_pct":..,"band_label":"most"},
               "2":{...}, "3":{...}, "4":{...}, "5":{...}},
    "JHS_SHS":{...}, "SHS_HEI":{...}, "SHS_TESDA_prov":{...},
    "HEI_TESDA_prov":{...}, "TESDA_prov_assess":{...}
  }
}
```
Notes:
- **`access`** (added 2026-07-12, S2b) = the ROAD-distance accessibility adjacency the frontend draws on click: `origin_id → [[dest_id, metres], …]`, sorted nearest-first, filtered to destinations offering a capability the origin lacks (token rule). Integer metres (a third the JSON size of float km). Destinations may live in other tiles; the client only draws to loaded, visible nodes.
- **`nearest`** (added 2026-07-12, S2b) = `node_id → {level: road_km}` for each level the node lacks, **unbounded/nationwide**. Drives the drawer's "nearest of each level" and the gap halos.
- **`road_unreliable`** (node field, added 2026-07-12) = institution sits >2 km from any mapped road (usually a broken coordinate); the frontend suppresses its gap halo.
- **`hei_sector`** (raw CHED class: `SUC Main/Satellite`, `LUC…`, `Private Sectarian/Non-Sectarian`) and derived **`hei_is_public`** (bool) were added 2026-07-11 to drive the higher-ed public/private filter.
- `neighbor_nodes` = edge endpoints outside this municipality (coords only), so cross-boundary edges render.
- Transition keys use `SHS_TESDA_prov` / `HEI_TESDA_prov` / `TESDA_prov_assess` (underscore form). `edges`/`continuity` remain the PROGRESSION graph (S2/S3); the accessibility feature reads `access`/`nearest`.

### 6.2 Index (`admin_index.json`)
`{regions:[{region, provinces:[{province, municipalities:[{municity_psgc, name}]}]}], total_tiles, created_at}` — canonical PSGC names (§3 S6).

**Client responsibilities (not the pipeline's):** band filtering (1–5 km via `access[][1]` metres), sector-layer + subcategory toggling (via `nodes[].source` + `offers_*` / `hei_is_public` / `tesda_role_*`), plain-language rendering of `continuity[].band_label`. See `frontend_design.md`.

---

## 7. Open items / assumptions to confirm

1. ~~**Cross-sector = haversine for the demo** (OSRM post-demo).~~ **RESOLVED — accessibility now uses OSRM road distances (S2b, 2026-07-12).** The progression graph (S2) still uses haversine, which is immaterial since the halos are derived from S2b.
2. **TESDA family taxonomy source** — is there a canonical TESDA qualification-sector list to map `program` strings against, or do we derive families by keyword clustering? (Affects S5 risk.)
3. **Data vintage strings** — exact per-layer labels to capture from project_coordinates (item #8).
4. **Slice boundary policy** — 1-hop band-neighbor inclusion proposed; confirm that's sufficient (edges never exceed 5 km, so 1-hop is complete).
5. **Firebase target** — Hosting vs Storage for the ~1,700 tiles; and the GitHub Actions secrets/service account (ops doc).
6. **Frontend workstream owner/track** — this plan assumes it runs in parallel against the frozen schema.

---

## 8. What this plan deliberately does NOT do (demo scope)
- No live backend/API (static tiles only).
- ~~No OSRM cross-sector distances (haversine placeholder).~~ **Now shipped for the accessibility feature (S2b).** The progression graph still uses haversine (immaterial — halos derive from S2b).
- No program-registration validity filtering (include-all).
- No cross-area comparison / national heatmap / i18n (post-MVP per SPECS).
- No accessibility (WCAG) commitment (open per SPECS §3.5).
