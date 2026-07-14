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
- **See every institution** on the map, encoded by sector **twice over** — by **shape** (DepEd ○ · higher-ed △ · TESDA □) and by **fill** (public vs private within each) — so the map still reads in greyscale and under colour-vision deficiency. Both are user-customisable, with a colorblind-safe preset. Administrative borders give context.
- **Click one** to see everything reachable within a **road-distance threshold** (a 1–5 km slider) that offers something it doesn't — plus a detail panel with the nearest institution of each education level.
- **Toggle Gap Analysis** to halo institutions that can't reach their next level within reach (amber = exists but too far; red = nothing nearby) — the first, honest glimpse of *progression* gaps.
- **Switch to the Network view** to see the same institutions laid out by how they **connect** rather than where they sit — and find the ones whose pathway leads nowhere (below).
- **Works on a phone**, where planners actually are: the map is full-bleed and unobstructed, with the controls in a bottom sheet you opt into.

## The question the map cannot answer

A map asks *is there a next level nearby?* — and that question flatters reality. Adams Central Elementary has a junior high **0.76 km** away, so on the map it looks fine. Its nearest university is **63 km** away and its nearest TESDA centre **44 km**: a learner starting there cannot finish **any** pathway. Nationwide, **19,934 institutions have a perfectly good next step and can never reach higher ed.**

Finding them means walking the whole chain — ES → JHS → SHS → higher ed, and SHS → tech-voc training → assessment — and the two pathways are tracked separately, because a school that can reach a training centre but no university is complete on one and cut on the other.

The **Network view** drops geography and lets a force layout place institutions by their connections instead. An institution whose pathway goes nowhere has nothing pulling it inward, so it drifts to the edge and you find it without being told where to look.

## How it works

A batch pipeline turns four coordinate datasets into small per-area map tiles the web app loads directly. There is **no live backend** — the app is static files plus precomputed data, which keeps it cheap to host and simple to reason about.

| Stage | What it does |
|---|---|
| **S1** | Assemble ~66K institutions from the four sectors into one table with capability tokens (offers ES/JHS/SHS, is HEI, is TESDA trainer/assessor). |
| **S2 / S2b** | Route distances through **OSRM** (OpenStreetMap road network). `S2b` computes door-to-door road distance for every pair within reach — the numbers the map draws. |
| **S3 / S4** | Derive progression edges and per-institution / per-area gap metrics. |
| **S6** | Slice everything into one JSON tile per municipality (+ an area index and cleaned admin boundaries) — the served artifact. |
| **S7** | Walk the whole progression chain — can a learner starting here actually *reach* a university, or an assessment centre? Answered nationwide, because a chain can leave the area you are looking at. |

The frontend is a **Vite + React + MapLibre** app that reads those tiles, with the Network view drawn on a canvas and its force layout run in a worker (`d3-force`). Every distance it shows is a precomputed road distance; institutions plotted off the road network are flagged so a bad coordinate never masquerades as a real gap.

Roughly 66,000 institutions: ~47.6K DepEd public, ~8.3K DepEd private, ~2.4K CHED campuses, ~7.9K TESDA centers.

## Repository layout

```
scripts/         Pipeline stages (s1…s7, s2b, boundary cleaning)
modules/         Shared pipeline logic (OSRM client, distance lookup, aggregation)
platform/frontend/   The web app (Vite + React + MapLibre)
tests/e2e/       Playwright runner for TESTS.md (41 browser scenarios)
.github/workflows/   Push-to-`main` deploys the frontend to Firebase Hosting
documentation/   Design and decision records (see below)
output/          Generated data — tiles, boundaries, matrices (gitignored)
```

## Documentation

The design rationale lives in `documentation/`:

- **[SPECS.md](documentation/SPECS.md)** — product and engineering decisions, with the reasoning preserved as a Q&A record. **Read the Amendments block first** — it overrides parts of the body.
- **[pipeline_implementation_plan.md](documentation/pipeline_implementation_plan.md)** — the S1–S6 pipeline, tile schema, and build sequence.
- **[frontend_design.md](documentation/frontend_design.md)** — the map's interaction model, node grammar, mobile design, and round-by-round change log.
- **[deployment.md](documentation/deployment.md)** — the as-built deployment runbook: architecture, the Firebase pitfalls we hit, CI, and how to deploy / re-seed / roll back / verify.

At the repo root:

- **[TESTS.md](TESTS.md)** — the end-to-end test scenarios, and the traps that make map tests silently lie. Run them with `cd tests/e2e && npm install && npm run test:prod`.
- **[CHANGELOG.md](CHANGELOG.md)** — what changed, per deploy.

## Status

**Live** at **https://ecair-eics-project.web.app** (Firebase Hosting; custom domain `ugnay.cair.ph` pending). A push to `main` that touches the frontend rebuilds and redeploys automatically — see `documentation/deployment.md`.

The pipeline and frontend run end-to-end against the nationwide dataset, ahead of an internal demo (**July 2026**).

The previous single-sector build (a DepEd-only school connectivity network with an edge/metrics/dense-matrix focus) is preserved on the **`old_build`** branch.

## See also

- **[project_coordinates](../project_coordinates)** — the coordinate pipeline that feeds Ugnay all four sectors.
- **[project_paaral](../project_paaral)** — student-flow modeling that consumes this distance network.

## AI disclosure

Developed with substantial assistance from **Claude** (Anthropic) as a coding and technical-writing partner — pipeline and frontend implementation, design iteration, and documentation. All domain judgment (DepEd/CHED/TESDA structure, what a planner needs, how to read the data) was directed by the human author.
