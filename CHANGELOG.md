# Changelog

Notable changes to the Ugnay platform. Newest first. Dates are absolute.

The live app is **https://ecair-eics-project.web.app** (Firebase Hosting). Deployment
details: `documentation/deployment.md`.

**Versioning:** `v0.MINOR.PATCH` (SemVer pre-1.0).
- **PATCH** — fixes, copy edits, refinements, performance improvements.
- **MINOR** — a new capability: a new view, a new feature set, a new data contract field.
- **MAJOR** held at 0 while the platform is in active research development and the tile
  data contract may change. Bumped to 1.0 when the contract and core views are locked.
- The version lives in `package.json` and is displayed in the landing preamble. The commit
  that bumps `package.json` is the version commit; it should be the first commit of the
  entry it belongs to.

---

## v0.4.3 — 2026-07-15 (latest) — Popup flash fix, filter fade transitions

### Fixed
- **Hover popup no longer flashes at the top-left on "Explore map".** Root cause: the popup
  was unmounted whenever `revealed = false` (between area changes) and remounted when
  `revealed = true`. Every time a MapLibre popup mounts, it starts at the container's origin
  (0,0) for one frame before the library positions it — that is the flash. The popup now
  stays mounted as long as any valid node exists, parked on the first available node.
  Visibility is controlled entirely by the `--off` CSS class. This is the same "mount once,
  always move" principle the original fix used; the regression was introduced when the
  `if (!revealed) return null` guard caused unmounting on every area change.

### Changed
- **Sector and subcategory filter toggles now fade nodes instead of hard-popping them.**
  Toggling Basic / Higher / Tech-Voc sectors, or any sub-level (ES / JHS / SHS / Training /
  Assessment), previously caused nodes to appear and disappear instantly. They now fade out
  over 120 ms, the new set fades in over 250 ms. Area reveals are unaffected (450 ms, same
  as before). The fade uses the same `icon-opacity` mechanism as the reveal; only a constant
  value is ever written to it, so MapLibre's transition engine can tween it.

---

## v0.4.2 — 2026-07-15 — Preamble copy, platform versioning

### Added
- **Platform version displayed in the landing preamble.** A faint `v0.4.2` line below the
  ECAIR credit (`text-[10px]`, `text-blue-200/25`). Version is sourced from `package.json`
  and inlined at build time via Vite's `define`; updating it requires only a `package.json`
  bump. See the versioning standard above.

### Changed
- **"Switch to Network" copy made more concise.** Was: "…to see the full pathway as a graph:
  which chains of institutions can reach a university or assessment center, and which dead-end
  before they get there." Now: "…to see which institution chains complete, and which
  dead-end." Cuts 60% of the word count without losing the signal.

---

## v0.4.1 — 2026-07-15 — Smoother network settle, stable camera, CHED labels, shapes inline

### Changed
- **Network settle no longer skips frames.** The force worker previously ran up to 6 ticks
  per frame regardless of simulation phase. During the first ~32 ticks (alpha > 0.35) forces
  are at their strongest and nodes move the most per tick — 6 ticks in one frame produced
  position jumps large enough to read as a skipped video frame. The worker now caps to
  1 tick/frame while alpha is above that threshold, then opens the throttle back to 6 for
  the convergence tail where per-tick movement is small.

- **Camera no longer drifts during settling.** The previous incremental tracking (lerp toward
  fit every 4 frames) made the graph appear to slowly zoom out for the full duration of the
  simulation. Replaced with a two-step approach: on cold entry the camera is fixed at 1.5×
  more zoomed-out than the seed's fit, so the graph settles within a stable frame; when the
  worker signals done, the camera eases to the final fit over 600 ms. Panning or zooming
  during settling cancels the end-ease and preserves the user's position.

- **HEI sector labels renamed to use the agency name.** "Higher Ed (Public)" and
  "Higher Ed (Private)" are now **"CHED (Public)"** and **"CHED (Private)"** throughout
  the platform (Layers & Filters, Appearance, network legend Sectors tab, detail drawer).
  Consistent with DepEd and TESDA, which already use their agency names.

- **Shape picker restored to a single row in Appearance.** The previous release moved shapes
  to a second line below each sector label to prevent truncation of "Higher Ed (Public/Private)".
  With the shorter CHED labels that constraint is gone. Shape buttons compacted from 24px to
  20px (`w-5 h-5`, `gap-px`, ShapeMark size 10), bringing the picker to ~83px, which fits
  beside the label on one line without truncation.

---

## v0.4.0 — 2026-07-15 — Network view: directed edges, partial verdict, chain highlight, faster settle

### Added
- **Directed arrowheads on progression edges.** Filled triangles at the target end of each
  non-reskilling edge, drawn as a second render pass after the edge lines. Only rendered when
  zoom `k > 0.35` — below that they would collapse smaller than the line width they are
  attached to. When chain highlight is active, arrowheads are suppressed for any edge whose
  source or target is outside the reachable set, because a pointer at a nearly-invisible node
  would read as contradictory.

