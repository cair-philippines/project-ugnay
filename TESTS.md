# Ugnay — End-to-End Test Scenarios
_Playwright-driven. Ugnay is a **static single-page app + static JSON data** — there is no backend, no auth, and no API. Tests therefore exercise the frontend behaviour, the served-artifact contract, and the SPECS feature set. See Setup below._

Cross-reference: feature intent lives in `documentation/SPECS.md`; the served-file contract in `documentation/firebase_deployment_brief.md` §2.

---

## Setup

### What "the app" is
A Vite + React 19 + MapLibre GL + deck.gl SPA that fetches static tiles/boundaries. No login, no roles, no database. Every test is either a **browser** test (Playwright) or a **data-contract** test (`curl` against the served files).

### Run targets
Point Playwright at whichever is being tested:

| Target | URL | Use when |
|---|---|---|
| **Production** | `https://ecair-eics-project.web.app` | Verifying a live deploy (post-CI) |
| **Local dev** | `http://localhost:5173` | Iterating on the frontend (`npm run dev` in `platform/frontend/`) |
| **Local preview** | `http://localhost:4173` | Testing a production build locally (`npm run build && npm run preview`) |

> The dev/preview servers must run inside `experiments-innovations-lab` (the only container with ports mapped to the host). Production needs no local server.

### Automated runner (`tests/e2e/`)
The whole suite below is implemented as a script. From `tests/e2e/`:
```bash
npm install                 # playwright-core only; reuses the cached Chromium
npm run test:prod           # against https://ecair-eics-project.web.app
node suite.cjs http://localhost:5173   # or any other target
```
It needs a Chromium binary. If Playwright's browser cache is present, point at it:
`~/.cache/ms-playwright/chromium-*/chrome-linux/chrome` (the script already does). In a
container, launch with `--no-sandbox --use-gl=swiftshader --enable-unsafe-swiftshader` so
WebGL renders in software — MapLibre then draws for real and map assertions are meaningful.

### Five gotchas that will silently break your tests
Each of these produced a *false* result before being fixed — they cost real debugging time:

1. **Map pixels ≠ page pixels.** `map.project()` is relative to the **canvas**;
   `page.mouse.click()` takes **viewport** coords. Always add the canvas's
   `getBoundingClientRect()` origin — never hard-code an offset. (It happened to be ~45 px
   while the header was a flex sibling; the header is now an *overlay* and the canvas is
   full-bleed, so the origin is 0,0 — which is exactly why you read it rather than assume it.)
   Get this wrong and every node click lands off-target and misses *silently*, since clicking
   empty map is a no-op.
2. **`map.jumpTo()` from `evaluate()` does nothing.** react-map-gl drives the map in
   *controlled* mode, so programmatic camera moves are reverted. Pan with a **real gesture**
   (`mouse.down`/`move`/`up`) or via the app's own controls.
3. **Accessible names are the raw DOM text, not what you see.** The basemap buttons' text is
   `plain`/`satellite`/`roads` (CSS `capitalize` renders them "Plain"…), and "LEGEND" is
   CSS-uppercased. `getByRole("button", { name: "Satellite" })` matches **nothing**. Use a
   case-insensitive regex.
4. **The same name can be both a province and a municipality** (e.g. *Quezon City* in NCR).
   Province checkboxes render before municipality ones — disambiguate with `.first()` / `.last()`.

5. **MapLibre does not interpolate DATA-DRIVEN paint properties — and "does not interpolate"
   is worse than it sounds.**
   ```js
   // maplibre-gl/src/style/properties.ts — DataDrivenProperty
   interpolate(a, b, t) {
       if (a.value.kind !== 'constant' || b.value.kind !== 'constant') return a;  // ← the PRIOR
   ```
   It returns **`a`**, the prior value, for the transition's *whole duration*, and only then
   snaps to the new one. So a paint property that switches between a constant and an
   expression is not merely un-animated:
   - **expression → constant**: keeps painting the **old expression** for `duration` ms, then cuts.
   - **constant → expression**: snaps at once.

   A reveal that hides the nodes by writing `0` over an expression therefore leaves them fully
   lit for 450 ms — long enough for the new area's tiles to stream in and pop up one by one —
   and *then* blanks them. That was the real bug, and no duration would ever have fixed it.
   Keep such a property a **plain number at all times** (constants *do* interpolate) and put
   any per-feature variation in the colour's **alpha channel**, which stays an expression
   permanently and so never changes kind.

   Testing it: a test that asserts the declared `*-transition` duration **passes while the
   thing visibly pops**. Assert the *structure* — that the evaluated value is never data-driven
   (`map.style._layers[id].paint.get(prop).constantOr(NaN)` is never `NaN`) — because that is
   what makes a fade possible at all. Counting interpolated frames is a weak check on its own:
   this container renders in software and drops frames, so a *correct* 450 ms fade can be
   sampled only two or three times.

6. **An ErrorBoundary makes a crash INVISIBLE to a console-error check.** A React error boundary
   catches the throw, so it never becomes a `pageerror` or a console error — the suite happily
   reports "CONSOLE ERRORS: none" while the map view is a blank panel reading *"Something broke
   in the map view"*. That is exactly how a `DOMTokenList` crash shipped to production. **Assert
   the boundary is absent** (`text=Something broke in the map view`), don't rely on error events.

