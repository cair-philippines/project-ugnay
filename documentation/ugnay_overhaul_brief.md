# project_ugnay — Overhaul Brief

This document captures the current state of project_ugnay, the expanded scope for the overhaul, the spatial relationships the platform should surface, key pipeline decisions that must be resolved before implementation, and open questions for the platform specification phase.

Platform architecture and deployment are intentionally left open-ended here. Those decisions will be codified in a separate `SPECS.md` produced through a dedicated Q&A process.

---

## 1. Current State

### What exists

project_ugnay is a nationwide school-to-school road distance network for Philippine basic education institutions, with a precomputed metrics layer and a partially built web platform.

**Phase 1 — Sparse Edge Network (complete)**

A road distance graph covering ~56K schools within a 20 km road cutoff, computed via OSRM (car profile) and a 30 km haversine KDTree pre-filter. Edges are stored as a directed Parquet table.

| Statistic | Value |
|---|---|
| Schools in network | 55,864 (47,607 public + 8,257 private) |
| Total edges | 9,880,546 |
| Within-region edges | 8,615,334 |
| Cross-region edges | 1,265,212 |
| Isolated schools | 707 |
| OSRM-computed schools | 55,580 |
| OSRM-failed | 2 |
| Not attempted | 589 |
| Edge table size | ~128 MB Parquet |

Parameters: 20 km road cutoff, 30 km haversine pre-filter, car profile, all 18 DepEd regions including NIR and BARMM.

**Phase 2 — Accessibility Metrics (complete)**

Per-school metrics derived from the edge table, covering neighbor counts at 5/10/20 km bands, nearest-school distances by sector (private, ESC, JHS, SHS), desert flags, and composite isolation scores. Three admin-level aggregations (municipal: 1,707 rows; provincial: 127 rows; regional: 18 rows).

Key findings:
- 30.8% of public schools in private deserts (no private school within 10 km road)
- 40.6% in ESC deserts (no ESC school within 10 km road)
- Median distance to nearest private: 4.0 km
- Median distance to nearest ESC: 5.2 km

**Dense Matrix (complete)**

Full N×N float32 distance matrix (11,968 × 11,968, ~546 MB `.npy`) built from the sparse edges for downstream O(1) pair lookup. Used by project_paaral for NBR model training.

**Platform stub (partially built)**

A `platform/` directory contains a functional FastAPI backend (`main.py`, `data_loader.py`) and a React frontend scaffold (`App.jsx`, `components/`, `hooks/`). The backend loads school metrics, the full edge table, and aggregations at startup. It exposes endpoints for school listing/filtering, single-school detail + neighbors, aggregations by admin level, and GeoJSON boundaries. The frontend is scaffolded but not production-complete.

The platform is currently **DepEd-only** — it has no awareness of CHED or TESDA institutions.

### What does not exist

- Multi-sector institution coverage (CHED, TESDA)
- Cross-sector spatial relationship queries (e.g., "nearest HEI to a given high school")
- Road distance network for CHED and TESDA institutions
- A completed, deployable frontend

---

## 2. Expanded Scope

The overhaul extends project_ugnay from DepEd-only to all three sectors of Philippine education: basic education (DepEd), higher education (CHED), and technical-vocational (TESDA).

### Institution counts

| Sector | Institutions | Source file |
|---|---|---|
| DepEd public | 47,607 | `project_coordinates/data/gold/public_school_coordinates.parquet` |
| DepEd private | 8,257 | `project_coordinates/data/gold/private_school_coordinates.parquet` |
| CHED (HEI campuses) | 2,321 | `project_coordinates/data/gold/hei_coordinates.parquet` |
| TESDA | 8,007 | `project_coordinates/data/gold/tesda_coordinates.parquet` |
| **Total** | **~66,192** | |

All four gold parquets are production-ready outputs of project_coordinates pipelines. No additional preprocessing is required to make them platform-eligible.

### Coordinate quality by sector

| Sector | Coordinate basis | Status flags available |
|---|---|---|
| DepEd public | Validated pipeline with multi-source trust levels | `coord_status`, `coord_rejection_reason`, `coord_source` |
| DepEd private | TOSF-reported coordinates; unreliable excluded | `coord_status` |
| CHED | Official CHED data; treated as authoritative | None (all valid) |
| TESDA | Official TESDA data; ~108 out-of-bounds excluded | None (cleaned in pipeline) |

CHED and TESDA coordinates are treated as authoritative. Coord-status overlays and suspect flags are DepEd-only concerns.

---

## 3. Spatial Relationships to Surface

The platform's value is not institution location alone — Piring already covers that. project_ugnay's distinct contribution is **connectivity**: what is accessible from where, across sectors.

The following spatial relationships are candidates for the platform. Priority and threshold values are open questions (Section 5).

### 3.1 Intra-sector (basic education, existing)

- Road distance to nearest neighbor by sector: private, ESC-participating, JHS, SHS
- Desert flags: private desert, ESC desert, JHS desert, SHS desert
- Isolation score: weighted inverse of neighbor density
- Admin-level aggregations of desert prevalence and median distances

