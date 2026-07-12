# project_ugnay — SPECS

**Status:** Draft complete + review pass resolved (10 items) — ready for implementation planning. Ops/deployment still deferred to a separate document.
**Companion documents:** `ugnay_overhaul_brief.md` (scope & current state). Ops/deployment intentionally deferred to a separate document.

This specification is built through a themed Q&A process. Each answer below is recorded verbatim (paraphrased where noted) alongside the question that produced it, so the reasoning behind every decision is traceable.

Batches:
1. Product & UX — *complete*
2. Data & Engineering — *complete*
3. Delivery & Success (non-ops) — *complete*

---

## ⚠️ Amendments (post-spec decisions that override parts of this document)

The Q&A below is preserved **verbatim** — it is the reasoning record, and later decisions did not erase it. But several answers have since been **overridden for the demo**. Where that happens, the affected section carries an inline `⚠️ AMENDED` note. Read this list first.

### A1 — Edges now express ACCESSIBILITY, not progression (2026-07-12) — **overrides §1.2 (edge visibility rule), §1.6, §1.9**

Stakeholder decision while reviewing the working platform:

- **Edges are proximity, not progression.** Clicking an institution draws an edge to every institution **within the distance threshold that offers at least one level/sector it does not** (capability tokens: `ES · JHS · SHS · HEI · TESDA-training · TESDA-assessment`). There is no directional ES→JHS→SHS→HEI/TESDA rendering.
- **Progression is DEPRIORITISED to post-demo.** The progression-edge design (§1.6, §2.1) is *not discarded* — the pipeline still computes progression edges, and the full progression-rendering design is preserved in `frontend_design.md` §5A, ready to resume after the demo.
- **The 1–5 km preset bands survive** (§1.6) — now as a **user-facing slider** governing both the accessibility edges and the gap halos. (§1.6 anticipated this question and left it open; the answer is: user-adjustable, in 1 km presets.)
- **§1.9's "broken pathway" flag survives** as the **Gap Analysis layer** (amber/red halos) — this is the one place progression logic still surfaces. Its area-level continuity % is computed by the pipeline but **not yet surfaced in the UI**.
- **§1.2's edge-visibility rule ("an edge shows only when both endpoints' layers are on") no longer applies** — edges are drawn on selection, scoped by the threshold and the filter panel.

**Canonical frontend design → `frontend_design.md` §5.**

### A2 — Distances are ROUTED ROAD DISTANCES (OSRM) — RESOLVED 2026-07-12

