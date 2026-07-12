# project_ugnay — Frontend Design & Decisions

**Status:** Living document (updated per stakeholder feedback round).
**Companions:** `SPECS.md` (canonical product/data decisions — this doc *refines* its §1.5 node-styling line), `pipeline_implementation_plan.md` (§6 = the JSON contract this frontend consumes).

This doc records the **frontend design decisions and their rationale** — especially the node-visualization rules, which SPECS only sketched ("pins styled by sector", §1.5). Decisions were reached through structured Q&A with the stakeholder; superseded choices are kept (struck through in the change log) so the reasoning history survives.

---

## 1. Scope & stack

- **Audience:** non-technical tri-agency planners (DepEd / CHED / TESDA). Situational awareness + spotting underserved areas, one area at a time (SPECS §1.0–1.1).
- **Stack:** Vite 6 · React 19 · Tailwind CSS 4 · **maplibre-gl 4.7.1** (pinned — see platform_aral lesson) · react-map-gl 7.1.9. Rendering is **maplibre-gl native** `Source`/`Layer`/`Popup` (deck.gl was dropped — failed to paint in the headless test env).
- **Serving:** pure static per-municipality JSON tiles (no backend for the demo). Vite dev middleware serves `output/tiles/` under `/tiles/`.

## 2. Information architecture — UX flow

Two phases:

1. **Setup (landing).** A centered card (`SetupView`): **Step 1** area drill-down (region → province(s) → municipality/ies) · **Step 2** the three **sector-layer toggles** (Basic / Higher / Tech-Voc). "Explore map →" dissolves the card into the map.
2. **Map.** Full-width map + top bar + top-right filter panel + floating legend. "← Change area" reopens Setup (selection preserved).

**Geographic selection** (SPECS §1.2, with round-2 refinement):
- Region is single-select. On region pick, **all provinces are selected by default** (province-wide view).
- **2+ provinces →** provincial terminal; loads every municipality across them; municipality picker off.
- **Exactly 1 province →** municipality multi-select; **none selected = all municipalities** of that province.

## 3. Node visualization rules (core)

**Grammar:** *fill color = sector*. Everything else about a node is either a **filter** (top-right panel) or a **display control**, not a glyph painted on the pin.

| # | Dimension | Rule |
|---|---|---|
| 1 | **Sector = fill color** | DepEd-public · DepEd-private · HEI · TESDA. Colors are user-customizable (swatches) with a colorblind-safe (Okabe–Ito) preset toggle. Legend tracks the active palette. |
| 2 | **Capabilities = filters, not glyphs** | Shown/hidden via the top-right panel (§4), **not** drawn on the pin. Basic: ES/JHS/SHS · Higher: Public/Private · Tech-Voc: Training(provider)/Assessment. A node renders iff its sector layer is on **and** it offers ≥1 enabled subcategory. |
| 3 | **Selected pin** | Keeps sector color; bold dark outline + enlarge (base + 4px). |
| 4 | **Hover** | Slight enlarge (base + 1px) + pointer cursor (maplibre feature-state). |
| 5 | **Zoom** | No clustering — every institution always drawn. Node size is a fixed pixel radius (slider-controlled), not zoom-scaled. |
| 6 | **Base size** | Uniform (unweighted per SPECS §1.8). Slider: min 2px, default 4px, max 9px. |
| 7 | **Z-order** | Three circle layers, drawn **basic (bottom) → higher → tech-voc (top)**, so the denser basic-ed layer never buries the rarer higher/tech-voc pins. |

**Why capabilities are filters, not glyphs (the round-2 pivot).** Round 1 built an *arc grammar* — neutral ring-segment arcs on each pin encoding offered levels/roles in fixed slots ([ES\|JHS\|SHS], [Provider\|Assessment]). It was elegant and gave one grammar across all sectors, but the stakeholder found it **too noisy at province density** (hundreds/thousands of ringed pins). Decision: **remove arcs; move capability distinction into an explicit top-right toggle panel.** The arc generator (`lib/nodeIcons.js`) is retained, unused, in case arcs return as an optional mode. See change log.

## 4. Map controls