- **"Partial" verdict — a fourth pathway verdict.** An SHS with no HEI within the threshold
  but a TESDA training centre within reach is not cut: the tech-voc door is open, the college
  door is shut, and those are different policy situations. "Partial" (`#0891B2`,
  "Alternative pathway") names that gap so it cannot be confused with either outcome.
  Computed client-side from the existing `nearestIndex` data — no pipeline rerun required.
  `VERDICTS` is now `["cut", "partial", "deadend", "complete"]`; `STATUS_ORDER` places partial
  before cut (painted worst-last) so a cut node is never buried under a partial one.

- **SHS → TESDA edges visible in both pathway lenses.** Previously, `shs>tesda_training`
  edges were absent from the academic view because TESDA training is not an academic step.
  A `shsBranch` exception in `progressionEdges()` now draws those edges regardless of the
  active pathway. The rationale: TESDA centres deploy programs to nearby Grade 12 students,
  and a school can only offer TESDA courses if a centre is within reach — that relationship
  exists independent of which lens the user has open.

- **"Highlight chain" button in the detail drawer.** Selecting a node in the network view
  now offers a button that runs a BFS along forward (non-reskilling) edges from that node
  and dims everything outside the reachable set to **5% opacity**. The verdict filter's 28%
  dim was tried first; a screenshot confirmed it was indistinguishable from ordinary verdict
  filtering. At 5% the chain is unmistakable. The button label flips between
  "Highlight chain" and "Clear highlight"; the highlight resets automatically when the
  selection changes.

- **Sector filter button color sync.** The three top-panel filter buttons (Basic / Higher /
  Tech-Voc) now derive their dot color from the live `sectorColors` map instead of a
  hardcoded Tailwind class. Changing "TESDA" from purple to black in Appearance now updates
  the Tech-Voc button to match.

### Changed
- **Legend panel is now tabbed.** The "How to read this" panel previously stacked all four
  content blocks in a single scrollable column — at smaller screen heights it exceeded the
  viewport and buried the caveats below a scroll. It now has three tabs: **Verdicts /
  Sectors / Notes**. Opens on Verdicts. Each tab shows only its own content; the panel
  height stays compact regardless of screen height.

- **Corrected the TESDA copy in the Notes tab.** The previous text said "Grade 12 students
  can elect tech-voc instead of college." That reverses the mechanism. TESDA centres deploy
  their programs to nearby Grade 12 students — a school can only offer TESDA courses if a
  centre is within reach. The network edge (SHS → TESDA centre) already models this
  correctly; only the description of it was wrong.

