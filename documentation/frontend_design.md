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
2. **Map.** Full-bleed map + top bar + top-right filter panel + floating legend. "← Change area" reopens Setup (selection preserved).
   On **mobile the chrome is different, not smaller** — see **§6A**.

**Geographic selection** (SPECS §1.2, with round-2 refinement):
- Region is single-select. On region pick, **all provinces are selected by default** (province-wide view).
- **2+ provinces →** provincial terminal; loads every municipality across them; municipality picker off.
- **Exactly 1 province →** municipality multi-select; **none selected = all municipalities** of that province.
- The picker's sections **grow** into place rather than popping (`grid-template-rows: 0fr → 1fr`, which animates to the content's true height; a `max-height` needs a magic number that either clips a long province list or crawls for a short one). Collapsed sections are **`inert`** — see §6B.
- The landing card is a **flex column with a pinned footer**, so "Explore map →" is always on screen. It used to be one scroll box: choosing a region grew the card and pushed the primary action below the fold, behind a nested scroll.
- The **first hint names the first action** — "Pick a region", not "Pick at least one province" (there are no provinces to pick until a region is chosen).

## 3. Node visualization rules (core)

**Grammar:** *shape + fill = sector*. Everything else about a node is either a **filter** (the panel) or a **display control**, not a glyph painted on the pin.

| # | Dimension | Rule |
|---|---|---|
| 1 | **Sector = fill colour** | DepEd-public · DepEd-private · HEI-public · HEI-private · TESDA. Colours are user-customisable (swatches) with a colorblind-safe (Okabe–Ito) preset toggle. Legend tracks the active palette. |
| 1b | **Sector = SHAPE** *(round 9)* | A **second, redundant channel**: circle / square / triangle / diamond, chosen per swatch in Appearance. Default carries meaning rather than decoration — **shape = sector, fill = public/private within it**: DepEd ○ · Higher-ed △ · TESDA □ (diamond left free for the user). Colour alone fails in greyscale print and under colour-vision deficiency, where five fills can collapse into two or three; shape survives both. The Legend renders the **real marks**, so it can never claim a shape the map isn't drawing. |
| 2 | **Capabilities = filters, not glyphs** | Shown/hidden via the panel (§4), **not** drawn on the pin. Basic: ES/JHS/SHS · Higher: Public/Private · Tech-Voc: Training(provider)/Assessment. A node renders iff its sector layer is on **and** it offers ≥1 enabled subcategory. |
| 3 | **Selected pin** | Keeps sector colour + shape; enlarges (base + 4px) and takes a dark halo (`icon-halo-*`) instead of the old circle stroke. |
| 4 | **Hover** | A **ring fades in underneath** the node + pointer cursor. It is no longer a size change — see the symbol-layer tradeoff below. |
| 5 | **Zoom** | No clustering — every institution always drawn. Node size is a fixed pixel radius (slider-controlled), not zoom-scaled. |
| 6 | **Base size** | Uniform (unweighted per SPECS §1.8). Slider: min 2px, default 4px, max 9px, **0.25px steps** (the icon size takes fractional values, so fine control is free). |
| 7 | **Z-order** | gap halo → hover ring → **basic → higher → tech-voc**, so the denser basic-ed layer never buries the rarer higher/tech-voc pins. |

**How shapes are drawn — SDF symbol layers (`lib/nodeShapes.js`).** The three sector layers are **symbol** layers, not circle layers. Each shape is one **signed-distance-field** image: a greyscale mask that MapLibre recolours at draw time via `icon-color` and scales crisply to any `icon-size`. So there is **one image per shape**, not one per shape × colour, and the *existing* colour expression — the same `match` on the `fill` property the circle layers used — keeps working untouched, including live colour edits and the colorblind palette.

Two things about this are easy to get wrong, and both fail *silently*:

- **The SDF encoding.** MapLibre inherits TinySDF's convention: the alpha channel stores the signed distance as `255 − 255·(d/8 + 0.25)`, putting the shape's edge at alpha ≈ **0.75** — exactly the cutoff its SDF shader tests. Get it wrong and the shapes come out bloated, eroded or fuzzy rather than obviously broken.
- **`setStyle` drops every image the app added.** That means **every basemap switch**. react-map-gl re-adds our sources and layers, but *not* our images — so without re-registering them on `style.load`, the symbol layers reference missing icons and **every institution vanishes**. Guarded by test **T9.6**.