7. **MapLibre applies a popup/marker `className` with `split(" ")` and NO filter:**
   ```js
   for (const t of this.options.className.split(" ")) this._container.classList.add(t);
   ```
   One trailing space ⇒ an empty token ⇒ `classList.add("")` throws *"The token provided must not
   be empty"* and takes the whole map down. So **never** build such a className by interpolating a
   possibly-empty string (`` `a b ${on ? "" : "c"}` `` leaves a trailing space). Join a filtered
   array instead.

Also: **assert on state, not on text that is always present.** The detail drawer is always
mounted (it slides in on a transform), so its "INSTITUTION" heading is in the DOM even with
nothing selected. Test drawer-open via the `.ugnay-drawer-open` class, not its text.

### Playwright MCP (alternative)
If using the MCP browser inside `experiments-innovations-lab` and navigating to a **host** URL
(e.g. `172.17.0.2:5173`) rather than the public HTTPS URL, connect the docker bridge first:
```bash
docker network connect bridge experiments-innovations-lab
```

### Probe hook (use this to assert map state)
`MapView` publishes the live MapLibre instance to `window.__ugnayMap` once the map loads. In Playwright:
```js
// current zoom / center
await page.evaluate(() => window.__ugnayMap.getZoom())
await page.evaluate(() => window.__ugnayMap.getCenter())
// how many institution features are rendered
await page.evaluate(() => window.__ugnayMap.querySourceFeatures("nodes").length)
// how many accessibility edges are drawn for the pinned node
await page.evaluate(() => window.__ugnayMap.querySourceFeatures("edges").length)
```
Prefer this over pixel-peeping the canvas — WebGL content is invisible to the accessibility snapshot.

### Stale browser lock
If Playwright reports "Browser is already in use":
```bash
docker exec experiments-innovations-lab bash -c \
  "rm -f /home/jupyter/.cache/ms-playwright-mcp/mcp-chrome-for-testing-*/Singleton*"
```

### Screenshot caveat
Screenshots may fail inside the container for want of system libs; when they work, save to a file and `Read` it. Map WebGL may render blank in a screenshot even when correct — assert via `window.__ugnayMap` and the DOM, not the picture.

### A reusable "get into the map" helper
Many tests below assume you are already in the map view for a known area. The canonical fast path:
1. Navigate to the target URL.
2. In the setup card: pick Region, ensure ≥1 province is selected (a region defaults to **all** its provinces), leave the three sectors on.
3. Click **Explore map →**.

Use a small, dense area for speed (e.g. a single municipality) and one large one (e.g. Quezon City / a full region) for the performance checks (T12).

---

## T1 — Setup / Area Selection (SPECS §1.2)

### T1.1 Landing card renders
**Pre-condition:** Fresh load of the app URL.

**Steps:**
1. Navigate to the target URL.

**Expected:**
- Centered card titled "Ugnay" + "Educational Pathway Explorer".
- Step 1 "Area" with a Region picker; Step 2 "Education sectors" with three toggles (Basic Education, Higher Education, Technical–Vocational), all **on** by default.
- "Explore map →" button present but **disabled** (no region chosen yet).

**What to check if broken:** `admin_index.json` must load (network 200) for the Region picker to populate — see T11.1.

---

### T1.2 Region → province default (provincial terminal)
**Pre-condition:** On the landing card.

**Steps:**
1. Choose a region with ≥2 provinces.

**Expected:**
- All provinces of that region become selected by default.
- The scope hint reads "Province-wide — all institutions across N provinces".
- The municipality picker is **disabled/absent** (2+ provinces ⇒ provincial terminal, SPECS §1.2 table).

---

### T1.3 Single province → municipal terminal
**Pre-condition:** On the landing card, a region chosen.

**Steps:**
1. Deselect provinces until **exactly one** remains selected.

**Expected:**
- The municipality picker becomes **active** (multi-select, 1..all municipalities).
- Scope hint: "Whole province (all municipalities)" when none picked; "Municipal view — N municipality/ies" once you pick some.

---

### T1.4 Select-all / clear provinces
**Steps:**
1. Use the "select all provinces" affordance → all provinces selected.
2. Use "clear" → none selected.

**Expected:** Selection count updates; "Explore map →" disables when zero provinces are selected.

---

### T1.5 Explore gating
**Expected:** "Explore map →" is enabled **only** when (≥1 province selected) **and** (≥1 sector on). With zero sectors, the button is disabled and a hint reads "Select an area and at least one sector to continue."

---

## T2 — Landing → Map Transition

### T2.1 No load flash (regression for the 2026-07-12 fix)
**Pre-condition:** A hard reload / first load of the app URL.

**Steps:**
1. Reload the page and watch the first ~500 ms closely (record a trace or slow-mo if possible).

**Expected:** The landing card is present **immediately** at full opacity over an opaque backdrop. The map behind it is **never** visible for even one frame.

**What to check if broken:** `SetupView` must receive `instant={true}` on first load (App passes `!enteredMapRef.current`). If the backdrop fades in from `opacity-0` on first load, the empty map shows through — that is the flash. The fade-in is intended **only** for "Change area" re-entry.

---

### T2.2 Explore transition
**Steps:**
1. Complete a valid selection, click "Explore map →".

**Expected:** The setup card fades out over ~300 ms, revealing the map with the area's institutions fitted into view. No white flash of the map canvas.

---