| Control | Location | Behavior |
|---|---|---|
| Sector layers (Basic/Higher/Tech-Voc) | Top bar | On/off per sector; drives node visibility + which groups appear in the filter panel |
| **Layers & Filters panel** | Top-right (floating) | **Collapsible** (expanded by default — when open it used to reach down over the zoom +/− buttons). Two tabs: **Filters** = *what you see* (sector subcategories, accessibility threshold) · **Appearance** = *how it looks* (node size, border thickness, colorblind preset, sector colors). One panel with tabs rather than a second floating panel — panel proliferation is what crowds the map. |
| Node size | Panel → Appearance | Slider 2–9px |
| Border thickness | Panel → Appearance | Slider 0–5px (0 hides administrative borders) |
| Colorblind-safe palette | Panel → Appearance | Toggle → Okabe–Ito palette |
| Sector colors | Panel → Appearance | 5 swatches; legend auto-updates |
| Progression edges | Top bar | **Off by default**; toggle fades edges in (SPECS §1.3 — edges are the optional overlay) |
| Basemap | Top bar | plain (Carto positron) / satellite (Esri raster) / roads (Carto voyager) |
| Zoom +/− | Bottom-right | maplibre `NavigationControl` |
| Node popup | On click | Name + sector (right sidebar detail is deactivated — §6) |

Auto-fit: on tile/sector change, the map fits a **robust (2nd–98th percentile) bounding box** of visible nodes — ignores geocoding outliers that otherwise skew the center.

## 5. Edges = ACCESSIBILITY (Round 4 — 2026-07-12, current design)

> **Round 4 supersedes the Round-3 progression-edge design below (§5A).** Edges no longer
> express progression. **Progression is deprioritised to post-demo.** What survives from
> Round 3: the Gap-halo idea (now driven by the accessibility threshold) and the
> HEI-is-terminal decision.

