# Changelog

Notable changes to the Ugnay platform. Newest first. Dates are absolute.

The live app is **https://ecair-eics-project.web.app** (Firebase Hosting). Deployment
details: `documentation/deployment.md`.

---

## 2026-07-12

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

### Fixed (post-deploy, found by the E2E run)
- **Zoom-in button was unclickable.** The new re-center / hide-UI stack was positioned at
  `bottom-20`, which placed it *directly on top of* MapLibre's zoom-**IN** button: the icon
  was hidden and every click on it hit the hide-UI button instead. Moved the stack to
  `bottom-32` (8 rem), clearing MapLibre's zoom block by 16 px. Verified at 1440×900, on a
  phone viewport, and with the detail drawer open. Covered by new regression test **T10.4**.

### Added (testing)
- **`tests/e2e/`** — a Playwright runner implementing `TESTS.md` (32 browser scenarios +
  the served-artifact contract). `cd tests/e2e && npm install && npm run test:prod`.
- `TESTS.md` gains T10.4 and a "gotchas" section (canvas-vs-viewport click coords;
  `jumpTo()` is inert under react-map-gl's controlled mode; accessible names are the raw
  DOM text, not the CSS-transformed text; province/municipality name collisions).

### Pending
- **Per-sector node shapes** (circle / square / triangle / diamond) via SDF symbol
  layers — next change.
- Custom domain `ugnay.cair.ph`; delete the stray `ecair-eics-project-537f7` project;
  analytics + privacy review (SPECS §3.5).