**The bitmap size is not a free parameter — it caps how thick a halo you may ask for.** MapLibre derives the halo cutoff as `buff = (6 − icon-halo-width / icon-size) / 8`. If that ratio reaches 6, `buff` goes negative and the shader **floods the entire icon quad** with the halo colour: every node grows a translucent white square (invisible on the light basemap, glaring on satellite — which is how it shipped). Two rules keep it structurally impossible rather than merely unlikely:
- The bitmap is **40px** (`R_CIRCLE = 10`), so `icon-size = nodeSize/10` — double the headroom of the original 64px bitmap.
- Halo widths are **proportional to node size**, so `haloWidth / iconSize` is a **constant** (2.5 resting, 3.0 selected) at every slider position. A *fixed* pixel halo makes the ratio vary with the slider, and blows past 6 at the small end. Guarded by **T9.7**.

**Tradeoff we accepted.** MapLibre supports `feature-state` on circle/line/fill layers but **not symbol layers**, so hover can no longer drive `icon-size`. The hover "grow" became a **ring that fades in underneath** (its own circle layer, which *can* read feature-state). Same signal, and it works for every shape. The *selected* state is unaffected — it was already an expression on `node_id`, not feature-state.

**Why capabilities are filters, not glyphs (the round-2 pivot).** Round 1 built an *arc grammar* — neutral ring-segment arcs on each pin encoding offered levels/roles in fixed slots ([ES\|JHS\|SHS], [Provider\|Assessment]). It was elegant and gave one grammar across all sectors, but the stakeholder found it **too noisy at province density** (hundreds/thousands of ringed pins). Decision: **remove arcs; move capability distinction into an explicit toggle panel.** The arc generator (`lib/nodeIcons.js`) is retained, unused, in case arcs return as an optional mode. See change log.

> Note the distinction: **shape encodes the sector** (5 buckets, one glance) — it does *not* re-introduce the arc grammar, which encoded *capabilities* (up to 3 sub-levels per pin) and is what proved too noisy.

## 4. Map controls

| Control | Location | Behavior |
|---|---|---|
| Sector layers (Basic/Higher/Tech-Voc) | Top bar | On/off per sector; drives node visibility + which groups appear in the filter panel |
| **Layers & Filters panel** | Top-right (floating) | **Collapsible** (expanded by default — when open it used to reach down over the zoom +/− buttons). Two tabs: **Filters** = *what you see* (sector subcategories, accessibility threshold) · **Appearance** = *how it looks* (node size, border thickness, colorblind preset, sector colors). One panel with tabs rather than a second floating panel — panel proliferation is what crowds the map. |
| Node size | Panel → Appearance | Slider 2–9px, **0.25px steps** |
| **Node shape** | Panel → Appearance | Four toggles per swatch row (circle/square/triangle/diamond); legend marks follow |
| Border thickness | Panel → Appearance | Slider 0–5px (0 hides administrative borders) |
| Colorblind-safe palette | Panel → Appearance | Toggle → Okabe–Ito palette |
| Sector colors | Panel → Appearance | 5 swatches; legend auto-updates |
| Progression edges | Top bar | **Off by default**; toggle fades edges in (SPECS §1.3 — edges are the optional overlay) |
| Basemap | Top bar | plain (Carto positron) / satellite (Esri raster) / roads (Carto voyager) |
| Zoom +/− | Bottom-right | maplibre `NavigationControl` |
| **Re-center** | Bottom-right, above zoom | Waze-style: refits the view to the current area (same robust fit as auto-fit) |
| **Hide UI ("clear map")** | Bottom-right, above zoom | Hides header, panels, legend and drawer. The button **persists**, so the UI is always recoverable |
| Node popup | On click | Name + sector (right sidebar detail is deactivated — §6) |

Auto-fit: on tile/sector change, the map fits a **robust (2nd–98th percentile) bounding box** of visible nodes — ignores geocoding outliers that otherwise skew the center.

**The custom control stack must clear MapLibre's zoom block.** MapLibre's zoom block's top edge sits ~112px above the map's bottom edge, so `.ugnay-map-controls` sits at `bottom-32` (8rem), leaving a 16px gap. It shipped once at `bottom-20` and sat **directly on top of the zoom-IN button**, hiding it and swallowing every click on it — invisible to any check that doesn't hit-test. Guarded by **T10.4**; keep ≥ 8rem if either stack changes height.

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
- ~~**Progression edges**~~ — **SHIPPED, but as a second view rather than a map overlay. See §5B.**
- The focused progression fan on the map, incoming/"who feeds into me".
- The **sidebar drawer** (`ContinuityPanel`) — designed in Round 3 §5A.6, still unbuilt.
- TESDA qualification-family matching (M4/S5).