### 5.1 Accessibility semantics
- An edge means **"this is near enough to reach"** — purely spatial, not directional.
- A **distance-threshold slider (1–5 km)** — the SPECS §1.3 display-band preset — defines "near". It is the single control governing **both** the edges and the gap halos.
- **Edge rule:** clicking an institution draws an edge to every institution **within the threshold that offers at least one level/sector it does not**. Capability tokens: `ES · JHS · SHS · HEI · TESDA-training · TESDA-assessment`. So ES-only → ES-only is *not* drawn (pure peers), but ES-only → ES+JHS *is*. This keeps "what can I reach that I don't already have" without smuggling directional progression back in.
- **Private basic-ed schools participate fully** (they're nodes like any other).
- Distance is **routed road distance (OSRM)**, precomputed by `scripts/s2b_access_distances.py` and carried in the tiles as `access` (origin → `[[dest_id, metres], …]`, nearest-first, token rule pre-applied). The frontend reads it — it no longer measures anything. (Was client-side haversine through Round 6; see Round 7 in the change log. Of all pairs within 5 km straight-line, only **53.2%** are still within 5 km by road — median detour **1.41×** — so the change is material, not cosmetic.)
- Edges appear **on click only** (no hover tease — removed, see change log).

### 5.2 Node fills — five sectors
Higher-ed is **split into Public / Private** as distinct fills (planners care where each sits), kept in one hue family so the sector still reads at a glance:
`DepEd Public · DepEd Private · Higher Ed — Public · Higher Ed — Private · TESDA`. User-customisable, with a colorblind-safe (Okabe–Ito) preset.

### 5.3 Edge encoding
| Channel | Encodes |
|---|---|
| **Color** | The **destination's sector fill** — what it connects you to. |
| **Width** | Distance, scaled to the current threshold (near = thick → far = thin). |

### 5.4 Gap Analysis layer (the old "Show all edges" toggle)
An analysis layer, **off by default**. When on, every non-terminal institution that cannot reach its next level **within the threshold** gets a hollow halo:
- **Amber** — the next level exists, but only *beyond* the threshold (moves live with the slider).
- **Red** — no next level at *any* band (≤5 km): a structural dead end.
- Requirements: `ES → a JHS` · `JHS → an SHS` · `SHS → an HEI **or** a TESDA training provider` · `TESDA training provider → an assessment centre`.
- **Terminal, never flagged:** HEIs, and assessment-only TESDA centres. A provider that is *also* an assessment centre satisfies itself via the pipeline's self-edge (invisible-but-correct).
- This is the one place progression logic still surfaces; it reads the precomputed progression edges in the tiles.

### 5.4b Emphasis vs. visibility (per-subcategory fade)
Each subcategory row in the Filters tab carries **two** controls:
- a **checkbox** — show / hide it entirely, and
- a **fade toggle (◐)** — keep it on the map but drop it to ~15 % alpha.

Fading lets a planner highlight one level *without deleting the context around it*. **A node fades only when EVERY subcategory it offers is dimmed** — otherwise a school offering both a dimmed and an un-dimmed level would disappear when the user only meant to push one level back. Selection-dimming (pinned node fades everything off its fan) composes with it and takes priority.

### 5.5 Institution card (hover + click)
- **Hover** → transient card (no close button, pointer-events off so it can't fight the hover).
- **Click** → the same card, pinned and dismissible, **plus** the accessibility edges and dimming of everything unrelated.
- **Contents:** name + sector badge (properly capitalised) · **what it offers** (levels / HEI sector / TESDA roles) · **location + data vintage**. **ESC / SHS-VP / JDVP** badges on **private schools only**.
- Restyled from MapLibre's default: rounded card, soft shadow, and the close button given its own gutter instead of sitting on the title.

### 5.5b Detail drawer — accessibility summary (`lib/stats.js`)
The pinned institution's detail lives in a **right-side drawer**, off the map: a popup anchored to the node always covered part of its own edge fan, and edges radiate in every direction, so no anchor or offset is safe.

The drawer **overlays** the map and slides in on `transform`. It must never resize the map container: resizing reallocates MapLibre's WebGL drawing buffer, which clears it, so animating the drawer's width flashed the map white on every click (Round 6). The map is therefore left completely still — with one exception: if the clicked node would end up *under* the drawer, `MapView` pans just far enough to bring it back into the open area.

Contents, in order:
1. **Pathway ladder** (the primary viz, and where a *subtle* progression intuition is baked in). Rungs are the levels bottom-to-top — `Elementary · Junior High · Senior High · Higher Ed · TESDA Training · TESDA Assessment`. The institution's own rung reads **"you are here"**; the rung(s) immediately above are flagged as the **next step** with the nearest distance. Bars count how many of that level are reachable within the threshold. **We count and mark — never a verdict, never a progression edge.** SHS is the branch point, so both *Higher Ed* and *TESDA Training* are marked as next steps; a TESDA training provider's next step is *TESDA Assessment* (which is exactly what its halo means).
2. **Gap status** — the halo, explained in words (amber/red).
3. **Sector breakdown** of the reachable set (mirrors the edge rule exactly: only institutions offering something new).
4. **Nearest of each level**, at any distance in the loaded area ("—" = none found).

### 5.6 Administrative borders
A quiet visual guide only (thin, dashed, muted, drawn beneath everything). Level follows the view:
- **Region, or one/many whole provinces → province borders.**
- **Specific cities/municipalities picked → municipality borders.**

Source: `output/boundaries/{provincial,municipal}_boundaries.geojson` (already in the repo), served in dev by a Vite middleware at `/boundaries`. **Matched by PCODE, never by name** — HDX pcodes are `PH` + PSGC digits (`ADM3_PCODE "PH0102801"` → municity key `0102801`; `ADM2_PCODE` → the key's first 5 digits). Name-matching would break on exactly the casing/NCR quirks S6 had to canonicalise.

**Sliver-hole cleanup (required).** `dissolve_municipal_boundaries.py` unions source polygons whose edges aren't perfectly coincident, so the hairline gaps survive as **interior rings** — Cavite carried 94, Laguna 78, Rizal 55. Drawn as a line layer, every hole ring renders as a broken grey line *inside* the province. `scripts/clean_boundaries.py` drops interior rings below ~1.2 km² (topological noise) and keeps larger ones (real enclaves/lakes — Laguna correctly retains 2). **3,959 sliver holes removed** from the provincial file, 15 from municipal. Rerun after any re-dissolve:
`python scripts/clean_boundaries.py`

Rendered **solid** (not dashed — dashes read as "broken"), muted grey, with **user-controlled thickness** (Appearance tab; 0 hides).

### 5.7 Honesty in the UI (distances + gap caveats)
- **Edges are labelled an "approximation of accessibility"** — road distance is not travel time, cost, or safety, and says nothing about whether anyone actually enrols. A drawn line shows *that* two institutions are connected, not the route (we have the routed length, not the routed geometry).
- **Distances are ROUTED ROAD DISTANCES (OSRM)** as of Round 7 — how far you actually have to travel, not how far it looks. Door-to-door (`snap + road + snap`), so never shorter than a straight line. The legend states this plainly. *(Superseded the Round-6 "straight-line, OSRM deferred" state.)*
- **Off-road institutions are not gap-flagged.** ~2,311 nodes sit >2 km from any mapped road (usually a broken coordinate — some plot in open sea); they carry `road_unreliable` and their halos are suppressed, so a data error doesn't masquerade as an accessibility gap.
- **Gap halos carry the TESDA caveat**: a haloed TESDA node is a training provider with no assessment centre in reach, matched **role-based only** — it does not check the qualification family actually trained for, so it *understates* the true gap (M4/S5).

### 5.8 Deferred to post-demo
- **Progression edges** (directional ES→JHS→SHS→HEI/TESDA rendering), the focused progression fan, incoming/"who feeds into me", trace-full-pathway.
- The **sidebar drawer** (`ContinuityPanel`) — designed in Round 3 §5A.6, still unbuilt.
- TESDA qualification-family matching (M4/S5).

---

## 5A. Round-3 progression-edge design (SUPERSEDED — kept for when progression returns)

**Build status:** Phase 0 (data-contract check) ✓ · Phase 1 (focused progression edges) was built, then **replaced** by the Round-4 accessibility model above. The Round-3 rules below remain the reference for the post-demo progression feature.

Reached via structured Q&A (Themes A–F). Edges are the **primary tool for communicating access to progression** (stakeholder framing), but visually **secondary** to nodes — off by default, revealed by interaction. Because the payload of progression is often an *absence* (a missing edge = an access gap), the design separates **exploring one school's pathway** (focused edges) from **spotting where the system is broken** (the Gap Analysis layer).

### 5.1 Edge semantics (Theme A)
- An edge is a **directed, institution → institution** link from a school at level *L* to a school at the next level *L+1*, drawn only when the *L+1* school is within a road-distance band (1–5 km).
- **Assertion:** presence = "a learner finishing here has this concrete onward option nearby"; absence within band = the gap.
- **Transition set (no skips):** `ES→JHS → SHS → {HEI, TESDA-training}`, plus intra-TESDA `training→assessment`. SHS branches to both HEI and TESDA-training.
- **HEI is terminal (Phase-0 decision, Option A, 2026-07-11).** The pipeline emits a `HEI_TESDA_prov` transition (HEI→TESDA reskilling, ~6% of edges) but the frontend **ignores it**: HEIs render no outgoing edges and are never gap-flagged. Keeps SHS the clean branch point. Revisit later as an optional "reskilling pathway" (Option B).
- **Direction:** *implicit* in the global/idle view (endpoint sector colors carry it); *explicit* (arrowhead/taper) only in the focused per-node view.

### 5.2 Interaction model (Theme B) — the noise strategy
Edges are **focused-by-selection, not global-by-default** (this is the lesson from the removed arcs: never render everything at once at province density). It is the same feature as SPECS §3.3 node-selection reachability.
- **Idle:** edges hidden.
- **Hover = tease:** the node's edges render at high transparency, **radially clipped** to a circle centered on the node, with a **feathered clip boundary** (aesthetic soft edge). Doubles as the affordance that a node is clickable.
- **Click = commit:** edges go fully opaque, the radial clip **transitions out** (expands away) revealing the full one-hop fan, and all other nodes/edges **dim**.
- **Outgoing by default** ("where can my learners go next"); **incoming as a toggle** ("who feeds into me" — catchment). Both need **help text**.
- **One hop only** for the demo. **"Trace full pathway"** (walk the entire chain from a selected node) is recorded as a *later* feature.
- *Implementation note:* MapLibre has no native circular pixel-mask on line layers. The feathered radial clip is approximated by (a) geometrically truncating each edge to the clip radius in JS and (b) `line-gradient` opacity fade toward the outer end (requires `lineMetrics: true`). Pixel-perfect masking would need a custom canvas layer — revisit only if the approximation looks off.

### 5.3 Edge visual encoding (Theme C)
| Channel | Encodes |
|---|---|
| **Color** | **Destination sector** — the edge inherits the color of *where it leads* (HEI green / TESDA purple / basic public-blue / private-orange). Matches node palette + colorblind preset. |
| **Width** | **Distance band** (near = thick → far = thin, 5 steps). *Not* data-volume — ugnay has no flow counts. |
| **Opacity** | Reserved for interaction (hover-tease transparency, focus-dim) — deliberately *not* overloaded with band. |
| **Direction** | Arrowhead/taper toward destination, focused view only. |

Intra-TESDA `training→assessment` edges are purple→purple (color adds no new info there) — accepted, no distinct styling.

### 5.4 Gap Analysis layer (Theme D) — making absence visible
An **analysis layer**, its own toggle, **off by default**. When on, every **non-terminal** node with no reachable next level gets a **hollow alert halo** (a channel reserved from selection's dark outline, from sector fill, and from glyphs):
- **Amber halo** = an onward option exists but only *beyond the currently displayed band* (responds live to the band the user is viewing).
- **Red halo** = **no** onward option at *any* band — a structural dead-end.
- **Terminal levels (HEI, assessment centers) are never flagged** (they have no next level).
- A **legend with help text** explains the halo colors.
- This layer **is** the "global" view — its value is the gaps, not an edge mesh. (Raw all-edges is not a headline mode.)
- Halo visual + legend wording to be refined against the live frontend.

### 5.5 TESDA two-stage (Theme E)
- `training→assessment` uses the **same edge grammar**.
- **"Both"-role** institutions (provider *and* assessment center) internalize the step → **never** flagged for an assessment gap; handled in gap logic only, **no special marker**.
- **Training-providers participate fully** in the Gap layer (no reachable assessment center in band = halo) — SPECS emphasis on *reaching assessment for the trained qualification*.
- **Role-only for the demo:** a provider connects to *any* assessment center in band, regardless of qualification family. This makes TESDA edges/flags **optimistic**; a **caveat note** in the TESDA legend states family-matching is a later release (M4/S5).

### 5.6 Sidebar — quantitative readout + node detail (Theme F)
The previously-deactivated `ContinuityPanel` is **reactivated** as a **folded right-drawer with a visible tab** — always present, opened by clicking the tab; **auto-unfolds** when a node is clicked. It is the **sole detail home** (no click-popup). Two content modes:
- **Node selected →** that node's detail: name, sector, subcategories offered, and **progression status** (reachable next-level count + **nearest option and its distance**, e.g. *"nearest JHS: 6.2 km — beyond the 3 km band"*). Available regardless of the Gap layer.
- **Gap layer on, nothing selected →** the area rolled up **per transition** (school-count continuity + plain-language band), e.g. `ES→JHS  88/120 (73%) ⚠ moderate`. This surfaces the SPECS pathway-continuity metric. **Division of labor: map = *where* (halos), sidebar = *how much* (metric).**

### 5.7 Still deferred
- **"Trace full pathway"** — multi-hop chain walk from a selected node (one-hop is the demo scope).
- **TESDA qualification-family matching** (M4/S5) — replaces role-only TESDA edges.
- **HEI public/private** is already a real filter (`hei_is_public` in tiles).

## 6. Component map (`platform/frontend/src/`)

| File | Role |
|---|---|
| `App.jsx` | State + layout; two-phase orchestration; basemap/edges/size/color state |
| `components/SetupView.jsx` | Landing card (area + sector layers → Explore) |
| `components/GeoPicker.jsx` | Region/province/municipality drill-down (Select-all, drill-down hint) |
| `components/MapView.jsx` | maplibre map; 3 node layers + edges layer; select/hover/fit |
| `components/FilterPanel.jsx` | Top-right subcategory filters + display controls |
| `components/ContinuityPanel.jsx` | **To be reactivated** as the folded right-drawer (node detail + gap-layer area summary — §5.6) |
| `hooks/useTiles.js` | Tile + admin_index fetch/cache/evict |
| `lib/nodeIcons.js` | Arc-icon generator — **unused** (round-1 arcs; kept for optional return) |

*Planned (edge/progression build, §5):* edge Source/Layer in `MapView.jsx` (one-hop fan, hover-tease radial clip, click-commit); Gap Analysis layer (halos + legend); a reachability helper to compute a selected node's one-hop edges + nearest-option distances from tile `edges`/`neighbor_nodes`.

## 7. Change log

**Round 1 (2026-07-10 → 07-11) — node grammar built.**
- Two-phase UX (setup → map); sector-layer toggles; edges off by default; basemap toggle; multi-province provincial terminal; median/robust auto-fit.
- ~~Node **arc grammar**: neutral ring-segment arcs encoding offered levels (basic) / roles (TESDA) in fixed slots; HEI ringless. Selected/hover/zoom-fade rules.~~ *(Superseded round 2.)*

**Round 7 (2026-07-12) — accessibility distances are now OSRM road distances.**
- **Haversine is gone from the client.** New pipeline stage `scripts/s2b_access_distances.py` routes every institution pair through the OSRM `/table` service and bakes the result into the tiles (`access` = `origin → [[dest_id, metres], …]` ≤5 km by road, token rule applied; `nearest` = `node → {level: road_km}`, unbounded). `lib/graph.js`/`stats.js` read these — they no longer compute distance. `haversineKm`, `buildEdgeIndex`, and `offersSomethingNew` were removed from the frontend.
- **Why it mattered:** of all pairs within 5 km straight-line, only **53.2%** are still within 5 km by road (median detour **1.41×**). Straight-line was materially over-drawing reachability.
- **Gap halos now derive from the nationwide `nearest` table**, not the progression-edge table — so a halo means the same thing regardless of which tiles are loaded, and it is measured in road km like everything else. (The progression-edge table's cross-sector distances were still haversine.)
- **Door-to-door distance** (`snap_origin + road + snap_dest`). OSRM measures between road-*snapped* points, which alone produced 41,120 pairs shorter than a straight line (impossible); the snap legs restore road ≥ straight-line (asserted in the pipeline; 0 shipped). A browser check confirmed **no impossible edges** post-fix.
- **`road_unreliable`** node flag (>2 km from a road; 2,311 nodes) suppresses false gap halos on mis-plotted coordinates.
- **Copy updated** across legend, drawer, and filter panel: "within N km **by road**", "routed road distances (OSRM)", "nearest anywhere in the country".
- **Verified in a real browser** (NCR): edges within threshold, ratios ≥ 1, unbounded "nearest HEI 3.1 km", no console errors.

**Round 6 (2026-07-12) — the drawer must not resize the map.**
- **Map white-flash on every node click — fixed.** The drawer was a **flex sibling** animating its `width`, so the map container shrank frame by frame. Each of those resizes reallocates MapLibre's **WebGL drawing buffer, which clears it**. Instrumented in a real browser: one click fired **7 canvas resizes** (1440 → 1439 → 1286 → 1211 → 1152 px) against only 15 renders — the uncovered frames are the white flash.
  - The drawer is now an **overlay** that slides on `transform` (`translate-x-full` → `0`). Layout never changes, the map is never resized, and the canvas holds at 1440×855 through the whole animation. **Verified: 7 resizes → 0.**
  - Also removed **our own `ResizeObserver`** in `MapView`: MapLibre already runs one on its container (`trackResize`, default on), so every resize was being done **twice** — visible as duplicated widths in the trace.
  - Because the drawer now overlays: the **Layers panel** slides left with it (`-translate-x-72`), and MapLibre's **bottom-right zoom controls** are shifted clear in CSS (`.ugnay-drawer-open`).
  - **The map stays still on click** (the point of the fix). The one exception: if the node you clicked would land *under* the drawer, `MapView` `panBy`s just enough to bring it back into the open area — a pan, which re-renders but never clears.
- **Legend is collapsible** (bottom-anchored, so it unfurls upward; collapses to a labelled bar with the five sector dots). Width is **pinned at 300 px in both states** — the collapsed body is still in the layout, so a shrink-to-fit box took its widest line and the "collapsed" pill came out **1032 px wide**.
- **Header subtitle** "Educational Pathway Explorer" → **"Education Institutions Map"** (the product no longer leads with progression).

**Round 5 (2026-07-12) — usability, borders, sidebar stats, motion.**
- **Fade vs hide** — every subcategory gets a **◐ fade toggle** (~15 % alpha) alongside its visibility checkbox, so a level can be pushed back without deleting the context around it. A node fades only when **every** subcategory it offers is dimmed.
- **Detail drawer replaces the pinned popup** — a popup anchored to the node always covered part of its own edge fan (edges radiate in every direction, so no anchor is safe). The drawer is a flex sibling: the map narrows, nothing is hidden. Hover popup stays (harmless — no edges drawn on hover).
- **Drawer content: pathway ladder** ("you are here" + next-step mark + nearest km) · gap status in words · sector breakdown · nearest-of-each-level. Progression intuition is carried by *order and marking only* — no verdicts, no progression edges (§5.5b).
- **Administrative borders** (§5.6) — province borders for region/province views, municipality borders when drilling into cities. Plus `scripts/clean_boundaries.py`: the dissolve left **3,959+ sliver holes** that rendered as broken grey lines *inside* provinces. Filled by an **identity test, not a size test** — keep a hole only if another admin unit sits in it (Baguio-in-Benguet, Angeles-in-Pampanga survive; Taal and Lake Lanao are filled).
- **Panel is collapsible with two tabs** — Filters (*what you see*) / Appearance (*how it looks*); it was covering the zoom controls. Node-size, **border-thickness**, colorblind preset and 5 sector swatches live in Appearance.
- **Popup restyle** — proper card; MapLibre's default `max-width:240px` was squeezing the card so long names ran under the "×".
- **Motion** — drawer slides, SetupView fades in (it was popping in on "Change area"), hover card eases in, MapLibre paint transitions smooth the dim/select. `prefers-reduced-motion` respected.
- **Honesty in UI** — edges labelled an "approximation of accessibility"; distances labelled **straight-line, not road** (OSRM deferred); TESDA halo caveat states matching is **role-based only** and therefore *understates* the gap.

**Round 4 (2026-07-12) — PIVOT: edges = accessibility, not progression.**
- **Edges now mean "within reach"** — a **1–5 km threshold slider** (SPECS band preset) drives edges *and* halos. Edge drawn to any institution in range **offering something the selected one lacks**. Client-side haversine; private basic-ed schools included.
- **Progression deprioritised to post-demo** (Round-3 design retained in §5A).
- **HEI split into Public / Private fills** — five sector colours now.
- **"Show all edges" → "Gap analysis"** — the halo layer (amber = beyond threshold, red = nothing ≤5 km).
- **Hover tease removed.** **Hover → institution card** (name, sector, offers, location, vintage; ESC/SHS-VP/JDVP on private schools only); **click → pinned card + edges**. Popup restyled (was cramped; close button now has its own gutter; sector labels properly capitalised).
- **Bug fixes:** `maplibre-gl.css` was never imported — without it `.maplibregl-popup` loses `position:absolute`, is laid out as a static block inside the map container, and **collapses the canvas (map went white on click)**; the zoom +/− controls were invisible for the same reason. Also: `line-cap` in `paint` made MapLibre silently reject the hover-tease layer; and unprojecting past ±90° produced NaN coordinates.

**Round 3 (2026-07-11) — edge & progression design (Q&A, Themes A–F). Superseded by Round 4.**
- Edge semantics (directed institution→institution, next-level, banded; no skips; implicit/explicit direction).
- **Focused-by-selection** interaction: hover-tease (feathered radial clip) → click-commit (dim others); outgoing default + incoming toggle; one-hop only ("trace full pathway" deferred).
- Encoding: **color = destination sector, width = band**, opacity reserved for interaction.
- **Gap Analysis layer** (toggle, off by default): amber/red **broken-pathway halos** on non-terminal nodes, band-responsive, with legend. This is the "global" view. (Resolves parked Rule 3, SPECS §1.9.)
- TESDA: same grammar; "Both"-role invisible-but-correct; **role-only for demo** with family-matching caveat.
- **Sidebar reactivated** as a folded tabbed drawer — sole detail home (node detail) + gap-layer area continuity readout.

**Round 2 (2026-07-11) — stakeholder feedback.**
- **Arcs removed** → replaced by top-right **FilterPanel** with per-sector subcategory toggles (arcs too noisy at province density).
- **Province data cleaned** — S6 now derives canonical region/province/municipality names from `project_coordinates/data/silver/psgc_crosswalk.parquet` (see pipeline plan §3 S6). Fixes casing dupes, trailing spaces, numeric-PSGC provinces; NCR "province" = city name.
- **HEI public/private** filter enabled (`hei_sector` / `hei_is_public` added to tiles).
- **Select-all provinces + all-selected-by-default**; drill-down hint text.
- **Right sidebar deactivated** (kept).
- **Zoom +/− controls** added.
- **Node size slider** (default reduced 7→4px).
- **Fill color**: per-sector swatches + colorblind-safe preset.
- **Z-order**: basic (bottom) → higher → tech-voc (top).
