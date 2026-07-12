# Ugnay — Philippine Cross-Sector Education Access Map

**"Ugnay"** means *connection* in Filipino.

Ugnay is a map-based planning tool that shows what a learner can actually **reach** across the three sectors of Philippine education — basic education (DepEd), higher education (CHED), and technical-vocational (TESDA) — measured by real **road distance**, not straight lines.

## Why

The country has coordinates for roughly 66,000 education institutions, but they live in three separate agencies and no tool answers the question a planner actually asks: *from a given place, what is within reach — and where does the pathway break?*

- A senior high school with no college or TESDA provider nearby is a **dead end** for its graduates, even if the school itself looks fine on a map.
- Straight-line distance flatters reality. In an archipelago, a school "3 km away" across a strait or ridge can be 30 km by road — and only **53%** of institution pairs within 5 km as the crow flies are still within 5 km once you drive it.
- Locating institutions is already solved (by *Piring*). Ugnay's distinct contribution is **connectivity**: what connects to what, across sector boundaries.

**Who it's for:** central- and regional-office planners at DepEd, CHED, and TESDA — domain experts, but **not** GIS or data specialists. Ugnay is a cross-agency situational-awareness tool, not a consumer app, so its language stays plain and its interaction stays simple.

## What it does

- **Pick an area** the way a planner thinks — region → provinces → cities/municipalities.
- **See every institution** on the map, colored by sector (DepEd public/private, CHED public/private, TESDA), with administrative borders for context.
- **Click one** to see everything reachable within a **road-distance threshold** (a 1–5 km slider) that offers something it doesn't — plus a detail panel with the nearest institution of each education level.
- **Toggle Gap Analysis** to halo institutions that can't reach their next level within reach (amber = exists but too far; red = nothing nearby) — the first, honest glimpse of *progression* gaps.

The deeper goal is educational **progression** — tracing whether a learner can move ES → JHS → SHS → HEI/TESDA without hitting a wall. The current build surfaces the accessibility half of that story; the progression-pathway rendering is designed and deferred to after the first demo.

## How it works

A batch pipeline turns four coordinate datasets into small per-area map tiles the web app loads directly. There is **no live backend** — the app is static files plus precomputed data, which keeps it cheap to host and simple to reason about.

| Stage | What it does |
|---|---|
| **S1** | Assemble ~66K institutions from the four sectors into one table with capability tokens (offers ES/JHS/SHS, is HEI, is TESDA trainer/assessor). |
| **S2 / S2b** | Route distances through **OSRM** (OpenStreetMap road network). `S2b` computes door-to-door road distance for every pair within reach — the numbers the map draws. |
| **S3 / S4** | Derive progression edges and per-institution / per-area gap metrics. |
| **S6** | Slice everything into one JSON tile per municipality (+ an area index and cleaned admin boundaries) — the served artifact. |

The frontend is a **Vite + React + MapLibre** app that reads those tiles. Every distance it shows is a precomputed road distance; institutions plotted off the road network are flagged so a bad coordinate never masquerades as a real gap.

Roughly 66,000 institutions: ~47.6K DepEd public, ~8.3K DepEd private, ~2.4K CHED campuses, ~7.9K TESDA centers.

## Repository layout

```
scripts/         Pipeline stages (s1…s6, s2b, boundary cleaning)
modules/         Shared pipeline logic (OSRM client, distance lookup, aggregation)
platform/frontend/   The web app (Vite + React + MapLibre)
documentation/   Design and decision records (see below)
output/          Generated data — tiles, boundaries, matrices (gitignored)
```

## Documentation

The design rationale lives in `documentation/`:

- **[SPECS.md](documentation/SPECS.md)** — product and engineering decisions, with the reasoning preserved as a Q&A record.
- **[pipeline_implementation_plan.md](documentation/pipeline_implementation_plan.md)** — the S1–S6 pipeline, tile schema, and build sequence.
- **[frontend_design.md](documentation/frontend_design.md)** — the map's interaction model, accessibility semantics, and round-by-round change log.

## Status

Targeting an internal demo (**July 2026**) on a nationwide dataset. The pipeline and frontend run end-to-end against real data; public deployment is the next step.

The previous single-sector build (a DepEd-only school connectivity network with an edge/metrics/dense-matrix focus) is preserved on the **`old_build`** branch.

## See also

- **[project_coordinates](../project_coordinates)** — the coordinate pipeline that feeds Ugnay all four sectors.
- **[project_paaral](../project_paaral)** — student-flow modeling that consumes this distance network.

## AI disclosure

Developed with substantial assistance from **Claude** (Anthropic) as a coding and technical-writing partner — pipeline and frontend implementation, design iteration, and documentation. All domain judgment (DepEd/CHED/TESDA structure, what a planner needs, how to read the data) was directed by the human author.