---

## 5B. The NETWORK VIEW — progression as a graph, off the map (Round 10 — 2026-07-13)

**Status: built.** `components/NetworkView.jsx` · `components/NetworkLegend.jsx` · `lib/progression.js` · `workers/forceLayout.worker.js`. Ruleset and pipeline: SPECS §A5, `scripts/s7_progression_chains.py`.

### 5B.1 Why it is not a map layer

§5A assumed progression would be drawn *on* the map. It should not be, and the reason is not aesthetic.

The map answers a **one-hop** question — *is there a next level nearby?* — and that question flatters reality. Adams Central Elementary has a junior high **0.76 km** away, so its gap halo is clean. Its nearest university is **63 km** away and its nearest TESDA centre **44 km**: a learner starting there cannot finish **any** pathway. Nationwide, **19,934 institutions have a next step and can never reach higher ed**. Every one is painted healthy today.

Seeing that requires seeing the **chain**, and on a map you cannot: position is already spent on coordinates, so a school with no onward pathway looks exactly like a school with a perfect one — a dot in a field of dots. In a force layout **position is the structure**. A stranded institution has nothing pulling it inward, so it drifts to the periphery and the eye finds it unprompted. We are not annotating the answer; the layout is letting the graph state it.

### 5B.2 Grammar — the graph starts blank, and filters are the question (rewritten, Round 12 — 2026-07-14)

**The first version got this wrong and has been replaced.** It spent *fill* on the verdict while *shape + a hairline ring* carried the sector, so every mark encoded two orthogonal things at once and a settled province read as noise. Worse, it answered a question nobody had asked: all three verdicts were painted at all times, competing, before the user had said what they were looking for.

| Channel | Map | Network |
|---|---|---|
| **Fill** | sector | **sector — the same colours**, and only once you ask for it |
| **Shape** | sector | sector (unchanged) |
| **Highlight** (halo + ring + full opacity + size) | — | **the verdict**, and only once you ask for it |
| **Position** | geography | **graph structure** |

**Nothing is on by default.** The canvas opens deliberately bland: every institution grey, every edge pale. That is not an empty state — the shape of the graph (the clusters, and the specks with nothing attached to them) *is already the finding*. The filters tell you **who** those specks are.

- **Verdict filter** (cut / dead-end / complete) — lights the matching institutions and **dims the rest to 28%**. It must not delete them: the claim being made is that the cut ones sit at the **rim** of the structure, and you cannot see a rim with nothing behind it. (A first pass dimmed the field to 9–14% and the strongest thing this view says collapsed into red dots floating in white.)
- **Sector filter** (three groups, five fill buckets) — **colours**, it does not hide. A learner's pathway runs through a TESDA centre whether or not you have TESDA switched on, so the network always graphs the whole loaded area (`NETWORK_SECTORS` in App). The map's sector toggles are therefore **hidden** in network view rather than left there doing nothing.

Verdict definitions are unchanged (SPECS §A5): **cut** (no next step within the threshold) · **dead-end chain** (has a next step, but nothing downstream ever reaches the end — *the state the map cannot show*) · **complete** · **N/A** (an assessment centre has no academic verdict, an HEI no tech-voc one; N/A is not a failure and is never painted as one).

**Bland ≠ invisible.** The neutral fill is `#94A3B8`, not `#CBD5E1`: the first attempt was so pale the whole graph was a smudge, which defeats the point of showing structure before anything is asked.

**The readout IS the verdict filter.** The counts and the switch that acts on them are one control, bottom-right. Reading a number here and then hunting elsewhere for the thing that lights it up is a worse product, and it makes the first move obvious on a canvas that opens deliberately empty of colour.

### 5B.3 The pathway lens
Academic and tech-voc are **separate lenses**, because SPECS §A5 tracks them separately: an SHS that can reach a training centre but no university is tech-voc complete and academic cut, and one merged verdict would hide *which* door is shut. The lens switches both the node verdicts and which edges are drawn.

**Reskilling (HEI → TESDA)** is an optional dashed overlay, off by default, and is excluded from the **forces** as well as from the chain walk — not just from the arithmetic. Letting it pull an HEI toward a training centre would fuse two clusters a learner cannot actually travel between, inventing connectivity in the one view whose whole job is to show its absence.

### 5B.4 Three sources of truth, and it matters which answers what
- **Chain verdict** ← the S7 node fields. Nationwide, exact, tile-independent.
- **One-hop verdict** ← the `nearest` index. Nationwide, exact, tile-independent.
- **Drawn edges** ← the `access` index. **Only among loaded, visible nodes.**