- **Force settle and camera tracking are roughly 3x faster.** `alphaDecay` raised 0.02 →
  0.028 (simulation ticks: ~342 → ~244, -29%). Camera lerp: factor 0.12 → 0.20, frame skip
  `% 8` → `% 4` (one update every 67 ms instead of 133 ms). Camera now converges in ~1.5 s
  instead of ~5 s. Combined with the shorter simulation, the visible zoom-out ends in ~3 s
  instead of ~10 s. The seeded starting position (from the map's projection) is already a
  close approximation, so 244 ticks is enough to find clean structure.

---

## 2026-07-14 — Branding, SEO, and preamble

### Added
- **Agency logos** (`public/logos/deped.svg` + `ecair.png`) throughout the platform. Brand
  rule: **DepEd always left of ECAIR**.
  - **Landing preamble** (`SetupView.jsx`): white rounded pill above the "Ugnay" title,
    sized for both desktop and compact (mobile) variants.
  - **Explore header** (`App.jsx`): logos at `sm:` breakpoint and above; thin divider
    before the "Ugnay" wordmark. Subtitle moved from `sm:` → `lg:` to reclaim space.
  - **"This platform is developed by the Education Center for AI Research."** added to the
    preamble footer.
- **Network view** added as a fourth bullet in the landing preamble
  ("Switch to Network to see the full pathway as a graph…").
- **`public/og-image.png`** — 1200×630 social card generated with headless Chromium
  (`scripts/gen_og_image.mjs`): dark-blue gradient, DepEd + ECAIR pill, "Ugnay" at 88 px,
  tagline, `ugnay.cair.ph` domain hint.
- **Open Graph + SEO tags** in `index.html`: `meta name="description"`, keywords, author;
  `og:type/url/title/description/image` (+ width/height hints), `og:site_name`,
  `og:locale`; Twitter Card (`summary_large_image`). Discord/Slack/LinkedIn now show a
  preview card when the link is shared.

### Changed
- `og:url` and `og:image` now point to `https://ugnay.cair.ph/` (canonical).
  The image thumbnail in Discord loads once the domain's TLS cert provisions; title and
  description show immediately on the `web.app` URL.

---

## 2026-07-14 — a trailing space was killing the map

`Failed to execute 'add' on 'DOMTokenList': The token provided must not be empty.` The whole map
view, replaced by an error card, right after pressing **Explore map**. Intermittently.

**MapLibre applies a popup's `className` with `split(" ")` and no filter:**

```js
for (const t of this.options.className.split(" ")) this._container.classList.add(t);
```

One trailing space produces an empty token, and `classList.add("")` throws. The popup's className
was built as `` `ugnay-popup ugnay-popup--hover ${visible ? "" : "--off"}` `` — which leaves
exactly that trailing space **whenever the card is visible**.

It only detonated if the popup's **first** mount was a visible one, which is why it looked random.
That needs the cursor to be sitting over the map as a new area lands — i.e. exactly where the
cursor is right after you click Explore. Institutions are held at opacity 0 during the reveal, but
**MapLibre still hit-tests them**, so a hover fired for a node that wasn't on screen yet, and that
hover (rather than the anchor node) is what first brought the popup into existence.

Introduced by the popup-deferral change two commits earlier: gating the anchor on `revealed` is
what allowed a *hover* to be the popup's first mount.

Fixed twice over: the className is now a filtered `join(" ")` (no empty token is possible), and
nothing is hoverable while the area is still revealing (a tooltip for an invisible node was wrong
anyway).

**The failure mode is the lesson.** React's ErrorBoundary caught the throw, so it never surfaced as
a console error or a `pageerror` — the E2E suite reported *"CONSOLE ERRORS: none"* while the map
was a blank panel. **T2.5** now drives a cursor across the map through an entire reveal and asserts
the boundary is absent; it fails on the pre-fix build. Suite: **56/56**.

---

## 2026-07-14 (later) — one bad coordinate was steering the camera

Two bugs that looked unrelated, and were the same bug: **the force layout was seeded straight
off the map's projection, and the projection was taken on trust.**

**A stray coordinate squeezed the whole graph.** About **115 institutions nationwide (0.17%)**
carry a coordinate belonging to a *different province* — "Sun Yat Sen High School **of Iloilo**"
plots in Metro Manila; "St. Elizabeth Montessori **of Baguio**" plots in Metro Manila; a
Quezon City school plots in Mindanao. `road_unreliable` catches only 20% of them, because the
point snaps to a road perfectly well — just the wrong road. **One is enough.** Quezon City's
full extent is **66× wider** than the box holding 96% of its schools, and the network's
auto-fit chased the stray: the entire graph rendered into a **46×49 px smudge, 0.2% of the
canvas**. The map never had this bug, because it fits on percentiles (`robustBounds`). The
network fit on raw min/max. That was the whole defect.

**And the round-trip through "Show on the map" left a blank canvas.** That flies to zoom 14;
coming back re-seeded every node off *that* projection, so a province spanned hundreds of
thousands of pixels. `forceCenter` only recentres the **mean** — it never shrinks the spread —
and the zoom floor clamps at `0.05`, so the graph could not be framed at *any* zoom. It
scattered off-screen and no amount of zooming brought it back.

The seed is now **normalised** (rescaled only when the map's framing is grossly wrong — at
normal zoom the factor is exactly 1, so the unfold stays pixel-perfect) and outliers are
**clamped** into the core box. The exit morph re-uses the same normalisation. The auto-fit is a
**trimmed** extent — deliberately a trim and not a percentile crop, because cropping to 2–98%
would cut the **isolate ring**, and the stranded institutions are the entire point of the view.

Clamping a stray is not a fudge: **in a force layout, position is structure, not place.** A
wrong coordinate should never have been able to move a node here — it only could because we
borrowed the map's geometry to start with. Clamped, it seeds into the crowd and the forces put
it where its *edges* say it belongs.

The **115 bad records are still bad** — this fixes the view, not the data. They are worth
handing back to `project_coordinates` as a data-quality finding.

**T16 (2 scenarios)** pins both, and both were verified to **fail on the pre-fix build** rather
than assumed to. Suite is now **55/55**.

---

## 2026-07-14 — the network stops shouting; the map stops flashing

Round 12. The network view shipped legible-in-principle and unreadable-in-practice, and three
of its defects were the kind that **look like successes**.

### The grammar was wrong, and it has been replaced
Fill carried the *verdict* while shape and a hairline ring carried the *sector*, so every mark
encoded two orthogonal things at once — and all three verdicts were painted at all times,
before the user had asked anything. A settled province read as noise.

Now: **fill = the sector** (the map's own colours, so the two views agree), **highlight = the
verdict**, and **nothing is on by default**. The canvas opens deliberately bland — grey nodes,
pale edges. That is not an empty state: the clusters and the loose specks *are already the
finding*, and the filters tell you **who** they are.

- Lighting a verdict **dims the rest to 28%**, it does not delete them. The claim is that the
  cut ones sit at the **rim** of the structure, and you cannot see a rim with nothing behind
  it. (A first pass dimmed the field to 9–14% and the strongest thing this view says collapsed
  into red dots floating in white.)
- Sector filters **colour**, they do not hide. The network always graphs the whole loaded
  area — a learner's pathway runs through a TESDA centre whether or not you have TESDA
  switched on. The map's sector toggles are therefore *hidden* here rather than left inert.
- The **readout is the filter**: the counts and the switch that lights them are one control.

### The map now unfolds into the graph
The force layout is **seeded from the map's live projection**, so frame zero of the network is
pixel-for-pixel the map you were just looking at; the backdrop fades up while the forces pull
it apart. Leaving folds it back down onto the map's own pins. The seed is not decoration — it
is a much better initial condition than d3's spiral, so it settles in fewer ticks.

### Three bugs that made a broken thing look fine
1. **The settle was unwatchable, and it was self-inflicted.** The draw loop listed `progress`
   in its dependency array, so every worker tick (60/s) tore down the rAF loop and re-assigned
   `canvas.width` — **reallocating the canvas backing store sixty times a second**, underneath
   the very animation it was meant to show. Separately, the worker ran the whole simulation in
   one blocking loop and dumped ~115 messages on the main thread in a burst. It now ticks for a
   frame's budget and yields.
2. **Trackpad pinch could only zoom out.** A pinch arrives as `wheel` + `ctrlKey`, and React
   registers `wheel` as a **passive** listener — so `preventDefault()` in an `onWheel` prop is
   silently a no-op. The browser page-zoomed on top of us, which resized the layout, which
   restarted the simulation. Bound by hand now with `{ passive: false }`, and the per-event step
   is capped at 1.25× (devices disagree wildly about what `deltaY` means).
3. **The filter panel was unclickable over the graph.** The network is a full-bleed
   `absolute inset-0 z-10` overlay that comes *later in the DOM* than the `z-10` FilterPanel, so
   its canvas was swallowing every click — **the threshold slider, which drives every edge and
   every verdict, was dead** while looking perfectly normal. Caught by Playwright's hit-target
   check, not by looking at it.

### The map's hover card stopped strobing in the corner
MapLibre defers popup DOM writes onto its render-task queue, so a popup **created** on hover
spends its first frames *unpositioned at the container's origin* — the top-left corner. Sliding
between two schools crosses bare map, which unmounted and rebuilt it every time. Delaying the
reveal by a frame did **not** fix it (measured: still `transform: matrix(1,0,0,1,0,3)` six
frames in — any time-based reveal is racing a queue we don't control). It is now **mounted once,
at load, and only ever moved**. There is no frame in which it can be both in the corner and
visible, because there is no frame in which it is created and visible.

### Also
- **"Show on the map"** in the detail drawer — an explicit hand-off from a node in the graph to
  its place on the ground, with help text. Selecting a node always *did* select it on the map,
  but nothing said so, and an invisible effect is not a feature.
- **T15 (8 scenarios)** closes the coverage gap: the network view had **zero** regression tests
  and was verified only with throwaway scripts. Suite is now **53/53**.

---

## 2026-07-13 — progression returns, as a network; and a graph of nothing

The map asks a **one-hop** question — *is there a next level nearby?* — and that question
**flatters reality**. Adams Central Elementary has a junior high **0.76 km** away, so its gap
halo is clean. Its nearest university is **63 km** away and its nearest TESDA centre **44 km**:
a learner starting there can finish **no pathway at all**.

> Nationwide, one-hop "cut" at 5 km is **22.7%**. **Chain-incomplete is 48.7%.**
> **19,934 institutions have a perfectly good next step and can never reach higher ed.**
> ~1,600 clusters (~8,500 institutions) are richly connected internally and contain **no HEI
> and no assessment centre anywhere inside them**.

### Added
- **S7 — `scripts/s7_progression_chains.py`** (4 s). Reverse-BFS from each pathway's terminal,
  nationwide, at every slider threshold, over S2b road distances. Ships four fields per node:
  `{academic,techvoc}_{applies,min_km}`. **The one thing the browser cannot derive** — a chain
  can walk clean out of the loaded area. The *edges* stay client-derived, since a level you
  need next is by definition a level you lack. → SPECS §A5
- **The Network view** — progression as a force-directed graph, **off the map**. Geography is
  dropped on purpose: on a map, position is spent on coordinates, so a school with no onward
  pathway looks exactly like one with a perfect pathway. Here **position is the structure** — a
  stranded institution has nothing pulling it inward and drifts to the edge. `d3-force` on a
  canvas in a worker; no deck.gl, no graph DB. → `frontend_design.md` §5B
- **Two pathways, tracked separately** (academic → higher ed; tech-voc → assessment centre). An
  SHS that reaches a training centre but no university is tech-voc complete and academic cut;
  one merged verdict would hide **which door is shut**.
- **Mobile chrome** for the Network view: legend becomes a tab in the existing bottom sheet
  (and it is the legend for the view you are *in* — the two grammars differ). **Pinch-zoom had
  to be hand-built**: `touch-action: none` is required so a drag doesn't scroll the page, and it
  also kills native pinch. → §5B.7

### Fixed — *the graph of nothing*
The Network view shipped to production while the GCS bucket still held **pre-S7 tiles**.
`academic_applies` came back `undefined`, which is falsy, so all **3,825** institutions on
screen were reported *"not on this pathway"* and the readout showed **0 · 0 · 0**. Build green,
deploy green — and the product silently asserting that no school in the country has a broken
pathway, the exact opposite of what it exists to say. **It looked finished.**

The defect was not the missed upload. It was that **the contract between the pipeline and the
frontend was never written down, so nothing could check it.**
- **`platform/frontend/src/lib/tileContract.js`** — the contract, declared **once**, read by
  **both** sides.
- **`scripts/check_tile_contract.mjs`** — a CI gate that refuses the deploy. It runs on `dist/`
  **after** staging, because `dist/` is what ships (and `prepare_deploy.sh` has had its own
  bugs). It checks structure → type/range → **signal**: a pipeline emitting `applies: false`
  for every institution, or `min_km: 0` for every one, would pass a presence check perfectly and
  still be worthless.
- The browser now **fails loudly** on stale tiles (violet graph + banner) instead of rendering
  confident zeros.

### Changed
- **Tiles slimmed 183.2 MB → 73.9 MB (-60%).** Worst tile (NCR) **6.9 MB → 1.7 MB**. Dropped
  three payloads **nothing read**: `edges` (S3 — **72.6% of every tile**, and on *haversine*
  distances), `neighbor_nodes`, `continuity` (S4 — same stale distances). Dead weight nobody
  reads is waste; stale numbers sitting **in** the product are a trap. → SPECS §A6
- **S3 and S4 are superseded** and now say so in their headers. Their cross-sector distances are
  straight lines. SPECS §1.9's area-continuity % is not lost — the Network readout answers it
  from road distances, and answers a *stronger* version of it.
- Setup card subtitle → **"Education Institutions Map"**, matching the header.

### Known gaps
- **The E2E suite has no Network-view coverage.** The 45 scenarios are all map/setup.
- **T2.4 is genuinely flaky** (~1/3), not a regression — it counts animation frames under a
  software renderer.
- TESDA matching is still **role-based only** (M4/S5) → tech-voc completeness is **optimistic**.

---

## 2026-07-13 — the reveal *really* fades: fade → vanish → pop

Reported: after **Explore map**, the map zooms in, the nodes fade in, then **disappear**, then
**re-appear with a pop**. Two independent causes, both confirmed by sampling MapLibre's
evaluated paint value frame by frame.

### Fixed
- **`icon-opacity` must never change KIND.** The previous fix was built on a half-right reading
  of MapLibre. The real rule:
  ```js
  // maplibre-gl/src/style/properties.ts — DataDrivenProperty
  interpolate(a, b, t) {
      if (a.value.kind !== 'constant' || b.value.kind !== 'constant') return a;  // ← the PRIOR
  }
  ```
  It returns **`a`** — the *prior* value — for the transition's whole duration, then snaps.
  So the three-phase reveal paid a penalty at **both** hand-overs:
  - hiding (expression → constant `0`) kept painting the **old expression** for a full 450 ms.
    Measured: the nodes stayed lit and **popped in tile by tile as the area streamed**, then
    blanked at once. That is the "fade in → disappear".
  - revealing (constant → expression) **snapped**. That is the "pop".

  `icon-opacity` is now a **plain number at all times** (`0 → 1`, which MapLibre does tween),
  and every per-node alpha — the dim toggle, the pinned node's fan — moved into the **alpha
  channel of `icon-color` / `icon-halo-color`**, which stay expressions permanently and so
  never change kind. MapLibre multiplies colour alpha by `icon-opacity` in the SDF shader, so
  the two compose to exactly what the single expression used to produce. The reveal is now one
  boolean, and it also stopped forcing a source relayout on every phase change.
- **A 400 ms main-thread stall sat inside the reveal.** The boundary files are **3.4 MB**
  (provincial) and **6.6 MB** (municipal), and `res.json()` parses them **on the main thread**.
  They were fetched at Explore time, so the browser painted **no frames at all** for ~400 ms
  during the fade — which turns any fade into a pop however it is declared. They are now
  fetched during **setup**, so the parse happens while the user is reading the preamble and
  picking an area, when nothing is animating.
- **The fade now starts on `moveend`**, not on a timer. Symbol placement runs *after* the tile
  JSON parses and blocks the main thread; a fade started earlier gets no frames. The two
  obvious gates are both wrong: `sourcedata`/`isSourceLoaded("nodes")` reports loaded at
  **~8 ms** (before `setData` is even applied), and `idle` arrives **1–1.6 s after touchdown**
  because it waits on the basemap CDN.
- **The hide is now derived during render**, not in an effect. An effect runs after the browser
  paints, so the nodes stayed visible for ~140 ms after Explore and a few dozen of the new
  area's nodes flashed up before the hide took hold.

### Verified
- On a **settled** map the same property tweens exactly as declared — `1.000 → 0.993 → 0.969 →
  0.662 → 0.388 → 0.216 → 0.110 → 0.049 → 0.017 → 0.002 → 0`, reaching zero at 487 ms. The
  machinery and the configuration are right; any remaining compression in CI is this
  container's software renderer dropping frames, not the app.
- **T2.4 rewritten again.** The previous version asserted only that intermediate opacities were
  *observed*, which is hostage to the frame rate. It now asserts the **structural** property —
  `icon-opacity` is never data-driven on any frame — plus that the nodes are still at opacity
  **0** on the first frame their tile reaches the source. Negative control: re-introducing the
  data-driven opacity fails it 150/150 frames.
- 45/45 green, three consecutive runs.

---

## 2026-07-13 (later) — the reveal actually fades; landing overflow; stale popup

> **Superseded.** The MapLibre rule stated below is **wrong**: `DataDrivenProperty.interpolate`
> returns **`a`** (the prior), not `b`, when either side is non-constant — which is why the
> reveal still misbehaved after this change. See the entry above.

### Fixed
- **The node reveal SNAPPED instead of fading.** The cause is a MapLibre rule that is easy to
  miss: **it does not interpolate DATA-DRIVEN paint properties.** `DataDrivenProperty.interpolate(a, b, t)`
  returns `b` outright unless *both* sides are constants. Our `icon-opacity` is an expression
  (it reads `dim` and `node_id`), so **any** transition on it was ignored and the change
  landed instantly — no duration would ever have fixed it. The fade now runs on a **constant**
  (`0 → 0.92`, which MapLibre does interpolate) and hands back to the expression once it
  lands, where the expression already evaluates to the same value so the hand-over is invisible.
  - The old test asserted the *declared* `icon-opacity-transition` duration — which was
    correct while the thing visibly popped. **T2.4** now samples MapLibre's **evaluated**
    opacity every frame and fails unless it sees real intermediate values.
- **"Explore map →" was unreachable on DESKTOP** once a province + municipality list was open.
  The landing card is a 2-column grid, and **a grid row is sized to its content**, so the
  right column grew past the card's `max-height`; because the card is `overflow-hidden`, the
  pinned footer was clipped straight off the bottom. `md:grid-rows-[minmax(0,1fr)]` constrains
  the row so the columns scroll *inside* the card. Guarded by **T1.6**.
- **A stale hover popup flashed in the top-left corner.** `hoverNode` was never cleared on an
  area change, so the popup for a node from the *previous* region kept rendering — at a
  lng/lat now far outside the view, which MapLibre transforms to a large negative offset. It
  is now cleared on every Explore, and the popup additionally refuses to render for a node
  that has left the current index or has a non-finite coordinate (an invalid `LngLat` makes
  MapLibre throw, and a throw inside its update path can take the render loop down with it).

### Added
- **WebGL context-loss recovery.** A lost GL context freezes the canvas on its last frame:
  the map stops responding to drags and to the zoom buttons and any popup sticks at the
  origin, while the React chrome around it keeps working — and only a reload fixes it, because
  MapLibre does not recover on its own. The app now asks the browser to restore the context
  and, failing that, remounts the map with a fresh one (the tiles are already in memory, so
  this costs a re-fit, not a re-download).

### Changed
- **Preamble copy**: dropped "side by side for the first time" (it read as a boast) in favour
  of what the combined view *makes possible* — "Seeing DepEd, CHED and TESDA together turns
  three separate inventories into one question you can act on: where does a learner run out
  of options?"

---

## 2026-07-13 — mojibake repair, landing preamble, motion

### Fixed
- **`ñ` was mojibaked in three school names.** `Concepcion Peque**Ã±**a NHS`,
  `Monta**Ã±**eza NHS`, and `Tinorongan NHS (Formerly Sag**Ã±**ay Western HS)` — `Ã±` is
  `ñ` double-encoded (UTF-8 bytes read as Latin-1, then re-encoded). The other **865** `ñ`
  in the data were fine, so this was corrupt *source* data, not an app encoding fault.
  In a country full of Parañaque, Los Baños and Santo Niño this is not cosmetic: a planner
  who sees "MontaÃ±eza NHS" reasonably concludes the whole dataset is untrustworthy.
  - **Root cause is upstream** — `project_coordinates`' gold parquets (3 `school_name` +
    **222** `barangay` in public, **41** `barangay` in private). Ugnay carries only `name`
    into its tiles, so only the 3 names were user-visible here; **the 263 barangays still
    need fixing at source** for other consumers.
  - **`modules/text_clean.py`** repairs it, and **S1 now normalises at ingest** so Ugnay can
    never emit mojibake regardless of what upstream sends. **S6 fails the build** if a tile
    would ship with it. `scripts/repair_tiles_mojibake.py` fixed the already-built tiles so
    the correction ships without a full OSRM re-run.

### Changed
- **Nodes no longer pop in.** They used to render tile-by-tile as the area streamed in,
  while the camera *re-fitted on every arriving tile*. Now the map waits for the whole area,
  flies once, and the institutions **fade up during the flight** — reveal and motion are one
  gesture, not two competing ones.
- **"Clear map" is now a directional slide.** Each panel exits toward its own edge — header
  up, Layers right, Legend left, drawer right (300ms) — instead of vanishing. The map is
  *revealed*, and the exit shows where each panel went, so restoring reads as reversible.
  - **The map now NEVER resizes.** The header became an overlay to make this possible, which
    removed the last remaining source of WebGL-buffer clears (hiding the UI used to pull the
    header out of the flex flow and resize the canvas). Canvas is a constant 1440×900.

### Added
- **A landing preamble.** Two columns on desktop (what this is, on the left; the choices, on
  the right), stacked on mobile. It answers, before the user touches anything: what this is,
  what they can do with it (three verbs), what it covers (**real** figures — 47,607 public ·
  8,257 private · 2,431 HEIs · 7,891 TESDA), and — up front rather than buried in the legend
  — **what it does not say**: reach is not enrolment.
  - The mobile preamble is a **compact** variant. The desktop markup, stacked on a 390px
    screen, pushed the region picker below the fold — so every visit would have begun by
    scrolling past a wall of text to reach the one control you came for.

### Tests
- **44/44.** New **T2.4** (nodes held hidden while loading, then faded in with the camera).
  **T10.2** rewritten: it now asserts the *directional slide* (header ↑, panel →, legend ←)
  and that the hidden chrome is `inert` — the panels stay mounted now, so "is it in the DOM"
  no longer means anything.

---

## 2026-07-12 — shape/halo fixes, mobile viewport, legend typesetting

### Fixed
- **Every node had a translucent white SQUARE behind it on the satellite basemap.** The
  icon halo was flooding the whole icon quad. MapLibre's SDF shader derives the halo cutoff
  as `buff = (6 − iconHaloWidth / iconSize) / 8`; with a 64px bitmap, `icon-size` was
  `nodeSize/20`, so at the small end of the slider (nodeSize 3.25 → 0.1625) a **fixed** 1px
  halo asked for `1 / 0.1625 = 6.15 > 6` — `buff` went negative and the shader painted the
  entire quad with the halo colour. Invisible on the light basemap, glaring on satellite,
  which is why it shipped.
  Now structurally impossible, not merely avoided: a **40px bitmap** doubles the headroom,
  and halo widths are **proportional to node size**, so `haloWidth / iconSize` is a
  **constant 2.5** (selected: 3.0) at every slider position instead of varying. Guarded by
  **T9.7**, which walks the whole slider range and fails if the ratio ever reaches 6.
- **"Higher Ed — Public" was truncated to "Higher Ed — P…".** The swatch, label and four
  shape toggles needed ~280px on one row in a 256px panel. Each sector is now a two-row
  block (swatch + full name, then the shape toggles). Guarded by **T9.8**.
- **On mobile you had to wait for the browser's URL/nav bars to auto-hide before "Explore
  map →" was tappable.** The app was sized in `vh`, which is the **largest** viewport —
  it deliberately ignores the browser chrome, so the app's bottom edge sat underneath it.
  Everything now sizes in **`dvh`** (dynamic viewport height), which tracks the chrome as
  it shows and hides. Guarded in **T14.1**.

### Changed
- **The Legend is typeset, not stacked.** The caveats stay fully on screen — they are
  load-bearing, not footnotes — but they now have structure instead of being grey text
  trailing off the panel: three bands in the order a reader needs them (**what the marks
  mean** → **how to read it** → **what this does not say**), consistent micro-headings,
  scannable term/definition rows for the edge encoding, and an **accent rule** setting off
  the honesty band.

---

## 2026-07-12 — mobile redesign + node shapes

### Added
- **Per-sector node shapes** (circle / square / triangle / diamond), chosen next to each
  colour swatch in Appearance. Implemented as **SDF symbol layers**: one greyscale image
  per shape, recoloured at draw time by the same `match` expression the circle layers used,
  so live colour edits and the colorblind palette keep working untouched.
  Shape is a **second encoding channel** — it survives greyscale printing and stays readable
  for colour-vision deficiency, where the five fills can collapse into two or three. The
  default is meaningful rather than decorative: **shape = sector** (DepEd ○, higher-ed △,
  TESDA □), **fill = public/private within it**. The legend renders the real marks.
  - Hover "grow" moves to a ring underneath the node — MapLibre symbol layers cannot read
    `feature-state`, so the pinned/hover emphasis could not stay on `icon-size`.

### Mobile — a deliberate design, not a shrunken desktop
Previously the phone view was the desktop view at 390px: the top bar's controls ran off the
right edge, and two floating panels sat on top of the map.
- **Header** is now identity + "Change area" only. The sector toggles, gap analysis and
  basemap switch **move into the sheet** — they are map controls, and a phone has no room
  for a row of buttons *and* two floating panels.
- **One bottom sheet**, collapsed to a handle by default, so **94% of the map is visible on
  arrival**. Opens to ≤70vh with three tabs: **Filters · Appearance · Legend**. The Legend is
  a tab rather than a second floating panel, which would have fought for the same corner.
- **Detail view is a bottom sheet** (full-width) instead of an 18rem side drawer, which on a
  390px screen left a ~100px slit of map. Selecting a node now pans the map **up** to clear
  it, rather than sideways.
- **Zoom +/- and the attribution are lifted clear of the sheet.** Attribution must stay
  visible — CARTO/OSM/Esri require it.

### Fixed
- **Landing hint told you to do something you couldn't yet do.** With no region chosen it
  read "Pick at least one province" — but there are no provinces until a region is picked.
  It now reads **"Pick a region"**, then tracks the selection as before.
- **The primary action could fall below the fold on mobile.** Choosing a region grew the
  card and pushed "Explore map →" out of reach behind a nested scroll. The card is now a
  flex column with a **pinned footer**, so the button is always on screen.
- **Region selection popped.** The province / municipality sections now **grow** into place
  (`grid-template-rows: 0fr → 1fr`, which animates to the content's true height — a
  max-height would need a magic number that clips a long list or crawls for a short one).
- **The landing card now fades in** — including on first load. The earlier flash fix had
  removed the fade entirely; only the **backdrop** needs to be opaque from frame one (it's
  what hides the empty map). The card fades and rises over it, so there is nothing to see
  through.
- **Accessibility:** collapsed panels, the collapsed sections, and the closed detail drawer
  were `aria-hidden` while still holding focusable controls — an ARIA violation that let a
  keyboard user tab into panels that, as far as they were told, did not exist. All are now
  `inert`. Enforced by a test rule: *no `aria-hidden` container may contain focusable
  controls.*

### Tests
- **41/41** passing, including new **T9.5** (shapes), **T9.6** (shape images survive a
  basemap switch — `setStyle` drops every image the app added, and without re-registering
  them on `style.load` every institution silently vanishes), and the **T14 mobile group**
  (T14.1–T14.7: reachable primary action, the hint, header overflow, sheet collapsed by
  default, sheet contents, zoom/attribution clearance, bottom-sheet detail + pan-up).

---

## 2026-07-12 — `6430acb` (second deploy)

First change shipped through the push-to-deploy CI. Live ~90 s after the push.

### Fixed
- **The zoom-in button was unclickable in production.** The re-center / hide-UI stack shipped
  earlier today sat at `bottom-20`, which placed it *directly on top of* MapLibre's
  zoom-**IN** button: the "+" icon was hidden and every click on it hit the hide-UI button
  instead (a 32 px overlap; a hit-test at the centre of "+" returned the custom stack). Moved
  the stack to `bottom-32` (8 rem), clearing MapLibre's zoom block by 16 px. Reproduced and
  fixed at 1440×900, on a 390×844 phone viewport, and with the detail drawer open (the
  −18 rem slide preserves the vertical gap).

### Added
- **`tests/e2e/`** — a Playwright runner implementing `TESTS.md` (32 browser scenarios; the
  served-artifact contract is checked with `curl`). Run it with
  `cd tests/e2e && npm install && npm run test:prod`.
- **`TESTS.md`**: new regression test **T10.4** (the custom controls must never cover the
  zoom +/-, and both zoom buttons must actually change the zoom), plus a "gotchas" section
  recording four traps that produce *false* test results: canvas-relative vs viewport-relative
  click coordinates (the ~45 px header offset), `map.jumpTo()` being inert under
  react-map-gl's controlled mode, accessible names being the raw DOM text rather than the
  CSS-transformed text (`plain`/`satellite`/`roads`, not "Plain"…), and province/municipality
  name collisions (e.g. *Quezon City*).

### Verified (against the deployed build)
- **32/32** browser scenarios pass, **zero console errors**; the served-artifact contract is
  intact (`admin_index.json` and tiles return JSON with `no-cache`, boundaries return
  `application/geo+json`, the SPA fallback returns HTML, both bundles 200).
- T10.4 failed against the previous build and passes against this one — the bug and the fix
  are both confirmed on the live site.
- The regression tests were negative-controlled: re-introducing the load flash, the snappy
  panel, and the integer slider each makes the corresponding test fail, so the green run is
  meaningful rather than vacuous.

---

## 2026-07-12 — initial deploy

### Deployed
- **Initial production deployment** to Firebase Hosting on GCP project `ecair-eics-project`
  → https://ecair-eics-project.web.app. Static SPA + tiles/boundaries; no backend.
- **Push-to-deploy CI** (`.github/workflows/deploy.yml`): a push to `main` touching the
  frontend or deploy config auth's with a service account, pulls the gitignored
  tiles/boundaries from `gs://ecair-ugnay-tiles/` (cached), stages via
  `prepare_deploy.sh`, and deploys. Docs-only commits do not deploy.

### Added
- Persistent map controls above the zoom +/- (bottom-right):
  - **Re-center** button — refits the view to the current area's institutions (Waze-style).
  - **Hide-UI / clear-map** toggle — hides the header, panels, legend, and drawer for an
    unobstructed map; a persistent button restores them.
- **`TESTS.md`** — Playwright-driven end-to-end scenarios mapped to SPECS features, the
  served-artifact contract, and the new controls.
- **`documentation/deployment.md`** — as-built deployment runbook (architecture, the
  Firebase-setup pitfalls we hit and fixed, CI, operations).

### Fixed
- **Load flash:** the landing page no longer flashes the empty map for a frame on
  load/refresh — the setup view now appears instantly on first load (the fade-in is kept
  only for "Change area" re-entry).
- **Layers & Filters panel** collapse/expand now rolls smoothly (max-height + opacity),
  matching the Legend, instead of snapping between two layouts.

### Changed
- **Node size** slider is now continuous (0.25 px steps) instead of integer steps.
- `prepare_deploy.sh` now also stages `output/boundaries/` into `dist/` (previously only
  tiles, which 404'd the admin borders in production).

### Known issue at the time (fixed in `6430acb`, above)
- The new control stack covered MapLibre's zoom-in button, making it unclickable. This
  shipped in the initial deploy and was caught by the first full E2E run against production.

---

## Pending
- Custom domain `ugnay.cair.ph` — CNAME exists; Firebase TLS cert pending domain
  verification. `og:url` and `og:image` already point there.
- Delete stray `ecair-eics-project-537f7` Firebase project.
- No favicon yet.
- Analytics + privacy review (SPECS §3.5).
- ~115 wrong-province coordinate records need upstream fix in `project_coordinates`.
