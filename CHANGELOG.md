# Changelog

Notable changes to the Ugnay platform. Newest first. Dates are absolute.

The live app is **https://ecair-eics-project.web.app** (Firebase Hosting). Deployment
details: `documentation/deployment.md`.

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
- **Per-sector node shapes** (circle / square / triangle / diamond) via SDF symbol
  layers — next change.
- Custom domain `ugnay.cair.ph`; delete the stray `ecair-eics-project-537f7` project;
  analytics + privacy review (SPECS §3.5).