So a node at the edge of the loaded area may have neighbours we cannot draw — but its **verdict is still right**, because the verdict never consults the drawn edges. Computing "cut" from the drawn edges instead would brand a school stranded for no reason but the user's tile selection. The legend states the limit.

No new edge payload ships: a level you *need* next is by definition a level you *lack*, so every progression edge is already inside the accessibility adjacency the tiles carry, and `lib/progression.js` derives them.

### 5B.5 Implementation notes
- **Canvas, not SVG.** A region is ~6,700 nodes / ~25,000 edges; that many DOM nodes makes hover alone a slideshow.
- **Layout in a Web Worker** (`d3-force`), streaming positions back as it converges, so the graph visibly *settles* — watching clusters pull together and stranded nodes drift out is most of how the intuition gets built. Imported as `?worker`, **not** `new URL(...)`.
- **The network OVERLAYS the map; MapView is never unmounted or hidden.** Unmounting throws away the WebGL context and the fitted camera; `display:none` resizes its container to zero, which reallocates and clears that context's buffer — the same defect that made the map flash white on every click (§5). Leaving it mounted at full size underneath costs an idle map and nothing else.
- Charge softens as the graph grows (`-30 × clamp(900/n)`) or a big region blows itself apart; a weak `forceX/forceY` keeps the thousands of isolates at a 1 km threshold from drifting to infinity instead of settling into a readable halo around the core.
- The header already has a **"Tech-Voc" sector toggle**. The lens button says the same words and does a different job, so it carries an explicit `aria-label` ("Tech-Voc pathway").
- **`z-20`, not `z-10`, for anything that must be usable over the graph.** The network is a full-bleed `absolute inset-0 z-10` overlay that comes *later in the DOM* than the FilterPanel, so at an equal z-index it wins — and its canvas silently covered the whole panel. Everything still *looked* right, but nothing in it could be clicked in network view: **the threshold slider, which drives every edge and every verdict, was dead.** Found by Playwright's hit-target check (T15.6), not by looking at it.

### 5B.5b The transition — the map unfolds into the graph (Round 12)
The force layout is **seeded from the map's live projection** (`projectNode`, lent up from MapView through App). Frame zero of the network is therefore pixel-for-pixel the map the user was just looking at; the backdrop then fades up over ~700 ms while the forces pull it apart. You *watch* geography turn into structure, and the stranded institutions drift outward in front of you. Leaving is the same thing backwards: the graph folds back down onto the map's own pins (`MORPH_MS`, re-projecting **live** so it lands correctly even if the window was resized), then dissolves.

The seed is not decoration — it is a far better initial condition than d3's default phyllotaxis spiral (real clusters already start near each other), so it settles in fewer ticks. A **re-layout** (the threshold moved) seeds from the *current* positions at `alpha: 0.35`, so the graph is nudged rather than detonated, and the user's mental map of it survives.

**But a projection is not automatically a sane seed, and taking it on trust caused two bugs that looked unrelated** (both fixed 2026-07-14, `projectSeed`):

1. **A stray coordinate squeezed the whole graph.** ~115 institutions nationwide (0.17%) carry a coordinate belonging to a *different province* — "Sun Yat Sen High School **of Iloilo**" plots in Metro Manila. `road_unreliable` catches only 20% of them, because the point snaps to a road perfectly well; it is just the wrong road. **One is enough:** Quezon City's full extent is **66× wider** than the box holding 96% of its schools, so the auto-fit chased the stray and rendered the entire graph into a **46×49 px smudge — 0.2% of the canvas**. MapView never had this bug because it fits on percentiles (`robustBounds`); the network fit on raw min/max. That was the whole defect.
2. **The round-trip through "Show on the map" left a blank canvas.** That flies the camera to zoom 14; returning to the network re-seeded every node off *that* projection, so a province spanned hundreds of thousands of pixels. `forceCenter` only recentres the **mean** — it never shrinks the spread — and the zoom floor clamps at `0.05`, so the graph could not be framed at *any* zoom.

The seed is therefore **normalised**: rescaled only when the map's framing is grossly wrong (case 2 — at normal zoom the factor is exactly `1`, so the unfold stays pixel-perfect), and outliers **clamped** into the core box (case 1). Clamping a stray is not a fudge, it is the correct model — **in a force layout position is structure, not place**, so a wrong coordinate should never have been able to move a node here at all. It only could because we borrowed the map's geometry to start with. Clamped, the stray seeds into the crowd and the forces put it where its *edges* say it belongs: out in the isolate ring, with the other institutions that connect to nothing.