These already exist in the metrics layer and can be surfaced directly.

### 3.2 Cross-sector: basic ed → higher ed proximity

- Distance from each senior high school (SHS) to the nearest CHED campus, by type (SUC vs private HEI)
- Distance from each SHS to the nearest TESDA institution
- "HEI desert" flag: senior high schools with no HEI campus within a threshold road distance
- "TESDA desert" flag: schools with no TESDA institution within a threshold distance

These require new computation. See Section 4 on network extension.

### 3.3 Cross-sector: coverage footprints

- For a given HEI campus: which schools fall within its 10 km / 20 km / 30 km road catchment?
- For a given TESDA institution: which schools are within a reasonable commute distance?
- For a given municipality: how many HEI campuses and TESDA institutions are road-accessible from its schools?

### 3.4 Admin-level summaries (extended)

The existing municipal/provincial/regional aggregations cover DepEd metrics only. The overhaul should extend these to include:
- HEI campus count per municipality, nearest HEI distance (median / min), HEI desert rate
- TESDA institution count per municipality, nearest TESDA distance, TESDA desert rate

These can be precomputed at pipeline time and served from static aggregation files, following the same pattern as the existing Phase 2 aggregations.

---

## 4. Network Extension Decision

The current road distance network covers DepEd schools only. Extending it to CHED and TESDA requires a deliberate decision because the cost and approach differ significantly across options.

### Option A — Full OSRM extension

Re-run the Phase 1 pipeline with CHED and TESDA institutions added to the school pool. This produces road distances between all ~66K institutions (all pairs within 20–30 km).

- **Pros:** consistent with the existing network methodology; all cross-sector distances are road-based
- **Cons:** requires OSRM to be running; adds ~10K institutions to the network; edge table growth is significant (from ~10M to potentially 20M+ edges depending on institution density)

### Option B — Haversine approximation for CHED/TESDA

Keep the existing DepEd edge network intact. For CHED and TESDA proximity queries, compute haversine distances on the fly (or precomputed into a separate lighter table).

- **Pros:** no OSRM re-run; CHED and TESDA institutions are sparser (~10K total) so haversine is less misleading than for dense school networks; faster to implement
- **Cons:** haversine underestimates real travel distance, especially in mountainous provinces and island gaps; inconsistent methodology across sectors

### Option C — Hybrid

Keep OSRM edges for DepEd–DepEd and DepEd–CHED/TESDA pairs (route from a school to its nearest HEI/TESDA institutions), but compute CHED–CHED and TESDA–TESDA pairs via haversine since those cross-sector edges have no current analytical use case.

- **Pros:** road accuracy where it matters most (school → post-secondary proximity); avoids a full re-run of the OSRM pipeline
- **Cons:** adds implementation complexity; requires OSRM for the DepEd→HEI/TESDA pairs but not for HEI↔TESDA

### Recommendation

Option B (haversine for CHED/TESDA) is the pragmatic starting point. CHED campuses are sparse enough (~2.3K) that haversine error is acceptable for a first-pass "nearest HEI" metric. TESDA is denser (~8K) but also geographically distributed. If road accuracy for cross-sector proximity proves important after the initial platform launch, Option C can be layered in without invalidating the existing DepEd edge network.

The final call on this should be made in the SPECS.md process.

---

## 5. Platform Architecture and Deployment

**Deferred to SPECS.md.**

The platform stub in `platform/` provides a starting point: FastAPI backend, React frontend scaffold, deck.gl dependency declared in the frontend. The overhaul will define the full frontend feature set, data loading strategy, map library choice, and deployment target through a separate specification process.

Key inputs the SPECS.md process should address:
- Which spatial relationships from Section 3 are in scope for the MVP?
- What does "showing spatial relationships" mean in the UI — map overlays, catchment polygons, edge lines, choropleth, or a combination?
- Should this replace or coexist with Piring (the institution locator)?
- What is the target user — DepEd central planner, regional office, or general public?

---

## 6. Open Questions

These are unresolved items that affect pipeline design, data choices, or platform scope. They should be addressed before or during the SPECS.md process.

| # | Question | Why it matters |
|---|---|---|
| Q1 | What road distance threshold should define "accessible" for HEI and TESDA? (10 km? 20 km? 30 km?) | Drives desert flag definitions and aggregation thresholds |
| Q2 | Should BARMM institutions be included? BARMM is absent from the AY 2024-2025 CHED file and has OSM road coverage gaps. | Affects completeness claims and whether BARMM should appear in aggregation outputs |
| Q3 | Is ferry connectivity in scope? | Sea-separated schools currently appear isolated; ferry-accessible HEIs would require a separate routing layer |
| Q4 | Should the HEI proximity analysis use all CHED campuses or only SUC/LUC (public)? | Relevant if the policy question is about public HEI access specifically |
| Q5 | Does the platform need to show the edge network as visible lines on the map, or only the derived metrics (desert flags, distances)? | Major frontend complexity difference; rendering 10M edges requires aggressive culling or pre-aggregation |
| Q6 | Should this app replace Piring, absorb it, or live alongside it? | Determines scope of the institution-locator layer in the new platform |
