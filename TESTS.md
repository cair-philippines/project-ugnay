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

### Four gotchas that will silently break your tests
Each of these produced a *false* result before being fixed — they cost real debugging time:

1. **Map pixels ≠ page pixels.** `map.project()` is relative to the **canvas**, which sits
   *below* the ~45 px header. `page.mouse.click()` takes **viewport** coords. Add the canvas's
   `getBoundingClientRect()` origin or every node click lands high and misses — silently, since
   clicking empty map is a no-op.
2. **`map.jumpTo()` from `evaluate()` does nothing.** react-map-gl drives the map in
   *controlled* mode, so programmatic camera moves are reverted. Pan with a **real gesture**
   (`mouse.down`/`move`/`up`) or via the app's own controls.
3. **Accessible names are the raw DOM text, not what you see.** The basemap buttons' text is
   `plain`/`satellite`/`roads` (CSS `capitalize` renders them "Plain"…), and "LEGEND" is
   CSS-uppercased. `getByRole("button", { name: "Satellite" })` matches **nothing**. Use a
   case-insensitive regex.
4. **The same name can be both a province and a municipality** (e.g. *Quezon City* in NCR).
   Province checkboxes render before municipality ones — disambiguate with `.first()` / `.last()`.

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

---

## T10 — Map Controls (new — 2026-07-12)

### T10.1 Re-center button
**Pre-condition:** In the map view; pan/zoom away from the area.

**Steps:**
1. Click the **re-center** (crosshair) button, stacked above the zoom +/- at bottom-right.

**Expected:** The view animates back to frame the current area's institutions (same robust fit as auto-fit). Assert via `window.__ugnayMap.getCenter()` returning near the area centroid.

---

### T10.2 Hide-UI ("clear map") toggle + persistence
**Steps:**
1. Click the **hide** (eye-off) button below the re-center button.

**Expected:**
- The top header, the Layers & Filters panel, the Legend, and the detail drawer all disappear — only the map + the re-center + the (now eye) button + the zoom +/- remain.
- The button persists so the UI is recoverable; its icon flips to an open **eye**.
2. Click it again → all chrome returns; icon flips back to eye-off.

**What to check if broken:** `uiHidden` lives in `App`; header/FilterPanel/Legend/DetailDrawer render only when `!uiHidden`. The control stack lives inside `MapView` so it stays visible in clear-map mode.

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
| Data paths not swallowed | `curl` | `/tiles/*.json` returns JSON, not HTML |
| No horizontal body scroll | Any viewport | Page body never scrolls sideways |

---

## Known Issues / Notes

- **No backend / auth / API.** There are no security, RBAC, or server-validation tests — the entire surface is static files + client rendering. (Contrast ARAL, whose TESTS.md is API-heavy.)
- **WebGL is invisible to snapshots.** Assert map state through `window.__ugnayMap` (see Setup), not screenshots.
- **Analytics (SPECS §3.5)** is not yet wired; add usage-telemetry tests once the privacy-reviewed tool lands.
- **Deferred to post-demo (won't test yet):** directional progression-edge rendering (A1), area-level continuity % surfaced in the UI (§1.9), TESDA qualification-family matching (currently role-based only).
- **Pending features (add tests when they ship):** per-sector node **shapes** (Appearance tab) — planned as SDF symbol layers; the custom-domain `ugnay.cair.ph`.