The **exit morph re-uses the same normalisation** (recomputed live, so it survives a resize) — otherwise leaving would fling the graph at exactly the coordinates the entry took care to avoid.

The auto-fit is now a **trimmed** extent, not a raw min/max: take the 2–98% box, widen it by 1.5× its own span, fit to everything inside that. It is a *trim*, not a percentile crop — fitting to the 2–98% box would cut the **isolate ring**, and the stranded institutions are the entire point of the view.

### 5B.5c Two performance bugs that made the settle unwatchable (Round 12)
Both were in code that "worked":
1. **The draw loop listed `progress` and `hover` in its dependency array.** A worker tick (60/s) tore the effect down, re-created the rAF loop, and re-assigned `canvas.width` — which **reallocates the canvas backing store**. We were rebuilding the canvas sixty times a second underneath the very animation we wanted people to watch. Everything the loop reads now lives in a ref (`sceneRef`); the effect depends on the canvas size and nothing else, and the progress bar is a direct style write.
2. **The worker ran the whole simulation in one synchronous `for` loop**, posting a frame every third tick. It finished as fast as the CPU could grind it out and dumped ~115 messages onto the main thread in a burst — nothing was paced to a frame, so the "animation" was whatever the browser managed to paint between floods. It now ticks for a frame's budget (~11 ms), posts once, and **yields** (`setTimeout(0)`; `requestAnimationFrame` does not exist in a dedicated worker).

### 5B.5d Trackpad pinch: React cannot do this one
A trackpad pinch does not arrive as a touch gesture — it arrives as a **`wheel` event with `ctrlKey` set**. React registers `wheel` as a **passive** listener on the root, so `preventDefault()` inside an `onWheel` prop is *silently a no-op*. Undefaulted, the browser page-zooms on top of us, which changes the layout, which fires the `ResizeObserver`, which **restarts the whole simulation**. The listener is bound by hand with `{ passive: false }`. The per-event step is also **capped at 1.25×**: devices disagree wildly about what `deltaY` means (a pinch may arrive as a stream of ±3s or as a single ±120), and without a cap a generous trackpad teleports you inside a node with no way back.

### 5B.5e "Show on the map" — the hand-off back to geography
Selecting a node in the graph always *did* select it on the map, but nothing said so, and an invisible effect is not a feature. The drawer now carries an explicit button with help text. It fires a **counter**, not a node (asking twice must fly twice), and App waits for the fold-back to finish before flying — the morph aims at where the pins are *now*, so moving the camera mid-morph would have the graph chasing a target running away from it.

### 5B.6 What it shows (Ilocos Norte, 3 km)
Academic: **213 cut · 198 dead-end · 78 complete** (65 N/A). Tech-voc: **203 · 191 · 143** (17 N/A). The two lenses genuinely disagree — which is the point of tracking them apart.

### 5B.7 Mobile — the same chrome rules as the map (Round 11 — 2026-07-13)

Follows §6A rather than inventing a second pattern: **one bottom sheet**, no floating panels.

- **The legend becomes a tab in the existing sheet**, exactly as the map's does — and it is the legend for the view you are *actually in*. The two grammars differ (map: fill = sector; network: fill = verdict), so showing the map's key over a network graph would be **wrong**, not merely unhelpful. `NetworkLegendBody` is exported for this, mirroring `LegendBody`.
- **Basemap and Gap Analysis leave the sheet in network view.** A basemap has no terrain to sit under and a halo has no pin to ring. The threshold slider **stays** — it governs the graph as much as the map.
- **The pathway lens stays on-canvas at every size.** It is the one control the view cannot do without, so it never gets buried in a sheet. 44 px targets on touch.
- **The readout becomes one row**, lifted clear of the collapsed sheet (44 px). Three stacked 200 px cards would eat a third of a phone's graph. It hides entirely when the detail sheet is up — that sheet is 60dvh and would cover it anyway, and racing it would just be two panels fighting for one corner.
- **The framing question is dropped on a phone** — three lines of prose over a ~600 px-tall graph, and the same sentence opens the legend tab.

**Pinch-zoom had to be built.** The canvas sets `touch-action: none` (without it, a drag scrolls the page), and that *also* disables native pinch. So on touch, zoom exists only if we implement it — and without zoom the view is useless on a phone: a settled province at 390 px is a cloud of 4 px dots, and inspecting the broken ones is the entire point. One finger pans, two pinch about their midpoint, a tap selects.

