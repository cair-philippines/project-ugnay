# Changelog

Notable changes to the Ugnay platform. Newest first. Dates are absolute.

The live app is **https://ecair-eics-project.web.app** (Firebase Hosting). Deployment
details: `documentation/deployment.md`.

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