§2.2 committed to OSRM as the end state and haversine as the MVP placeholder. **This is now done: accessibility distances are routed road distances (OSRM), not haversine.** The earlier "straight-line for the demo, OSRM deferred" state (this amendment's original text) is superseded.

- New pipeline stage **`scripts/s2b_access_distances.py`** routes every institution pair through the OSRM `/table` service and bakes the result into the tiles. The frontend no longer measures anything — `lib/graph.js` reads the precomputed adjacency.
- Two outputs: **`pairs_access`** (every pair ≤5 km by road — the edges; complete and exact) and **`nearest_by_level`** (nearest institution of each level a node lacks, **unbounded/nationwide** — the drawer's "nearest of each level" panel and the gap halos).
- **Why straight-line flattered reality:** of all pairs within 5 km straight-line, only **53.2%** are still within 5 km once routed by road; median detour **1.41×**.
- **Distance is door-to-door** (`snap_origin + road + snap_dest`). OSRM measures between road-snapped points, which alone produced 41,120 pairs shorter than a straight line (impossible); adding the snap legs makes road ≥ straight-line by the triangle inequality, asserted in-script (final impossible count: 0).
- **`road_unreliable` flag:** 2,311 institutions sit >2 km from any mapped road (usually a broken coordinate — several "valid" ones plot in open sea). Their gap halos are suppressed, since a false red dot reads as a real accessibility gap.
- **Pre-filter note (vs §2.6's 20 km):** the 20 km pre-filter still governs the progression-edge table (S2). S2b deliberately differs — edges are capped at the 5 km slider max (routing farther is unusable), while `nearest_by_level` is unbounded (better than a 20 km cap, which would hide a 63 km nearest HEI as "—").

### A3 — HEI is treated as terminal (2026-07-12)

The pipeline emits an `HEI_TESDA_prov` ("reskilling") transition, but the frontend **ignores it**: HEIs radiate no edges and are never gap-flagged. This narrows §2.1's edge set for the demo. Revisit post-demo.

### A4 — Node grammar is SHAPE + fill; mobile is a distinct chrome; one accessibility rule is now committed (2026-07-12) — **refines §3.5**

Three decisions taken while making the deployed platform usable on a phone.

**1. Sector is encoded twice — shape *and* fill.** Colour alone fails in greyscale print and under colour-vision deficiency, where the five fills can collapse into two or three. Nodes now carry a **shape** as a redundant channel (circle / square / triangle / diamond), user-settable per swatch. The default carries meaning rather than decoration: **shape = sector** (DepEd ○ · higher-ed △ · TESDA □), **fill = public/private within it**. The colorblind (Okabe–Ito) preset remains.
- This does **not** revive the round-1 *arc grammar*, which was rejected as too noisy: arcs encoded **capabilities** (up to three sub-levels per pin). Shape encodes the **sector** — five buckets, readable at a glance, no extra marks on the pin. Capabilities remain filters, not glyphs.
- Implementation and its two silent failure modes (SDF encoding; `setStyle` dropping every added image on each basemap switch) → `frontend_design.md` §3.

**2. §3.5's "mobile-first" is now actually met.** It had been asserted, not built: the phone view was the desktop view at 390px — the top bar's controls ran off the right edge and two floating panels covered the map. Mobile (<640px) is now a **different chrome, not a smaller one**: a slim header; the sector toggles, gap analysis and basemap moved into **one bottom sheet** (collapsed by default, so the map is unobstructed on arrival); the Legend is a tab inside it; the detail view is a **full-width bottom sheet** and the map pans **up** to clear it. → `frontend_design.md` §6A.
- **The map attribution must remain visible** (CARTO / OSM / Esri require it) — it is lifted clear of the sheet along with the zoom controls. This is a licensing constraint, not a cosmetic one.

**3. §3.5 says accessibility is "not committed (open)". One rule is now committed:** *no `aria-hidden` container may contain focusable controls.* A collapsed panel that is merely clipped keeps its checkboxes and buttons in the tab order and the a11y tree, so a keyboard or screen-reader user lands inside a panel that, as far as they've been told, does not exist. All collapsibles and the closed detail drawer are `inert`. Enforced by test T1.2. `prefers-reduced-motion` is also honoured. Broader accessibility remains open. → `frontend_design.md` §6B.

---

## 1. Product & UX

### 1.0 Audience correction (foundational)

The overhaul brief and the opening of this Q&A framed the user as "non-education / general public." **This was corrected during the Q&A:** the platform is for **central- and regional-office personnel at DepEd, TESDA, and CHED** who are **non-technical** (no GIS/data fluency assumed). This makes project_ugnay a **cross-agency planning & situational-awareness tool**, not a consumer app. Consequences:
- Planner-oriented concepts (accessibility, gaps) are legitimately in-audience.
- The UI must still assume zero technical fluency — plain language, low interaction complexity.
- This supersedes brief Section 5's open target-user question.

### 1.1 Primary job-to-be-done

**Q:** Now that the users are cross-agency planners, what primary decision or task should the tool support?
**A:** **Situational awareness** + **Spotting underserved areas.**
- The tool is a *reference and gap-finding* instrument, not a coordination/workflow system.
- Primary value: "what does the education ecosystem in this area look like, and where are the access gaps?"
- Inter-agency coordination and cross-sector continuity are *supporting* lenses, not the core workflow.

### 1.2 Entry point & scoping

**Q:** When the user first opens the app, how should they arrive at "an area of their choice"?
**A:** **Admin drill-down** — region → province(s) → municipality/ies — **plus a sector-layer control.**
- Entry is structured/hierarchical, appropriate for planners who think in admin units.
- Sector scoping is a first-class control, not a buried filter.

**Geographic selection — two terminal modes (added post-review):**

The province and municipality pickers are both **multi-select**, but the combination determines which level becomes the terminal view:

| Province selection | Municipality picker | Terminal |
|---|---|---|
| **2 or more provinces** | **Deactivated** | **Provincial** — all institutions across all selected provinces load; the municipality picker is disabled because the scope is already defined at province level |
| **Exactly 1 province** | **Active** — multi-select, 1 to all municipalities within that province | **Municipal** — only the selected municipalities load |

- **Region** remains single-select (outer boundary; you cannot span regions).
- A "select all provinces" affordance should be present for planners who want region-wide visibility.
- **Provincial terminal and payload:** loading multiple provinces simultaneously means the frontend fetches municipality tiles for every municipality in each selected province — more tiles, same per-municipality format (§2.4). Dense multi-province selections (e.g. all of Region IV-A including Cavite + Laguna + Batangas) represent the worst-case payload scenario; this must be validated during the prototype alongside the single worst-case municipality check (§2.4).

**Q:** How is the sector-layer control structured? (resolved — item #7)
**A:** **Three independent, freely combinable layer toggles: Basic-ed · Higher-ed · Tech-voc.** Not fixed presets.
- Nodes: a sector's institutions appear when its layer is on.
- **Edge visibility rule:** a progression edge shows **only when both of its endpoints' layers are on** — e.g. SHS→HEI needs Basic-ed **and** Higher-ed; HEI→TESDA-provider needs Higher-ed **and** Tech-voc; ES→JHS needs only Basic-ed; the TESDA provider→assessment step needs Tech-voc.
  - > ⚠️ **AMENDED (A1, 2026-07-12).** This edge-visibility rule **no longer applies** — edges now express *accessibility*, are drawn on node selection, and are scoped by the distance-threshold slider + filter panel. The three sector-layer toggles still govern **node** visibility. See Amendments §A1.
- This supersedes the earlier "basic-ed only / basic + higher / ~4 scopes" phrasing (§2.4) — there is no fixed scope enumeration; scope is the on/off combination of the three layers. A CHED user can view Higher-ed alone; a TESDA user Tech-voc alone.

### 1.3 How the road-distance differentiator is surfaced

**Q:** What is the primary on-screen expression of road-distance networking in the MVP?
**A (nuanced — no single option chosen):** The literal **network/edge display is an *optional* view, not the default canvas.** The road-distance differentiator therefore lives in two layers:
1. **Underlying** — road distance powers the metrics (nearest-by-road, pathway continuity). Always on, implicit.
2. **Optional overlay** — an explicit node-and-edge network graph the user can switch on. Nodes are connected to each other using a **road-distance threshold between a minimum of 1 km and a maximum of 5 km** (an arbitrary band chosen so the graph is legible rather than a hairball).

Open follow-ups this raised: what the *default* (non-network) view is (resolved in §1.5), and whether the 1–5 km threshold is a fixed value or a user-adjustable control (resolved in §1.6).

### 1.4 Metric framing for non-technical planners

**Q:** How should accessibility metrics (currently planner jargon: desert flags, isolation scores) be presented?
**A:** **Pathway-continuity focus** as the most accessible/primary metric layer, with **reframed plain-language** details revealed when inspecting a node (e.g. opening a school node shows plain-language accessibility info rather than raw jargon).
- Lead with the progression story (school → SHS → college/TESDA reachability), not per-sector "desert" flags.
- Technical terminology is demoted to detail views / tooltips, phrased plainly.

### 1.5 Default view & basemaps

**Q:** What is the default (primary) view on landing in a chosen area?
**A:** **Map + institution pins**, with:
- A **basemap toggle**: simple/plain map, satellite imagery, and a road-highlighting map.
- A **visually accessible "Summary"** element that helps the user interpret the ecosystem (counts, gaps, pathway-continuity read-out) — a first-class aid, not buried.
- Institutions plotted as pins (styled by sector); node detail on tap/click. **The detailed node-visualization rules that refine this line — and their evolution (e.g. the arc grammar → filter-panel pivot) — live in `frontend_design.md`.**

**Q:** Compare areas, or one at a time?
**A:** **One region at a time.** Cross-region comparison and national heatmaps are out of MVP scope. Within a chosen region, the user may select multiple provinces or (within a single province) multiple municipalities — the scope is flexible, but always bounded by one region (§1.2 geographic selection).

### 1.6 The network is a PROGRESSION graph, not a proximity graph (foundational)

> ⚠️ **AMENDED (A1, 2026-07-12) — this section is REVERSED for the demo.** The rendered network is now a **proximity (accessibility) graph**: edges connect institutions within the distance threshold that offer something the selected one lacks. **Progression is deprioritised to post-demo**, though the pipeline still computes progression edges and they still drive the Gap Analysis halos (§1.9). The **1–5 km bands survive as a user-facing slider** — which answers the question this section left open. The progression-rendering design is preserved in `frontend_design.md` §5A for when it resumes. Everything below remains the reference for that work.

**Q:** How is the 1–5 km connection threshold controlled?
**A:** **Preset bands of 1, 2, 3, 4, and 5 km** road distance (not a continuous slider). **But** node connections are governed by **educational-progression relational rules**, not distance alone. Edges represent *"a learner completing one level here could progress to the next level there, within the chosen road-distance band."*

Stated rules:
- **Basic + Higher scope:** connect basic-ed schools offering **Grade 11–12 (SHS)** → **higher-education institutions (HEIs)**.
- **Basic-only scope:** hierarchical progression —
  - schools offering **Grade 1–6 (elem)** → schools offering **Grade 7–10 (JHS)**,
  - schools offering **Grade 7–10 (JHS)** → schools offering **Grade 11–12 (SHS)**.
- **Self-connection:** an integrated school that offers multiple levels satisfies the progression *within itself* ("connected or self-connected"). So progression can be intra-node, not only inter-node.

**Design implications (carry into Data & Engineering):**
- A node is a **school/institution that may offer several grade levels**; progression edges depend on **grade-offering data per school**, not just coordinates. Level classification (elem / JHS / SHS) is a required feature.
- Edge generation is **scope-dependent** — the sector toggle changes which progression rules fire and therefore which edges exist.
- This unifies the differentiator with the §1.4 metric framing: the road-distance network *is* the pathway-continuity model.
- **Unresolved (opens Batch 2):** where **TESDA** sits in the progression rules (SHS→TESDA? JHS→TESDA?); whether SHS connects to both HEI and TESDA; and how integrated/self-connecting schools are modeled in the graph.

### 1.7 Product/UX — settled summary

- **Users:** non-technical planners at DepEd, TESDA, CHED (central & regional).
- **JTBD:** situational awareness + spotting underserved areas; one region at a time.
- **Entry:** admin drill-down (region → province(s) → municipality/ies) + sector-scope toggle. Two terminal modes: provincial (2+ provinces → municipality picker off) or municipal (1 province → municipality multi-select). See §1.2.
- **Default view:** pin map (3 basemaps) + always-available Summary aid.
- **Differentiator:** progression network (grade-level rules) over road distance, shown as an optional overlay with 1–5 km preset bands; also powers metrics implicitly.
- **Metric voice:** pathway-continuity first; plain-language details on node inspection.

### 1.8 Pathway-continuity metric — definition (resolved)

**Q:** What is "pathway continuity" computationally?
**A:** **Stepwise reachability, rolled up to area level, school-count based (unweighted).**

- **Per-node (stepwise):** for each progression transition a node participates in *as an origin* — ES→JHS, JHS→SHS, SHS→HEI, SHS→TESDA-provider, HEI→TESDA-provider, and TESDA-provider→assessment (program-family matched, §2.7) — a boolean = *is at least one valid next-level target reachable within the selected band?* Reachability is satisfied by an inter-node edge **or** an intra-node self-edge (integrated school, or a TESDA `Both` site for the train→assess step).
- **Per-area (rollup):** for each transition, the **percentage of origin institutions in the area that have the next level reachable** — reported per transition (so planners see *which* step breaks), not merged into one score.
- **Unweighted:** each institution counts once; no enrollment weighting (avoids an enrollment-data join; a tiny and a large school count equally — accepted trade-off).
- This definition is the computational basis for the gap/underserved criterion (§1.9).

### 1.9 Underserved / gap criterion — definition (resolved)

> ⚠️ **PARTIALLY AMENDED (A1, 2026-07-12).** The **node-level "broken pathway" flag SHIPPED** — as the **Gap Analysis layer**: a toggleable analysis layer (off by default) that halos non-terminal institutions **amber** (next level exists, but beyond the threshold) or **red** (none within 5 km). This is the one place progression logic still surfaces. Two deltas: (a) the **area-level continuity % / plain-language band is computed by the pipeline but NOT yet surfaced in the UI**; (b) TESDA matching is **role-based only** — it does not yet check the qualification family trained for, so the gap is *understated* (M4/S5). See `frontend_design.md` §5.4.

**Q:** How is an area judged "underserved" at a given transition, and at what level is the gap shown?
**A:** **Continuity % + plain-language band (no hard binary), surfaced at BOTH node and area level.**

- **Node level — "broken pathway" flag:** a node that offers a transition's origin level but has **no reachable next-level target within the selected band** is flagged as a broken/stranded pathway at that step. Lets planners see exactly which institutions are the problem.
- **Area level — plain-language band:** the per-transition continuity % (§1.8) is translated into plain words rather than a brittle threshold verdict — e.g. *"most / many / few / no schools here can reach the next level."* This deliberately avoids a fixed binary cutoff, which is fragile because continuity is band-dependent (§2.5).
- **Provisional band cut-points (display tuning, not analysis — adjustable during prototype):** ≥75% = "most", 40–74% = "many", 1–39% = "few", 0% = "none".
- **No user-set threshold and no interactive cross-area comparison** (consistent with "one area at a time"). A *precomputed national baseline* per transition may be added later as a "worse/better than typical" reference (deferred — see §2.6 open note), but is not the MVP criterion.

### 2.0 Data grounding (verified inventory)

Before deciding anything, the four project_coordinates gold parquets and the existing ugnay metrics layer were inspected. Confirmed facts that ground this batch:

**Grade-level offerings exist as booleans** on both public and private schools — this is what makes the progression graph buildable:
- `offers_es` (elementary / G1–6), `offers_jhs` (G7–10), `offers_shs` (G11–12), plus `shs_strand_offerings`.
- Multiple flags True ⇒ an integrated school ⇒ intra-node self-connection is directly computable.
- Source: `public_school_coordinates.parquet` (48,254 rows), `private_school_coordinates.parquet` (12,167 rows).

**Sector / program classification available:**
- Public vs private: assigned in `modules/coordinates.py` (`sector="public"/"private"`).
- Private program flags: `esc_participating`, `shsvp_participating`, `jdvp_participating`.
- HEI: `sector` field distinguishes public (SUC/LUC) vs private. ID = `uii_code`, name = `name`. 2,321 rows.
- TESDA: `type_of_institution`, `classification`, `institution_classification`. ID = `tesda_inst_id`. 8,007 rows.

**Existing assets we reuse rather than rebuild:**
- The sparse edge table already holds **DepEd↔DepEd road distances ≤20 km** (~9.88M edges). All basic-ed progression bands (1–5 km) are a filtered subset — **no recompute needed for school↔school**.
- Per-school metrics already precomputed: `output/metrics/school_accessibility.parquet` (55,864 rows) + municipal/provincial/regional aggregations.

**Known integration cost:** HEI (`uii_code`) and TESDA (`tesda_inst_id`) use different ID/name columns than schools (`school_id`/`school_name`). Cross-sector edges require an ID-harmonization step. HEI and TESDA currently have **no road edges at all** — any SHS→HEI/TESDA or HEI→TESDA edge needs new distance computation.

**Finer data if ever needed:** per-grade enrollment (K–G12) exists in `project_paaral/data/processed/SY_*_School_Level_Data_on_Official_Enrollment.csv`. Not required for MVP — the booleans suffice.

**Data vintage — per-layer, displayed (resolved — item #8).** The three sectors are **heterogeneous in vintage** and the gold files do **not** self-document their source school/academic year (only build timestamps: public/private 2026-04-22, TESDA 2026-06-22, HEI 2026-07-09; and row counts).
- Known vintages: **HEI** = CHED AY 2024–25 (+ BARMM backfill); **DepEd** public/private = SY 2024–25-era masterlist; **TESDA** = rolling registry as-of mid-2026.
- **Policy:** each sector layer carries and **displays its own source vintage** in the UI (no forced single reference year). Honest about heterogeneity; consistent with the plain-language/trust posture.
- **Upstream dependency (task):** the exact vintage strings are not in the gold files and must be **captured from project_coordinates** (or its source manifests) and carried into the ugnay pipeline so the UI can display them. Until captured, use the best-known labels above.

### 2.1 Progression edge set

**Q:** Beyond the settled basic-ed chain, which post-secondary progression edges should the graph create?
**A:** The full progression edge set is:

| Edge | Level pair | Status |
|---|---|---|
| ES → JHS | G1–6 → G7–10 | Settled (basic-ed) |
| JHS → SHS | G7–10 → G11–12 | Settled (basic-ed) |
| SHS → HEI | G11–12 → higher ed | Selected |
| SHS → TESDA **provider** | G11–12 → tech-voc training | Selected — see two-stage model §2.7 |
| **HEI → TESDA provider** | higher ed → tech-voc training | **Added by user** — PH govt encourages even tertiary students to take TESDA skills courses |
| **TESDA provider → assessment center** | train → get assessed (coarse program-family matched) | **New (item #5)** — assessment is the credential prerequisite; see §2.7 |
| Integrated-as-SHS-provider | school offering SHS acts as an SHS node | Selected — universities/schools that themselves offer SHS count as SHS nodes |
| ~~JHS → TESDA~~ | — | **Deliberately excluded** |

- Self-connection: an integrated school satisfying consecutive levels connects within itself (intra-node edge). Likewise a TESDA `Both` site self-satisfies the provider→assessment step (train + assess co-located).
- Edge existence is **scope-dependent**: the sector toggle determines which rules fire (e.g. basic-only ⇒ only ES→JHS→SHS; basic+higher ⇒ adds SHS→HEI; all sectors ⇒ adds SHS→TESDA-provider, HEI→TESDA-provider, and the provider→assessment step).

### 2.2 Cross-sector distance method

> ⚠️ **AMENDED (A2, 2026-07-12) — RESOLVED.** The "haversine now, OSRM later" plan below is **done**: the accessibility feature routes all pairs through OSRM (`scripts/s2b_access_distances.py`), door-to-door. Haversine is no longer used anywhere the UI reads. See Amendments §A2.

**Q:** HEI/TESDA have no road distances. How to compute the cross-sector edge distances (SHS→HEI, SHS→TESDA-provider, HEI→TESDA-provider, and TESDA provider→assessment)?
**A:** **OSRM road distance is the committed end-state; haversine is a temporary placeholder for the MVP only.** This is *not* a "maybe upgrade" — the intent is to route cross-sector pairs through OSRM (as the existing DepEd network already is). Haversine ships first solely to unblock the MVP while the OSRM cross-sector run is stood up.
- Basic-ed edges already use the existing OSRM road network.
- All cross-sector pairs — SHS→HEI, SHS→TESDA-provider, HEI→TESDA-provider, **and the TESDA provider→assessment (TESDA↔TESDA) step** — use haversine in v1, then move to OSRM.
- **Distance-concept separation (see §2.6):** distinct from the display bands (1–5 km) and the routing pre-filter (20 km); the method (haversine→OSRM) is orthogonal to both.

### 2.3 HEI eligibility scope

**Q:** Which HEIs are eligible progression targets?
**A:** **All HEIs** (SUC + LUC + private). The `sector` field is retained so the UI can still distinguish/filter public vs private higher-ed. Widest coverage; policy emphasis on public access is achievable as a view/filter rather than a data exclusion.

### 2.4 Data-serving model — LAYERED (adopted)

**Q:** What serving strategy fits non-technical planners on mobile, viewing one area at a time?
**A:** **Layered model.** The dividing decision is *build-time vs request-time computation of distances/edges* — distances are expensive and deterministic, so they are **always precomputed**; the API only filters.

| Layer | Responsibility | Rationale |
|---|---|---|
| **Build (pipeline)** | Compute a **base progression-edge table** — every candidate edge as `(origin, destination, level-pair-type, road_distance_km)` — plus per-school metrics. Store as parquet. Reuses the existing ≤20 km edge table for basic-ed. | Distances computed once, never per request |
| **Request (thin API)** | Given `admin area + sector scope`, return that area's nodes + candidate edges + metrics as a compact payload. **Filters precomputed tables; never computes distance.** | Honest "live API"; small per-municipality payloads suit mobile |
| **Client** | Band toggle (1–5 km) and layer toggles filter the already-loaded area payload in-browser | Instant toggling, no round-trip |

**Explicitly rejected:**
- *Fully static files* — ~1,707 municipalities × up to 7 sector-layer combinations × 5 bands ≈ 60K files to regenerate per data update; bakes in filters that are cheap to do live. (Layer + band filtering happens client-side anyway — §1.2, item #7.)
- *Pure client-side (national)* — national payload risks mobile memory limits; unnecessary since users scope to one area.
- *Live API that computes distances per request* — the trap this model exists to avoid.

**Prototype risks to watch:** (1) Dense urban municipalities (e.g. Quezon City) produce the largest per-tile payloads. (2) Multi-province provincial terminal selections (e.g. all provinces in Region IV-A) produce the largest total tile counts. Both must be sanity-checked for mobile performance during the prototype.

### 2.5 Graph semantics & coverage (resolved)

**Q:** What threshold governs cross-sector edges given HEI/TESDA sparsity?
**A:** **Same 1–5 km bands** as basic-ed — **decision validated empirically (2026-07-09).** "No edge within the chosen band" is treated as a legitimate **access-gap signal**, directly serving the "spot underserved areas" JTBD — not as missing data. Cross-sector and basic-ed edges share one banding scheme (this closes the earlier open threshold question).

- **Evidence** (haversine SHS→nearest-HEI over 11,673 SHS-offering schools vs 2,431 HEIs): within 5 km = **56.4%**, 10 km = 79.0%, 20 km = 95.9%, 30 km = 99.0%; median nearest-HEI = **3.9 km**. At the 5 km band ~44% lack an edge — a well-discriminating signal, not a degenerate near-universal gap. This refuted the initial concern that 1–5 km would be too tight for HEIs.
- **Prototype gate (retained):** re-measure the within-band share using **road** distance (haversine understates travel); the ≤5 km share will drop somewhat but is expected to remain discriminating. If it collapses, revisit adding a 10 km cross-sector preset.

**Q:** How are integrated schools (multiple level flags) represented?
**A:** **One node + intra-node self-edge.** The node is the institution; when it offers consecutive levels (e.g. ES+JHS), a self-edge represents the satisfied progression. Matches the "connected or self-connected" phrasing from §1.6.

**Q:** Do private-school program flags (`esc_participating`, `shsvp_participating`, `jdvp_participating`) affect the graph?
**A:** **Display-only for MVP.** Shown in node-detail views; they do **not** gate edge creation — every school of the correct level is a valid edge endpoint. Keeps the graph complete and the logic simple.

**Q:** How is BARMM handled given the CHED file gap?
**A:** **Fixed upstream — done (verified 2026-07-09).** The HEI coordinates gold file has been updated to include BARMM higher-education institutions. ugnay therefore includes BARMM with no special-case logic and no mixed-completeness caveat.
- **Verified state:** `hei_coordinates.parquet` now holds **2,432 campuses** (up from 2,321), including **111 BARMM HEIs backfilled** (`build_hei_metrics.json`: `source_vintage.v1_barmm_backfill = 111`, `v2 = 2321`). All 18 regions represented.
- **Data-integrity caveat surfaced by the update:** `build_hei_metrics.json` reports `null_uii_count = 109` — 109 HEI campuses have a **null `uii_code`**. Since `uii_code` is the intended HEI join key, these need a fallback identity (e.g. `name`+PSGC) or they will be dropped/mis-keyed in cross-sector edge joins. See §2.6.

### 2.6 Distance concepts, routing pre-filter & data identity

**Terminology alignment (resolved).** "Catchment" was being used for two different things. The SPECS now uses **three distinct distance concepts**, kept explicitly separate:

| Concept | Layer | Value | Role |
|---|---|---|---|
| **Routing pre-filter** | Pipeline (build) | **20 km** | Bounds which institution pairs get a distance computed at all — mirrors Phase 1's existing 20 km road cutoff. Candidate pairs beyond 20 km are never routed. |
| **Display bands** | Client (UI) | **1–5 km presets** | What the planner toggles for the network overlay and the gap/continuity metric. |
| **Distance method** | Pipeline (build) | **haversine → OSRM** | How a pair's distance is measured. Haversine is a temporary MVP placeholder; **OSRM is the committed end-state** (§2.2). Orthogonal to the two above. |

- The word "catchment" as a **UI shaded-zone feature is retired** — see §3.3 (folded into node selection).
- Basic-ed pairs already have OSRM distances ≤20 km (existing edge table). Cross-sector pairs are pre-filtered to 20 km (haversine now, OSRM later), then the base progression-edge table (§2.4) stores those ≤20 km distances; display bands filter down to 1–5 km at request/client time.

**Data identity (resolved — item #6).**

- **Unified node ID = sector-prefixed composite:** `<sector>:<source_id>` — `pub:<school_id>`, `prv:<school_id>`, `hei:<uii_code>`, `tesda:<tesda_inst_id>`. Guarantees global uniqueness across the four sources even if a `school_id` collides between public and private, or an id repeats across sources. All edges and node lookups key on this composite id.
- **Null `uii_code` (109 HEIs) → deterministic surrogate:** mint a stable key from `name`+PSGC (e.g. `hei:NOUII_<hash(name, psgc)>`) so all 2,432 HEIs remain in the graph and the key is **reproducible across pipeline re-runs** (not row-index based). Prevents silently dropping ~4.5% of HEIs, some possibly BARMM.
- **TESDA identity note:** `tesda_programs.parquet` keys on `tesda_inst_id`; the same prefixed scheme (`tesda:<tesda_inst_id>`) applies, and program-family rows join to nodes on it.

### 2.7 TESDA two-stage model (resolved — item #5)

Stakeholders care not just about reaching *training* but about reaching *assessment* for the program trained on — assessment is the prerequisite to receive credentials. TESDA is therefore modeled as **two roles and two gaps**, not a single terminal.

**Roles** (from `institution_classification`, fully populated over 8,007 rows):

| Role | `institution_classification` | Count | Function |
|---|---|---|---|
| Training provider | `Provider Only` + `Both` | 7,082 | Destination of SHS/HEI → TESDA edges (train) |
| Assessment center | `Assessment Center Only` + `Both` | 4,253 | Destination of provider → assessment edges (certify) |
| Both (on-site) | `Both` | 3,328 | Fills both roles; **self-satisfies** the train→assess step |

**Program matching — COARSE FAMILY (resolved).** The provider→assessment edge requires the assessment center to assess the *same qualification family* the provider trains in — matched at a **qualification-family / sector grouping**, not exact program string. Rationale: robust to program-name inconsistency and edge sparsity, precise enough for a gap signal.
- **Data source:** `project_coordinates/data/silver/tesda_programs.parquet` — per-institution-per-program rows (`tesda_inst_id`, `program`, `institution_classification`, coords, `date_issued`, `expiration_date`).
- **Required derivation (pipeline task):** map the free-text `program` field to a **qualification family** (TESDA sector taxonomy, e.g. Agriculture / Automotive / ICT / Tourism / …). This mapping is a prerequisite for the provider→assessment edges.

**Validity — INCLUDE ALL (resolved).** Program registration `expiration_date` is **ignored** in v1 — any listed program counts. Accepted trade-off: may overstate current availability. (Revisit as "active-only" post-MVP; note it would need a pinned reference date — item #8.)

**Two gaps (fit the §1.9 node/area model):**
- **Training gap:** an SHS/HEI with no reachable TESDA provider within band.
- **Assessment gap:** a TESDA provider offering family F with no reachable assessment center for family F within band (unless it is a `Both` site). This is the stakeholder-sensitive one.

**Graph-build implication:** provider→assessment edges are **program-family-aware** — an edge exists only when band-proximity *and* family overlap both hold. More than a pure distance filter; the base progression-edge table (§2.4) must carry the family key for these edges.

**Continuity impact:** the train→assess step is added as a transition in the §1.8 pathway-continuity definition.

---

## 3. Delivery & Success (non-ops)

Deployment target, hosting, CI/CD, and cost are deferred to a separate ops document. This batch covers the tech foundation, MVP feature boundary, and non-functional bar.

### 3.1 Reuse vs rebuild

**Q:** How to treat the existing platform stub (functional FastAPI backend + incomplete React scaffold)?
**A:** **Full rebuild** — both backend and frontend start fresh.
- The existing FastAPI backend and React scaffold are treated as reference, not foundation.
- The new backend is designed around the §2.4 layered model from the start (thin API filtering precomputed tables, never computing distances at request time).
- Clean slate avoids inheriting the scaffold's incomplete/implicit decisions.

### 3.2 Map foundation

**Q:** Which map library, given pins + basemap toggle (plain/satellite/roads) + optional edge overlay?
**A:** **MapLibre GL + deck.gl.**
- **MapLibre GL** handles basemaps (plain / satellite / road-highlight), vector tiles, and institution pins. Aligns with platform_aral's known-good `maplibre-gl` (pinned 4.7.1) — see prior lessons on pinning map-lib peer deps.
- **deck.gl** renders the progression-network edge overlay, sized for larger edge counts than MapLibre line layers handle comfortably.
- Two libraries to maintain, justified by the edge-overlay being the core differentiator.

### 3.3 MVP feature scope

**Q:** Which capabilities ship in MVP v1?
**A:** **All four** — nothing deferred to post-MVP at this stage:

| Capability | In MVP | Notes |
|---|---|---|
| Progression network overlay | ✅ | Core differentiator; node+edge graph, 1–5 km band presets |
| Node detail panel | ✅ | Nearest-by-road by sector + plain-language accessibility (§1.4, §1.6) |
| Area Summary aid | ✅ | Always-available ecosystem interpretation: counts, pathway-continuity, gap indicators |
| Node-selection reachability | ✅ | Selecting a node highlights its reachable neighbors/zone at the chosen 1–5 km band. **Replaces** the brief's standalone "catchment footprint" (§3.3 original), which is retired as a separate feature (resolved item #4). Lighter than a shaded-polygon footprint and free of the haversine-mislabel problem |

### 3.4 Language

**Q:** Required language(s)?
**A:** **English only** for MVP. DepEd/CHED/TESDA working documents are largely English; no i18n framework needed for v1. Filipino/regional languages are explicitly post-MVP.

### 3.5 Definition of done, non-functional bar, telemetry (resolved)

**Q:** What signals the MVP is done and successful?
**A:** Three signals (all required):
- **Functional coverage** — all four MVP capabilities work correctly for any admin area drilled into.
- **Pilot with planners** — real DepEd/CHED/TESDA planners exercise it on a sample region and confirm it answers their situational-awareness / gap questions.
- **Performance bar met** — responsive on target mobile, including the worst-case dense municipality.
- *Formal tri-agency sign-off was **not** made a gating criterion* (pilot validation is the bar instead).

**Q:** Non-functional bar?
**A:**
- **Mobile-first responsive** — designed for phones first, scaling to desktop.
- **Modern browsers only** — current Chrome/Safari/Edge/Firefox; no legacy support.
- **Accessibility: not a committed MVP requirement.** Neither basic-a11y nor WCAG AA was selected. Recorded as an **open consideration** (government platforms sometimes require WCAG AA) — to revisit, but not a v1 gate.

> ⚠️ **AMENDED (A4, 2026-07-12).** "Mobile-first" had been *asserted, not built* — the phone view was the desktop view at 390px. Mobile is now a **distinct chrome** (bottom sheet, slim header, bottom-sheet detail), not a scaled-down desktop. And accessibility is no longer wholly open: **one rule is committed and test-enforced** — *no `aria-hidden` container may contain focusable controls*. See Amendments §A4.

**Q:** Telemetry?
**A:** **Basic anonymous usage analytics** — lightweight, privacy-reviewed (areas viewed, features used) to learn how planners use the tool. Implementation specifics coordinate with the ops document.

---

## Appendix A — One-page decision summary

**Product**
- Users: **non-technical planners** at DepEd, CHED, TESDA (central & regional) — *not* general public.
- JTBD: **situational awareness + spotting underserved areas**, one admin area at a time.
- Entry: **admin drill-down** (region → province(s) → municipality/ies) + **sector-scope toggle**. Two terminal modes: provincial (2+ provinces) or municipal (1 province → municipality multi-select). See §1.2.
- Default view: **pin map** (3 basemaps: plain/satellite/roads) + always-available **Summary aid**.
- Differentiator: a **progression graph** (grade-level rules) over road distance — optional overlay, 1–5 km preset bands — that also powers the metrics.
- Metric voice: **pathway-continuity first**; plain-language details on node inspection.

**Data & graph**
- Progression edges: ES→JHS, JHS→SHS, SHS→HEI, SHS→TESDA-provider, HEI→TESDA-provider, **TESDA provider→assessment** (coarse program-family match), integrated-as-SHS-provider. (JHS→TESDA excluded.)
- TESDA is a **two-stage model** (§2.7): train (provider) → assess (assessment center); `Both` sites self-satisfy; two gaps (training gap, assessment gap); validity dates ignored in v1.
- Built from real fields: `offers_es/jhs/shs` + `shs_strand_offerings` (public+private gold parquets).
- Integrated schools: **one node + intra-node self-edge**.
- Three distance concepts kept separate (§2.6): **routing pre-filter 20 km** (which pairs get computed) · **display bands 1–5 km** (what the planner toggles) · **distance method haversine→OSRM** (OSRM committed; haversine is a temporary MVP placeholder). Basic-ed reuses the existing ≤20 km OSRM edge table.
- Cross-sector threshold: **same 1–5 km display bands** — evidence-backed (56% of SHS have an HEI ≤5 km); "no edge" = access-gap signal.
- Metrics: **pathway continuity** = stepwise, area-rolled, school-count based (§1.8); **underserved** = continuity % + plain-language band, shown at node & area (§1.9).
- HEI scope: **all HEIs** (public/private distinguished by `sector`).
- Program flags (ESC/voucher): **display-only** for MVP.
- BARMM: **fixed upstream** by updating the HEI gold file; ugnay has no special-case logic.
- Serving: **layered** — precompute base edge table + metrics → thin API slices per area (filters only, never computes distance) → client-side band/layer toggles.

**Delivery (non-ops)**
- Stack: **full rebuild**; **MapLibre GL** (basemaps/pins) **+ deck.gl** (edge overlay).
- MVP scope: network overlay, node detail, Summary aid, node-selection reachability (standalone catchment footprint retired, item #4).
- Language: **English only**.
- Done = **functional coverage + planner pilot + performance bar** (no formal sign-off gate).
- Non-functional: **mobile-first**, **modern browsers only**; accessibility **not committed** (open).
- Telemetry: **basic anonymous usage**, privacy-reviewed.

## Appendix B — Assumptions, risks & dependencies to carry forward

**Upstream data dependencies**
- BARMM-inclusive **HEI gold file** — ✅ satisfied (verified 2026-07-09): 2,432 campuses incl. 111 BARMM.
- ID harmonization — ✅ resolved (§2.6): sector-prefixed composite node id (`pub:`/`prv:`/`hei:`/`tesda:`); null-`uii_code` HEIs (109) get a deterministic `name`+PSGC surrogate.
- **Data-vintage strings** — must be captured from project_coordinates (not in the gold files) and carried into the pipeline for per-layer display (§2.0, item #8).
- **TESDA qualification-family mapping** — pipeline must derive a family/sector grouping from the free-text `program` field for provider→assessment edges (§2.7, item #5).

**Prototype risks to validate**
- **Cross-sector distance error**: haversine vs road — measure on a sample to decide the §2.2 upgrade.
- **Worst-case payload/render**: dense urban municipality (e.g. Quezon City) edge counts + catchment shading on mobile.

**Open considerations (not blocking, revisit)**
- Accessibility standard for a government platform (WCAG AA?).
- Whether program flags (ESC/voucher) should later modulate edges rather than display-only.
- Post-MVP: Filipino/regional language support; cross-area comparison; national gap heatmap.

**Deferred to the separate ops document**
- Deployment target, hosting, CI/CD, cost, domain, maintenance ownership, telemetry implementation, and the relationship to Piring (brief Q6).