**Two bugs worth remembering, both of which made a broken thing look fine:**
1. `setPointerCapture` was called **before** registering the pointer. It throws `NotFoundError` for any pointer the browser doesn't consider active — including every synthetic one — so the handler aborted before a single finger was recorded and **pinch silently did nothing**. Capture is an enhancement (it keeps a drag alive past the canvas edge), not a precondition: it now runs last, in a `try`.
2. MapView stays **mounted underneath** this view (§5B.5), so `document.querySelector("canvas")` finds **MapLibre's** canvas, not this one. A whole pinch test was dispatched at the wrong element and reported success. The network canvas now carries `data-testid="network-canvas"`.

Both were caught only because the test asserted the **view changed** (pixel sample before/after) rather than that the events *fired*. A gesture test that checks dispatch is a test that passes on a dead feature.

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

## 6A. Mobile — a different chrome, not a smaller one (Round 9 — 2026-07-12)

SPECS §3.5 commits to **mobile-first**. Until round 9 the phone view was simply the desktop view at 390px, and it failed exactly as you'd expect: the top bar's controls **ran off the right edge**, and the two floating panels (Layers & Filters, Legend) **sat on top of the map**, which is the one thing the user came for.

The breakpoint is **`max-width: 639px`** (Tailwind's `sm`), read once in `lib/useIsMobile.js` and shared by the JS branches and the CSS — if the two disagreed you'd get a bottom sheet laid out for a desktop drawer.

| Piece | Desktop | Mobile | Why |
|---|---|---|---|
| **Header** | Wordmark, Change area, sector toggles, gap analysis, basemap | **Wordmark + Change area only** | Everything else is a *map control*. A phone has no room for a button bar **and** two floating panels; the controls move to where the other controls are. |
| **Layers & Filters** | Floating panel, top-right, open by default | **One bottom sheet**, collapsed to a handle by default (**~94% of the map visible on arrival**), opening to **≤70vh**. Tabs: **Filters · Appearance · Legend**. Absorbs the sector toggles, gap analysis and basemap. | The map must be readable the moment you land. A sheet you opt into beats a panel you must dismiss. |
| **Legend** | Its own floating panel, bottom-left | **A tab inside the sheet** | Two bottom-anchored panels would fight for the same corner of a short screen. |
| **Detail view** | 18rem right drawer, slides in horizontally; map pans **left** to clear it | **Full-width bottom sheet** (60vh), slides up; map pans **up** to clear it | An 18rem side drawer on a 390px screen leaves a ~100px slit of map. |
| **Viewport units** | `vh` is fine | **`dvh` everywhere** (`h-[100dvh]`, `60dvh`, `70dvh`) | `vh` is the **largest** viewport — it deliberately ignores the browser's URL/nav bars, so the app's bottom edge (and the "Explore map" button with it) sat *underneath* them until the chrome auto-hid. `dvh` tracks the chrome live. |
| **Zoom +/− and attribution** | Bottom-right | **Lifted 4.5rem** so they clear the collapsed sheet | The zoom is unusable under the sheet — and the **attribution must stay visible**: CARTO / OSM / Esri require it. Burying it is a licensing problem, not a cosmetic one. |

Both detail shells still slide on a **transform** and **overlay** the map — neither resizes it (see round 6: resizing the map container reallocates MapLibre's WebGL buffer and flashes it white).

## 6B. Accessibility — the one rule we hold to

SPECS §3.5 lists accessibility as *"not committed (open)"*. This is the first thing actually committed to, because breaking it is silent:

> **No `aria-hidden` container may contain focusable controls.**

A panel that is merely *clipped* to zero height still holds its checkboxes, sliders and buttons in the **tab order and the accessibility tree** — so a keyboard or screen-reader user lands inside a panel that, as far as they have been told, does not exist. (It is also a plain ARIA violation.) Every collapsible — the filter-panel body, the Legend body, the GeoPicker's province/municipality sections, and the **closed detail drawer** (whose ✕ stayed tabbable) — is **`inert`** when hidden. Enforced by test **T1.2**, which walks the DOM and fails on any `aria-hidden="true"` element still containing a focusable control.

Also honoured: **`prefers-reduced-motion`** zeroes the transitions (motion here is decoration; nothing is conveyed by it alone).

## 6C. Component map (`platform/frontend/src/`)

| File | Role |
|---|---|
| `App.jsx` | State + layout; two-phase orchestration; basemap/edges/size/colour/**shape** state; desktop-vs-mobile chrome branch |
| `components/SetupView.jsx` | Landing card (area + sector layers → Explore); pinned footer; backdrop-instant / card-fade entrance |
| `components/GeoPicker.jsx` | Region/province/municipality drill-down; `Collapse` (grid `0fr→1fr`, `inert` when shut) |
| `components/MapView.jsx` | maplibre map; 3 **symbol** node layers + gap-halo + hover-ring + edges; select/hover/fit; re-center & hide-UI controls |
| `components/FilterPanel.jsx` | Filters + display controls. **Floating panel on desktop, bottom sheet on mobile** (same content, two shells) |
| `components/Legend.jsx` | Floating legend (desktop) + exported `LegendBody`, reused as the sheet's Legend tab |
| `components/ShapeMark.jsx` | The SVG mark shared by the legend and the shape picker — so the legend can't claim a shape the map isn't drawing |
| `components/DetailDrawer.jsx` | Pinned-institution detail. Right drawer (desktop) / bottom sheet (mobile) |
| `components/ContinuityPanel.jsx` | **To be reactivated** as the folded right-drawer (node detail + gap-layer area summary — §5.6) |
| `hooks/useTiles.js` | Tile + admin_index fetch/cache/evict |
| `lib/nodeShapes.js` | **SDF shape images** (circle/square/triangle/diamond) + `icon-size` mapping; re-registered on every `style.load` |
| `lib/useIsMobile.js` | The single breakpoint, shared by JS and CSS |
| `lib/nodeIcons.js` | Arc-icon generator — **unused** (round-1 arcs; kept for optional return) |

*Planned (edge/progression build, §5):* edge Source/Layer in `MapView.jsx` (one-hop fan, hover-tease radial clip, click-commit); Gap Analysis layer (halos + legend); a reachability helper to compute a selected node's one-hop edges + nearest-option distances from tile `edges`/`neighbor_nodes`.

## 7. Change log

**Round 12 (2026-07-13) — the reveal, for real; and two rules worth keeping.**

Round 11 claimed the nodes faded in. They did not: they faded in, **vanished, and popped back**.
Chasing it produced two constraints that now bind anything animated on this map.

- **A MapLibre paint property that changes KIND cannot be animated — in either direction.**
  `DataDrivenProperty.interpolate(a, b, t)` returns **`a`, the prior value**, whenever either
  side is non-constant. Not "no tween" — it *strands the old value on screen for the full
  duration and then cuts*. So an `icon-opacity` that is an expression at rest and a number
  during a reveal will keep painting the **old expression** for 450 ms when you hide it (the
  nodes stay lit and pop in tile by tile as the area streams) and **snap** when you show it.
  - **Rule: keep an animated paint property a plain number at all times.** Per-feature
    variation belongs in the colour's **alpha channel** (`icon-color` / `icon-halo-color`),
    which stays an expression permanently and so never changes kind. The SDF shader multiplies
    colour alpha by `icon-opacity`, so the two compose to exactly what one expression gave you.
    This also stops the reveal from forcing a source relayout on every phase change.
- **An animation is only as good as the frames the main thread can spare.** Two stalls were
  eating this one, and neither was visible in the paint properties:
  - the **boundary GeoJSON is 3.4 MB / 6.6 MB** and `res.json()` parses it **on the main
    thread**. Fetched at Explore time, it froze the browser for ~400 ms *inside* the fade —
    zero frames painted. It is now fetched during **setup**, where a stall is invisible.
  - **symbol placement** runs after the tile JSON parses and blocks too, so the fade waits for
    **`moveend`** on the 800 ms flight. Not a timer, and not the data being ready:
    `isSourceLoaded("nodes")` reports true at **~8 ms** (before `setData` is applied) and
    `idle` arrives **1–1.6 s after touchdown** because it waits on the basemap CDN.
  - **Rule: before tuning a transition's duration, check whether the browser is painting at
    all during it.** Sample the *evaluated* value per frame and look at the frame *gaps*.
- **State that must be visible in the very next painted frame is derived during render, not in
  an effect.** Effects run *after* paint, so hiding the nodes in one cost ~140 ms — enough for
  the new area's first tiles to flash up at full opacity.

**Round 11 (2026-07-13) — mojibake, the landing preamble, and motion.**
- **`ñ` mojibake repaired at the source of truth.** Three school names carried `Ã±` (a double-encoded `ñ`). The corruption is upstream in `project_coordinates`; Ugnay now normalises at ingest (`modules/text_clean.py`, wired into S1) and **S6 fails the build** rather than ship a corrupt tile. In a country of Parañaque and Los Baños this is a credibility problem, not a typo.
- **The map NEVER resizes any more.** The header became an **overlay** rather than a flex sibling — required so that "clear map" can slide it away without pulling it out of the flow and resizing the canvas. That removes the last remaining source of WebGL-buffer clears (see round 6). Panels are positioned to clear the 48px header (`top-14`); the auto-fit's 60px padding already exceeds it, so fitted institutions never land underneath.
- **Nodes fade in with the camera.** They used to render tile-by-tile as the area streamed in, while the camera re-fitted on *every arriving tile*. The fit is now gated on `loading`, so the camera flies **once**. (The *reveal* itself — a multiplier on the opacity expression — was still broken; see Round 12.) **T2.4.**
- **"Clear map" is a directional slide** — each panel to its own edge (header ↑, Layers →, Legend ←, drawer →). The map is *revealed*, and the exit shows where each panel went. Hidden panels are `inert`. **T10.2.**
- **Landing preamble** (§2): two columns on desktop, stacked on mobile. Answers what this is, what you can do (three verbs), what it covers (real figures), and — up front, not buried in the legend — **what it does not say**: reach is not enrolment. The mobile variant is *compact*; the desktop markup stacked on a phone pushed the region picker below the fold.

**Round 9 (2026-07-12) — node shapes + a real mobile design.**
- **Node shapes** (circle/square/triangle/diamond) as a **second encoding channel**, per swatch. The three sector layers became **SDF symbol layers**; one greyscale image per shape, recoloured by the same `match` expression the circle layers used, so live colour edits and the colorblind palette keep working. Default grammar: **shape = sector, fill = public/private within it**. §3.
  - Two silent failure modes, both now guarded: the **SDF encoding** (edge must land at alpha 0.75, TinySDF's convention) and **`setStyle` dropping every added image** — i.e. every basemap switch would have made all institutions vanish (**T9.6**).
  - **Tradeoff:** symbol layers can't read `feature-state`, so the hover "grow" became a **ring underneath**. The pinned state was already expression-driven and is unaffected.
- **Mobile is now designed, not inherited** (§6A): slim header; the sector toggles / gap analysis / basemap move into **one bottom sheet** (collapsed by default → ~94% of the map visible); Legend becomes a sheet tab; the detail view becomes a **full-width bottom sheet** and the map pans **up**; zoom **and the attribution** are lifted clear of the sheet (attribution visibility is a CARTO/OSM licence requirement).
- **Landing fixes:** the hint now names the *first* action ("Pick a region", not "Pick at least one province" — there are no provinces yet); "Explore map →" moved into a **pinned footer** so growing the card can't push it below the fold; the province/municipality sections **grow** instead of popping; and the card **fades in again on first load** — only the *backdrop* must be opaque from frame one (that's what hides the empty map), so the card can fade over it.
- **Accessibility rule adopted and enforced** (§6B): no `aria-hidden` container may hold focusable controls; all collapsibles and the closed drawer are `inert`.

**Round 10 (2026-07-12) — the shape rollout's own bugs, and the legend typeset.**
- **White squares behind every node on satellite** — the SDF halo was flooding the icon quad at small node sizes. Root cause and the two rules that now prevent it: §3, "The bitmap size is not a free parameter". **T9.7.**
- **"Higher Ed — Public" truncated** in the shape picker — swatch + label + four toggles don't fit one row in a 256px panel. Each sector is now a two-row block. **T9.8.**
- **Mobile: `vh` → `dvh`.** The primary action hid under the browser's nav bar until the chrome auto-hid. §6A.
- **Legend typeset.** The caveats stay on screen (they're load-bearing, not footnotes) but gain structure: three bands — *what the marks mean* → *how to read it* → *what this does not say* — with micro-headings, term/definition rows, and an accent rule on the honesty band.

**Round 8 (2026-07-12) — shipped, then caught by the first real E2E run.**
- **The zoom-IN button was unclickable in production.** The new re-center / hide-UI stack sat at `bottom-20`, directly on top of it: the "+" was hidden and every click on it hit the hide-UI button. Moved to `bottom-32` (16px of clearance). No `curl` check could have seen this — it took a browser hit-test. §4, **T10.4**.
- **`tests/e2e/`** added: a Playwright runner for `TESTS.md` (now 41 scenarios), plus the four traps that make map tests *silently lie* — canvas-vs-viewport click coords, `jumpTo()` being inert under react-map-gl's controlled mode, accessible names being the raw DOM text, and province/municipality name collisions. See `TESTS.md`.

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