### T2.3 "Change area" fades in over the live map
**Pre-condition:** In the map view (explored at least once).

**Steps:**
1. Click "← Change area" in the header.

**Expected:** The setup card **fades in** smoothly over the current map (not an abrupt pop). This is the one path where the fade-in is intended.

---

### T2.4 Nodes are held back, then fade in with the camera
**Why:** institutions used to render the instant *their own tile* landed, so they popped in unevenly, tile by tile — while the camera **re-fitted on every arriving tile** (`fitKey` changes per tile). Two competing motions. The first fix for this looked right and still popped, for the reason in gotcha 5.

**Steps:**
1. Arm a per-frame sampler recording MapLibre's *evaluated* `icon-opacity` on `nodes-basic` plus the node count in the source.
2. Click **Explore map →**, let the area settle, and read the trace back.

**Expected:**
- `icon-opacity` is a **plain number on every frame** — never data-driven. This is the load-bearing assertion: it is the only thing that lets MapLibre tween it (gotcha 5). Per-node alpha (the dim toggle, the pinned node's fan) lives in the **alpha channel of `icon-color` / `icon-halo-color`**.
- On the **first frame a tile's nodes reach the source**, opacity is still **0** — they are held back, not popped in one tile at a time.
- The declared `icon-opacity-transition` is 450 ms, and the trace passes through real intermediate values on the way to 1.

**What to check if broken:**
- The fit/reveal effect in `MapView` must be gated on `loading`, or the camera re-fits per tile and judders.
- The fade must start on **`moveend`** of the 800 ms flight. Not on a timer, and not on the data being ready: symbol *placement* runs after the tile JSON parses and blocks the main thread, so a fade started any earlier gets no frames and lands as a single step. Neither obvious gate works — `sourcedata`/`isSourceLoaded("nodes")` fires at ~8 ms (before `setData` is even applied), and `idle` fires 1–1.6 s *after* touchdown because it waits on the basemap CDN.
- The boundary GeoJSON (3.4 MB provincial / 6.6 MB municipal) must be fetched during **setup**, not at Explore. `res.json()` parses it on the main thread; loading it at Explore time put a ~400 ms stall inside the reveal, during which the browser painted *no frames at all* — which turns any fade into a pop no matter how it is declared.

---

## T3 — Map Render & Boundaries (SPECS §1.5)

### T3.1 Institutions render as pins
**Pre-condition:** In the map view for a populated area.

**Steps:**
1. `await page.evaluate(() => window.__ugnayMap.querySourceFeatures("nodes").length)`

**Expected:** Count > 0 and roughly matches the area's institution count. Pins are colored by sector (see Legend).

---

### T3.2 Auto-fit to area
**Expected:** On entering the map (and on sector change), the view fits the loaded institutions (robust 2–98th percentile bounds, `maxZoom: 14`). Outliers (a mis-coordinated school in open sea) do not blow out the view.

---

### T3.3 Boundaries follow the selection level
**Steps:**
1. Enter via a **multi-province** selection → expect **provincial** borders.
2. Enter via a **single province with specific municipalities** → expect **municipal** borders.

**Expected:** `borders` source is populated; border thickness respects the Appearance "Border thickness" control (0 hides them). Borders are muted grey, drawn beneath the pins.

**What to check if broken:** `provincial_boundaries.geojson` / `municipal_boundaries.geojson` must load (T11.3).

---

## T4 — Basemaps (SPECS §1.5)

### T4.1 Basemap toggle
**Steps:**
1. In the header, click **plain**, then **satellite**, then **roads**.

**Expected:**
- plain → CARTO positron; roads → CARTO voyager; satellite → Esri World Imagery raster.
- Pins, edges, halos, and boundaries survive each style switch (they are re-added after the style loads).
- No uncaught console errors on switch.

**What to check if broken:** External basemap CDNs (carto, arcgisonline) must be reachable and not blocked by CSP. Custom map controls and node layers must re-attach after `style.load`.

---

## T5 — Sector Layers & Filters (SPECS §1.2, §2.5)

### T5.1 Header sector toggles gate nodes
**Steps:**
1. Toggle **Basic** off.

**Expected:** All public/private school pins disappear; higher-ed and tech-voc remain. Node count (`querySourceFeatures("nodes")`) drops accordingly. Re-toggling restores them.

---

### T5.2 FilterPanel subcategory checkboxes
**Pre-condition:** Layers & Filters panel open, Filters tab.

**Steps:**
1. Under Basic Education, uncheck "Elementary (ES)".

**Expected:** ES-only schools are removed from the map; integrated schools that also offer JHS/SHS remain (membership is per-capability, `lib/graph.js`).

---

### T5.3 Dim (fade, don't hide)
**Steps:**
1. Click the ◐ button next to a visible subcategory.

**Expected:** That subcategory's nodes stay on the map but drop to low opacity (context preserved, not deleted). The ◐ button is disabled when the subcategory is unchecked (hidden).

---

## T6 — Accessibility Threshold & Node Selection (SPECS §1.3, §3.3)

### T6.1 Click a node → accessibility edges
**Pre-condition:** In the map view.

**Steps:**
1. Click an institution pin.

**Expected:**
- Edges are drawn to every institution within the threshold **by road** that offers something the clicked one lacks (`querySourceFeatures("edges").length` > 0 where such neighbours exist).
- Edge color = destination sector; edge width = nearness (nearer = thicker).
- The clicked node grows and gets a dark stroke; connected nodes stay bright; unrelated nodes fade back.
- The detail drawer slides in from the right.

---

### T6.2 Threshold slider changes the fan
**Steps:**
1. With a node pinned, drag "Road distance threshold" from 5 km to 1 km.

**Expected:** The number of edges **decreases** (fewer institutions within 1 km). Dragging back to 5 km restores them. The slider is a 1–5 km preset (ticks 1–5).

---

### T6.3 Selecting a node under the drawer pans (never resizes)
**Steps:**
1. Click a node on the far right of the map.

**Expected:** The map **pans** left just enough to bring the node clear of the 18 rem drawer. It must **not** resize (a resize clears MapLibre's WebGL buffer → white flash). No flash on click.

---

## T7 — Gap Analysis (SPECS §1.9)

### T7.1 Toggle gap halos
**Steps:**
1. In the header, click "Gap analysis".

**Expected:**
- Non-terminal institutions get halos: **amber** (next level exists but beyond the threshold) or **red** (none within 5 km).
- The button flips to "Hide gap analysis" (amber active state).
- The Legend grows a "Gap analysis" section explaining amber/red + the role-based-matching caveat.

---

### T7.2 Gap halos respect the threshold
**Steps:**
1. With gap analysis on, change the threshold.

**Expected:** Amber/red classification updates (a node reachable at 5 km but not at 2 km flips amber as you tighten the band). `road_unreliable` institutions are **not** haloed (suppressed per SPECS A2).

---

## T8 — Legend

### T8.1 Legend collapse/expand is smooth
**Steps:**
1. Click the Legend header to collapse, then expand.

**Expected:** The body rolls up/down over ~300 ms (max-height + opacity), the bottom edge stays put, width is constant. Collapsed state shows a row of sector color dots.

### T8.2 Legend reflects live colors
**Expected:** Sector swatches match the current `sectorColors` (including after a colorblind toggle or a manual color change). Gap legend appears only when gap analysis is on.

---

## T9 — Appearance Controls (Layers & Filters → Appearance tab)

### T9.1 Panel collapse is smooth (regression for the 2026-07-12 fix)
**Steps:**
1. Click the "Layers & Filters" header to collapse, then expand.

**Expected:** The body **rolls** open/shut over ~300 ms (max-height + opacity), exactly like the Legend — no instant pop/swap. The chevron rotates 180°. The panel keeps its width; only the body height animates.

**What to check if broken:** The panel must be a single persistent shell whose body animates — not two different DOM trees swapped on `open`. If it snaps, the old pill-swap regressed.

---

### T9.2 Node size is continuous (regression for the 2026-07-12 fix)
**Steps:**
1. On the Appearance tab, drag "Node size".

**Expected:** Node radius changes in fine **0.25 px** steps (not integer jumps); the readout shows fractional values (e.g. "4.25px"); pins scale smoothly. Range 2–9 px.

---

### T9.3 Border thickness
**Steps:**
1. Drag "Border thickness" to 0, then to 5.

**Expected:** At 0 the admin borders vanish (opacity 0); at 5 they are thick. Step 0.5.

---

### T9.4 Sector colors + colorblind palette
**Steps:**
1. Change a sector's color via its swatch.
2. Toggle "Colorblind-safe palette".

**Expected:** Pins, edges (destination color), and the Legend all update live. The colorblind toggle swaps to the Okabe–Ito palette; toggling off restores the defaults.

> Assert on **`icon-color`**, not `circle-color`: the node layers are **symbol** layers (see T9.5). A test still reading `circle-color` compares `undefined` to `undefined` and passes while testing nothing.

---

### T9.5 Per-sector node shapes
**Steps:**
1. Appearance tab → each sector row has a colour swatch, a label, and a row of four shape toggles (circle / square / triangle / diamond).
2. Set **DepEd Public** to **diamond**.

**Expected:**
- All four SDF images are registered: `map.hasImage("ugnay-shape-<shape>")` is true for each.
- The `icon-image` layout expression changes and now references the diamond.
- Nodes still render (a missing icon renders **nothing**, silently).
- The Legend's marks change with it — the legend must not claim a shape the map isn't drawing.

**Defaults (shape = sector, fill = public/private within it):** DepEd ○ · Higher-ed △ · TESDA □.

---

### T9.6 Shape images survive a basemap switch (regression)
**Why:** `setStyle` — i.e. **every basemap switch** — throws away all images the app added. react-map-gl re-adds our sources and layers, but **not** our images. Without re-registering them on `style.load`, the symbol layers reference missing icons and **every institution silently disappears** on the first switch. This is invisible to any check that only asserts "the layer still exists".

**Steps:**
1. Switch to **satellite**, then back to **plain**.

**Expected:** `hasImage` is still true for all four shapes after each switch, and `queryRenderedFeatures` on the node layers is still > 0.

---

### T9.7 The icon halo must never flood the quad (white-square regression)
**Why:** MapLibre's SDF shader derives the halo cutoff as `buff = (6 − iconHaloWidth / iconSize) / 8`. If `iconHaloWidth / iconSize` reaches **6**, `buff` goes negative and the shader paints the **entire icon quad** with the halo colour — every node grows a translucent white **square**. It is invisible on the light basemap and glaring on **satellite**, which is exactly how it reached production.

**Steps:**
1. On the Appearance tab, sweep **Node size** across its whole range (2 → 9).
2. At each stop, read `icon-size` (layout) and `icon-halo-width` (paint) off `nodes-basic` and take the non-selected branch of each expression.

**Expected:** `haloWidth / iconSize` is **< 6 at every size** — in fact a constant **2.5** (selected: 3.0), because the halo widths are proportional to node size. A *fixed* pixel halo makes this ratio vary with the slider and is what broke.

**What to check if broken:** `lib/nodeShapes.js` — `haloWidthFor` / `haloWidthSelectedFor` and `R_CIRCLE`. Check on **satellite**; the light basemap hides it.

---

### T9.8 Sector labels are not truncated
**Expected:** "Higher Ed — **Public**" and "Higher Ed — **Private**" render in full in the Appearance tab. The swatch + label + four shape toggles do not fit on one row in a 256px panel, so each sector is a **two-row block**. No element with a sector name has `scrollWidth > clientWidth`.

---

## T10 — Map Controls (new — 2026-07-12)

### T10.1 Re-center button
**Pre-condition:** In the map view; pan/zoom away from the area.

**Steps:**
1. Click the **re-center** (crosshair) button, stacked above the zoom +/- at bottom-right.

**Expected:** The view animates back to frame the current area's institutions (same robust fit as auto-fit). Assert via `window.__ugnayMap.getCenter()` returning near the area centroid.

---

### T10.2 Hide-UI ("clear map") — a DIRECTIONAL slide
**Steps:**
1. Click the **hide** (eye-off) button below the re-center button.

**Expected:** each panel exits toward **its own edge** over 300 ms — header **up**, Layers panel **right**, Legend **left**, detail drawer **right** — rather than being deleted. The map is being *revealed*, and the exit shows where each panel went, so restoring reads as reversible.
- Assert on geometry, not on DOM presence: `header.bottom <= 0`, `panel.x >= innerWidth`, `legend.right <= 0`. **The panels stay mounted now**, so "is it in the DOM" tests nothing.
- Hidden ≠ gone: every hidden panel must also be **`aria-hidden` + `inert`**, or a keyboard user tabs into a bar they cannot see.
- The restore (eye) button persists; zoom and canvas remain.
2. Click it again → all chrome slides back.

**What to check if broken:** `uiHidden` lives in `App` and is passed *into* the header / FilterPanel / Legend as a prop; the drawer simply receives `node={null}`. The control stack lives inside `MapView` so it survives clear-map mode.

> **The map must never resize.** The header is an *overlay* (not a flex sibling) precisely so that hiding it cannot change the map container's size — every resize reallocates and clears MapLibre's WebGL buffer. The canvas is a constant size in both states; assert it.

---

### T10.3 Controls ride the drawer slide
**Steps:**
1. Pin a node (drawer opens) and observe the re-center/hide stack and the zoom +/-.

**Expected:** Both slide left by 18 rem in step with the drawer (via `.ugnay-drawer-open .ugnay-map-controls` / `.maplibregl-ctrl-bottom-right`), so nothing sits under the drawer. In clear-map mode the drawer is hidden, so no shift occurs.

---

### T10.4 Custom controls must not cover the zoom +/- (regression for the 2026-07-12 overlap bug)
**Why:** the re-center/hide stack is positioned by a hand-picked offset above MapLibre's zoom
block. At `bottom-20` it sat **directly on top of the zoom-IN button**, which was rendered
completely unclickable — the icon was hidden and clicks hit the hide-UI button instead.

**Steps:**
1. In the map view, measure the gap between the bottom of `.ugnay-map-controls` and the top of
   `.maplibregl-ctrl-zoom-in`.
2. Click zoom **+**, then zoom **−**.

**Expected:**
- The gap is **≥ 0** (currently 16 px at `bottom-32`), and `document.elementFromPoint()` at the
  centre of the zoom-in button returns the **zoom button**, not `.ugnay-map-controls`.
- Both zoom buttons are clickable and actually change `map.getZoom()`.
- Holds at 1440×900 **and** on a phone viewport, and with the detail drawer open (the −18 rem
  shift preserves the vertical gap).

**What to check if broken:** the `bottom-*` class on `.ugnay-map-controls` in `MapView.jsx`.
MapLibre's zoom block's top edge sits ~112 px above the map's bottom edge, so the stack needs
≥ `bottom-32` (8 rem). Re-check if either stack gains a button.

---

## T11 — Served-Artifact Contract (data tests, `curl`)

Run against the target's origin (examples use production).

### T11.1 Area index loads as JSON, not the SPA
```bash
curl -s -D - -o /dev/null https://ecair-eics-project.web.app/tiles/admin_index.json \
  | grep -iE "^HTTP|content-type|cache-control"
```
**Expected:** `200`, `content-type: application/json`, `cache-control: no-cache`. (If it returns `text/html`, the SPA rewrite is wrongly swallowing data paths.)

### T11.2 A municipality tile loads
```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  https://ecair-eics-project.web.app/tiles/<municity_psgc>.json
```
**Expected:** `200 application/json`.

### T11.3 Boundaries load
```bash
for f in provincial_boundaries municipal_boundaries; do
  curl -s -o /dev/null -w "$f %{http_code} %{content_type}\n" \
    https://ecair-eics-project.web.app/boundaries/$f.geojson
done
```
**Expected:** both `200`, `content-type: application/geo+json`.

### T11.4 SPA fallback for client routes
```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  https://ecair-eics-project.web.app/some/client/route
```
**Expected:** `200 text/html` (rewrite → index.html). Real files still win over this fallback (T11.1–T11.3).

### T11.5 Build bundles serve
**Expected:** The `/assets/*.js` and `/assets/*.css` referenced by `index.html` each return `200`. (Guards against a blank-page deploy.)

---

## T12 — Performance / Worst-Case (SPECS §2.4, §3.5)

### T12.1 Dense municipality renders on mobile
**Pre-condition:** Playwright viewport set to a phone size (e.g. 390×844).

**Steps:**
1. Explore a dense urban municipality (e.g. Quezon City).

**Expected:** The map renders within a reasonable time; pins are visible; pan/zoom stays interactive. No layout overflow — the page body must not scroll horizontally. Panels remain usable (collapsible to clear the map).

### T12.2 Multi-province payload
**Steps:**
1. Explore a full dense region (e.g. Region IV-A: Cavite + Laguna + Batangas).

**Expected:** All tiles load (watch the "Loading…" indicator resolve); the app stays responsive. Note the largest single tile is ~6.9 MB — confirm it doesn't hang the main thread unacceptably.

### T12.3 Reduced motion
**Pre-condition:** Emulate `prefers-reduced-motion: reduce`.

**Expected:** Transitions/animations are near-instant (the CSS media query zeroes durations). No essential info is conveyed by motion alone.

---

## T14 — Mobile (390×844) — SPECS §3.5 "mobile-first"

Mobile is a **different chrome**, not a shrunken desktop: a slim header, one bottom sheet, and a bottom-sheet detail view. Run these in a phone context (`isMobile: true, hasTouch: true`). The breakpoint is `max-width: 639px`, shared by JS (`lib/useIsMobile.js`) and CSS — if they ever disagree you get a bottom sheet laid out for a desktop drawer.

### T14.1 The primary action is reachable without scrolling
**Steps:**
1. Load the app. Note the position of **Explore map →**.
2. Choose a region — the province list appears and the card grows.

**Expected:** The button is on screen **both times** (the card is a flex column with a pinned footer). It must have a ≥40px tap target.

**What to check if broken:** if the whole card is one scroll box again, the button drops below the fold behind a nested scroll — you have to go looking for the primary action.

---

### T14.2 The first hint names the first action
**Expected:** With no region chosen the hint reads **"Pick a region"** (and the footer, "Choose a region to begin."). It must **not** read "Pick at least one province" — there are no provinces to pick until a region is chosen.

---

### T14.3 Header does not overflow; the controls live in the sheet
**Expected:**
- `header.scrollWidth <= header.clientWidth` (nothing clipped off the right edge) and the page body never scrolls horizontally.
- The header contains **only** the wordmark and "← Change area". **Gap analysis and the basemap buttons are NOT in it** — they moved into the sheet.
- Exactly one `.ugnay-sheet` exists.

---

### T14.4 The sheet is COLLAPSED by default
**Expected:** The sheet body has zero height on arrival and only its handle shows (~44px), leaving **~94% of the map visible**. The point of the sheet is an unobstructed map; an auto-open sheet would defeat it.

---

### T14.5 The sheet's contents
**Steps:** Tap the handle.

**Expected:** It rolls open to **≤70vh** (never swallowing the map) with three tabs — **Filters · Appearance · Legend** — and contains the controls that live in the desktop header: **Sectors**, **Basemap**, **Gap analysis**. The **Legend** tab shows the sector key (it is a tab, not a second floating panel — two bottom-anchored panels would fight for the same corner).

---

### T14.6 Zoom +/- and the attribution clear the sheet
**Steps:** With the sheet collapsed, measure the zoom block and the attribution against the sheet's top edge, then click zoom **+**.

**Expected:**
- Both sit **above** the sheet, and `elementFromPoint` at the zoom-in's centre returns the **zoom button** — not the sheet or the control stack.
- The custom control stack still clears the zoom block (the T10.4 gap).
- Zoom **+** actually changes `map.getZoom()`.

**Why the attribution matters:** CARTO / OSM / Esri **require it to be visible**. Leaving it buried under the sheet is a licensing problem, not a cosmetic one.

---

### T14.7 Tapping a node opens a BOTTOM sheet and pans the map UP
**Steps:** Tap a node low on the screen (but above the collapsed sheet — a node *under* the sheet can't be tapped at all; the tap hits the sheet).

**Expected:**
- The detail view slides up as a **full-width** sheet (~390px, `left: 0`) — not an 18rem side drawer, which on a 390px screen would leave a ~100px slit of map.
- The map **pans up** (`center.lat` changes) to bring the tapped node clear of the sheet. On desktop the equivalent pan is sideways.

**What to check if broken:** the `<aside>` is **always mounted** and slides on a transform, so its existence and width prove nothing. Assert on its **`top`** — that's what tells you it actually slid in. (This exact trap made an earlier version of this test pass while selecting nothing.)

---

## T13 — Regression Checklist

Run after every deploy (quick pass):

| Check | Where | Pass condition |
|---|---|---|
| No load flash | Fresh reload | Landing card opaque from frame 1; map never flashes behind |
| Area drill-down terminals | Landing card | 2+ provinces → municipality picker off; 1 province → picker on |
| Explore gating | Landing card | Enabled only with ≥1 province **and** ≥1 sector |
| Pins render | Map view | `querySourceFeatures("nodes").length > 0` |
| Basemap switch | Header | plain/satellite/roads all load; layers survive switch |
| Node click → edges + drawer | Map view | Edges drawn within threshold; drawer opens; no white flash |
| Threshold slider | Filters tab | Edge/halo count changes with the 1–5 km band |
| Gap analysis | Header | Amber/red halos + Legend gap section appear |
| Legend collapse | Legend | Smooth roll (max-height), not a pop |
| **Filter panel collapse** | Layers & Filters | Smooth roll, chevron rotates — not a DOM swap |
| **Node size continuous** | Appearance tab | 0.25 px steps, fractional readout |
| **Re-center button** | Map, bottom-right | Refits view to the area |
| **Hide-UI toggle** | Map, bottom-right | Hides all chrome; persistent restore button; icon flips |
| **Zoom +/- not covered** | Map, bottom-right | Custom stack clears the zoom block; **+** and **−** both click |
| **Node shapes** | Appearance tab | 4 SDF images registered; changing a shape repaints; Legend marks follow |
| **Shapes survive basemap switch** | Header → satellite | Images re-registered on `style.load`; institutions don't vanish |
| **Mobile: sheet collapsed** | 390×844 | Header doesn't clip; sheet is a handle; ~94% of the map visible |
| **Mobile: attribution visible** | 390×844 | Zoom + attribution sit above the sheet (attribution is a licence requirement) |
| **Mobile: detail = bottom sheet** | 390×844 | Full-width, slides up; map pans **up** to clear it |
| **No a11y leaks** | Any | No `aria-hidden` container holds focusable controls (all are `inert`) |
| **No mojibake** | Any area | No rendered string contains `Ã`/`Â` (S1 repairs at ingest; S6 fails the build) |
| **Nodes fade, not pop** | After Explore | Reveal multiplier 0 while loading → 1 after; 450ms fade |
| **Clear map slides** | Eye button | header ↑ / panel → / legend ←; canvas size unchanged |
| **No white squares** | **Satellite** basemap, small node size | `haloWidth / iconSize` < 6 at every size (check on satellite — the light basemap hides it) |
| **Sector labels intact** | Appearance tab | "Higher Ed — Public/Private" shown in full, not truncated |
| **Mobile viewport** | 390×844 | App shell sized in `dvh`, not `vh` — the primary action isn't hidden under the browser chrome |
| Data paths not swallowed | `curl` | `/tiles/*.json` returns JSON, not HTML |
| No horizontal body scroll | Any viewport | Page body never scrolls sideways |

---

## T15 — Network view (frontend_design §5B)

The network view is the one feature here whose bugs **look like successes**. A gesture that dispatches perfectly and does nothing; a graph that renders confidently with no data in it; a panel that paints on top of a canvas that is actually swallowing its clicks. Every one of those sails through a test that checks "did something happen". So every assertion in T15 is on **the view actually changing** — canvas pixels, or the camera the canvas is drawn through — never on an event firing.

| ID | Asserts | Why it exists |
|---|---|---|
| **T15.1** | Frame 0 of the network already has ink (the layout is **seeded from the map's projection**), the graph then *moves*, then settles | A blank first frame means the seed didn't draw; a still graph means the worker never ran |
| **T15.2** | Opens **bland**: verdict counts are real, <2% red ink, <2% sector colour | The "graph of nothing" regression — a frontend ahead of its tiles reported every school as *not on this pathway*, showed `0 · 0 · 0`, and **looked finished** |
| **T15.3** | Lighting *Cut* raises red ink ≥3×, **and the un-lit field survives** (ink stays >25%) | "Highlight" means the rest recede, not vanish. The claim is that cut nodes sit at the **rim** of a structure; a rim with nothing behind it is not a rim |
| **T15.4** | Colouring a sector paints it in the **map's own fill** | The two views must not quietly contradict each other |
| **T15.5** | ctrl+wheel is `preventDefault`ed; pinch-**in** raises `k`, pinch-**out** lowers it; one event cannot move zoom >1.3× | React's `onWheel` is **passive**, so `preventDefault` there is a no-op and the browser page-zooms — which resizes the layout and restarts the simulation. Direction is read from the **camera**, because a pixel count cannot tell zoom-in from zoom-out (zoom far enough and the ink falls again) |
| **T15.6** | The threshold slider actually reaches the graph | The network is a full-bleed `z-10` overlay *later in the DOM* than the `z-10` FilterPanel, so its canvas was silently eating every click in the panel. It **looked** completely normal |
| **T15.7** | "Show on the map" unmounts the graph and flies the camera to the institution | An invisible effect is not a feature |
| **T15.8** | The hover popup is **pre-mounted**, is **never rebuilt** (0 additions across 10 hovers), reaches full opacity, and **never paints in the top-left corner** | MapLibre defers popup DOM writes to its render-task queue, so a popup *created* on hover spends its first frames unpositioned at the container origin. Crossing bare map between two schools rebuilt it every time, strobing a white card in the corner |

## T16 — Network view: strays & the round-trip (frontend_design §5B.5b)

| ID | Asserts | Why it exists |
|---|---|---|
| **T16.1** | In **Quezon City** (worst case nationwide) the graph spans **>25% of the canvas** | ~115 institutions carry a coordinate belonging to a *different province*; `road_unreliable` catches only 20% of them (the point snaps to a road fine — the wrong one). One is enough: QC's full extent is **66×** the box holding 96% of its schools, and the auto-fit chased it, rendering the whole graph into a **46×49 px smudge** |
| **T16.2** | Network → *Show on the map* (flies to z14) → Network **still draws the same graph** | Returning re-seeded every node off the z14 projection. `forceCenter` only recentres the mean — it never shrinks the spread — and the zoom floor clamps at `0.05`, so the graph could not be framed at *any* zoom: blank canvas, unrecoverable |

Both measure **spread**, not ink: a collapsed graph still has pixels, it is just crushed into a corner. Both were **verified to fail on the pre-fix build** (T16.1 reported `0.2%`), not assumed to.

---

**Two traps this section is written to avoid.** A test that is happiest when the feature is absent is not a test: T15.8 asserts a popup *existed* and *became visible*, because without that it passes trivially on a dead feature (it did, once — a prior test had failed and left the run in the wrong view). And the colour thresholds are tuned to the **actual fills** (`#3B82F6`, `#DC2626`), not to "bluish" — the edge grey `(100,116,139)` at low alpha comes back from `getImageData` as `(100,114,141)` after the premultiply round-trip, and a loose `b > 140` test counted every antialiased **edge** as a coloured node.

---

## Copy rules (enforced, `scripts/check_copy.mjs`, CI)

Two rules, both of which the app broke:

1. **No em dashes in rendered text.** They are the most reliable tell that a sentence was written by a machine, and there were **sixteen** of them across the setup screen, both legends, the filter panel and the detail drawer. Use a colon, comma, period or parentheses. (A lone `—` as a "no data" glyph in a table cell is allowed.)
2. **US English.** The app couldn't decide which side of the Atlantic it was on: `Assessment centre` in `lib/graph.js` while `InstitutionCard` said `Assessment center`, and **"Colour by sector" sitting directly above "Colorblind-safe palette" in the same panel.** That is a worse credibility problem than the dashes. House style: center, color, gray, neighbor, enroll.

The lint checks **rendered** text only (JSX text nodes, `title`/`aria-label`/`placeholder`). Comments can say whatever they like. Verified by sabotage: reintroducing one `colour` and one em dash makes it exit non-zero.

Beyond the mechanical rules, the voice is **casual-professional** — contractions, plain nouns, short declaratives, and **no meta-commentary**. Copy that told the reader what was significant ("the clusters and the loose specks are already the finding", "Nothing is highlighted yet — that is the point") has been removed. Say the thing; let the reader decide what it means.

---

## Accessibility rule (enforced, T1.2)

**No `aria-hidden` container may contain focusable controls.** A collapsed panel that is merely *clipped* keeps its checkboxes, sliders and buttons in the tab order and the accessibility tree — so a keyboard or screen-reader user lands inside a panel that, as far as they have been told, does not exist. (This is also a plain ARIA violation.) Every collapsible here — the filter panel body, the Legend body, the GeoPicker's province/municipality sections, and the closed detail drawer — is `inert` when hidden. The test walks the DOM and fails on any `aria-hidden="true"` element that still contains an `input`, `button`, `select`, `textarea`, link, or positive `tabindex`.

SPECS §3.5 lists accessibility as "not committed (open)". This rule is the first thing actually committed to, and it should hold as the UI grows.

---

## Known Issues / Notes

- **No backend / auth / API.** There are no security, RBAC, or server-validation tests — the entire surface is static files + client rendering. (Contrast ARAL, whose TESTS.md is API-heavy.)
- **WebGL is invisible to snapshots.** Assert map state through `window.__ugnayMap` (see Setup), not screenshots.
- **The app has no favicon.** The browser tab shows a blank icon. Locally this surfaces as a `/favicon.ico` 404 in the console; in production the SPA rewrite masks it by returning `index.html` (a `200` that isn't an image). Cosmetic, not yet fixed.
- **Analytics (SPECS §3.5)** is not yet wired; add usage-telemetry tests once the privacy-reviewed tool lands.
- **Deferred to post-demo (won't test yet):** directional progression-edge rendering (A1), area-level continuity % surfaced in the UI (§1.9), TESDA qualification-family matching (currently role-based only).
- **Pending features (add tests when they ship):** the custom domain `ugnay.cair.ph`.
- **Documented but not yet automated:** T8.2 (the Legend reflects live colours) — covered indirectly by T9.4/T9.5, which assert the paint and icon expressions the Legend mirrors.
- **T2.4's frame-count assertion was measuring the renderer, not the app** (fixed 2026-07-14). It required ≥2 evaluated-opacity samples strictly inside the 450 ms fade, and — measured over 10 runs of *known-good* builds, dev and prod — this environment produces exactly **2–3**. The threshold sat on the number, so it had no headroom and failed about one run in three. That is worse than useless: a suite that cries wolf teaches people to ignore it red. The check is now split into a **deterministic** half (the declared transition must be **≥300 ms** — it previously accepted *any* duration > 0) and a **liveness** half (≥1 interpolated frame; a genuine pop yields **zero**). The pair is strictly stronger than what it replaced. If you are tempted to "fix" a flaky assertion by loosening it, check first whether it is measuring your code at all.
