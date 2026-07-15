# Ugnay — Deployment Runbook (as-built)

**What this is.** The realized deployment of Ugnay to Firebase Hosting — the runbook the `firebase_deployment_brief.md` said the "deployment thread" would produce. The **brief is the plan**; **this is what actually happened and how to operate it going forward**, including the pitfalls we hit and how they were resolved.

**Status:** ✅ Live in production since **2026-07-12** at **https://ecair-eics-project.web.app**. Push-to-deploy CI is active. Custom domain `ugnay.cair.ph` not yet attached.

---

## 1. As-built architecture

Ugnay is a **static SPA + static JSON data** — no backend, no database, no server. Everything is served as files from Firebase Hosting's CDN.

| Piece | Source | Served path |
|---|---|---|
| Frontend SPA | `platform/frontend/` → `npm run build` → `dist/` | `/` (`index.html`, `/assets/*`) |
| Tiles (1,666 files, **~74 MB**) | pipeline S6 → `output/tiles/` | `/tiles/*.json` + `/tiles/admin_index.json` |
| Boundaries (2 files, ~9.6 MB) | pipeline S6.3 → `output/boundaries/` | `/boundaries/*.geojson` |

- **GCP / Firebase project:** `ecair-eics-project` (project number `194721030885`), employer billing attached. Firebase Hosting default site `ecair-eics-project` → `ecair-eics-project.web.app`.
- **Config (repo root):** `firebase.json` (public = `platform/frontend/dist`, `site` = `ecair-eics-project`, SPA rewrite last, `no-cache` on `/tiles/**` and `/boundaries/**`) and `.firebaserc` (default project).
- **Staging script:** `platform/prepare_deploy.sh` — builds the frontend and copies `output/tiles` + `output/boundaries` into `dist/`.
- **Artifacts are gitignored** (`output/**`, ~180 MB) and live in GCS (`gs://ecair-ugnay-tiles/`) for CI to pull.

---

## 2. First deployment — the path that worked

Deployed manually from a machine that already had `output/` populated (brief's "option A"), because a vanilla runner can't regenerate the tiles (needs OSRM + source parquets).

1. **Stage:** `bash platform/prepare_deploy.sh` → complete `dist/` (SPA + tiles + boundaries), ~184 MB / 1,672 files.
2. **Config:** committed `firebase.json` + `.firebaserc` (default project `ecair-eics-project`, `site` pinned to the default site).
3. **Auth (non-interactive):** created service account **`ugnay-deployer@ecair-eics-project.iam.gserviceaccount.com`** with role **Firebase Hosting Admin**, downloaded its JSON key, and deployed with:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=/path/to/ugnay-deployer-sa.json \
     firebase deploy --only hosting --project ecair-eics-project
   ```
   Interactive `firebase login` does **not** work in a headless container (no browser) — the SA credential is mandatory there.
4. **Result:** live at `https://ecair-eics-project.web.app`; smoke-tested (SPA, `admin_index.json`, a tile, boundaries, JS/CSS bundles all `200`; `no-cache` on data paths; SPA fallback works).

---

## 3. Pitfalls we hit (and the fixes) — read this before touching Firebase setup

These cost real time; documenting so the next person (or a fresh project) doesn't repeat them.

### 3.1 "Enabling an API" ≠ "adding Firebase to the project"
The authoritative check for *"is this a Firebase project?"* is the **Firebase Management API**:
```
GET https://firebase.googleapis.com/v1beta1/projects/<projectId>   # 404 ⇒ Firebase NOT added
```
The Hosting API's `sites:list` returns a lenient `200 {}` even when Firebase isn't added, which is misleading. Trust the Management API.

### 3.2 `firebase hosting:sites:create` → 404 "Requested entity was not found"
Two independent causes we hit, in order:
- **Missing APIs.** Enable, on the project: **Firebase Hosting API**, **Cloud Resource Manager API** (`cloudresourcemanager.googleapis.com`), **Firebase Management API** (`firebase.googleapis.com`). Allow a few minutes to propagate.
- **Firebase not actually registered** (see 3.1) — the real root cause. No fix until the project is a genuine Firebase project.

### 3.3 The `-537f7` trap — creating a NEW project instead of adding Firebase to the existing one
In the Firebase console, **"Create a project"** with the same name **mints a new project** with a random suffix (e.g. `ecair-eics-project-537f7`). Symptoms:
- Firebase **demands a credit card** — the new project has no billing (the employer billing account is on the *real* `ecair-eics-project`).
- The service-account key (issued for `ecair-eics-project`) doesn't work against it.

**Fix:** use **"Add Firebase to an existing Google Cloud project"** and select `ecair-eics-project` from the picker. **Verify the resulting project ID has NO random suffix.** Once done, `resources.hostingSite` is provisioned and the default site (`ecair-eics-project.web.app`) exists. Delete the stray `-537f7` project.

### 3.4 Service-account key file permissions on the WSL mount
The key lives at `/workspace/innovation-projects/.ssh/ugnay-deployer-sa.json` (outside all git repos — never commit it). On the WSL2 drvfs mount the file is stuck at mode `777` and **cannot be `chmod`'d**; this is a mount limitation, not a leak (it's on the user's own disk, outside repos). For CI the key is a GitHub secret, not a file, so this is moot there.

### 3.5 Deploy is a production action
Getting a live URL is outward-facing. In an automated environment, `firebase deploy` is gated — deploy only with explicit confirmation.

---

## 4. CI — push-to-deploy (brief's "option B", verified)

`.github/workflows/deploy.yml` on the `cair-philippines/project-ugnay` repo, branch `main`.

**Trigger:** push to `main` touching `platform/frontend/**`, `platform/prepare_deploy.sh`, `firebase.json`, `.firebaserc`, or the workflow file — plus manual `workflow_dispatch`. **Docs-only commits do not deploy.**

**Steps:** checkout → setup-node (npm cache) → `google-github-actions/auth` (SA) → setup-gcloud → cache `output/` → (on cache miss) `gcloud storage rsync` tiles+boundaries from `gs://ecair-ugnay-tiles/` → `bash platform/prepare_deploy.sh` → **two gates** → `npx firebase-tools@15 deploy --only hosting`.

**The two gates, and why each exists.** Both are cheap; both are there because the thing they check *shipped broken once*.

| Gate | Runs on | Guards against |
|---|---|---|
| `scripts/check_tile_contract.mjs` | `platform/frontend/dist/tiles` — the **staged artifact**, not `output/`, because `prepare_deploy.sh` has itself had bugs and only checking what actually ships catches that | Tiles the frontend cannot read. The Network view once went out ahead of its tiles: `academic_applies` was `undefined`, so all 3,825 institutions silently read *"not on this pathway"* and the readout showed `0 · 0 · 0`. **Build green, deploy green, and the product quietly asserting no school in the country has a broken pathway.** Checks structure → type/range → **signal** (a pipeline emitting `applies:false` for every node would pass a naive presence check and still be worthless). ~13 s on the full 1,664-tile corpus. |
| `scripts/check_copy.mjs` | `platform/frontend/src` | Em dashes in rendered text (the clearest tell that a sentence was machine-written) and British spelling. The app was shipping **"Colour by sector" directly above "Colorblind-safe palette"** — same panel. |

⚠️ **A DATA change needs BOTH a bucket re-seed AND an `ARTIFACT_VERSION` bump.** Miss the bump and CI restores the *cached* `output/` and silently ships stale tiles — the contract gate is what now catches the specific case where that leaves the frontend without its fields, but it cannot catch stale-but-valid data. See §5.3.

**Pieces (one-time setup, done):**
- **GCS bucket** `gs://ecair-ugnay-tiles/` (subdirs `tiles/`, `boundaries/`), region `asia-southeast1`, seeded with the current artifacts. SA `ugnay-deployer` has **Storage Object Admin** on it.
- **GitHub secret** `FIREBASE_SERVICE_ACCOUNT` = the full SA key JSON.
- **Artifact cache** keyed on repo variable `ARTIFACT_VERSION` (default `v1`) so UI-only pushes skip the ~74 MB pull. (It was 173 MB until SPECS §A6 dropped the unread S3/S4 payloads.)

**Verified:** pushes produced new Hosting releases and served the complete contract.

---

## 5. Operations

### 5.1 Deploy a frontend/UI change (normal path)
Commit to `main` and push. CI rebuilds and deploys automatically (cache-hit build, ~2–4 min). Watch: https://github.com/cair-philippines/project-ugnay/actions

### 5.2 Manual deploy (fallback, from a machine with `output/`)
```bash
bash platform/prepare_deploy.sh
GOOGLE_APPLICATION_CREDENTIALS=/path/to/ugnay-deployer-sa.json \
  firebase deploy --only hosting --project ecair-eics-project
```

### 5.3 Re-seed artifacts after a pipeline rerun (new tiles/boundaries)
```bash
gcloud auth activate-service-account --key-file=/path/to/ugnay-deployer-sa.json --project=ecair-eics-project
gcloud storage rsync -r output/tiles      gs://ecair-ugnay-tiles/tiles
gcloud storage rsync -r output/boundaries gs://ecair-ugnay-tiles/boundaries
```
Then **bump `ARTIFACT_VERSION`** (repo → Settings → Secrets and variables → Actions → Variables) to invalidate the CI cache, and push (or dispatch the workflow) so the new data goes live.

### 5.4 Rollback
```bash
firebase hosting:rollback --project ecair-eics-project     # or use the Hosting console's version list
```

### 5.5 Verify a deploy

**Quick smoke test** (is it serving at all?):
```bash
BASE=https://ecair-eics-project.web.app
curl -s -o /dev/null -w "SPA %{http_code}\n" $BASE/
curl -s -D - -o /dev/null $BASE/tiles/admin_index.json | grep -iE "^HTTP|content-type|cache-control"
```

**Full verification** (do the features actually work?) — run the E2E suite against production:
```bash
cd tests/e2e && npm install && npm run test:prod
```
This drives a real browser through all of `TESTS.md` (32 scenarios) and asserts on live map
state. **Do this after any UI deploy.** The first such run caught a shipped bug that no
`curl` check could see: the new map-control stack was sitting on top of MapLibre's zoom-in
button, making it unclickable.

To confirm a *new* build is actually live (CI takes ~90 s), watch for the bundle hash to
change:
```bash
curl -s $BASE/ | grep -oE 'index-[A-Za-z0-9_-]+\.js'
```
See `TESTS.md` (T11) for the served-artifact contract check on its own.

---

## 6. Branding and SEO (added 2026-07-14)

### Agency logos

Logo files live at `platform/frontend/public/logos/` and are served from `/logos/` on the CDN:

| File | Format | Size | Notes |
|---|---|---|---|
| `deped.svg` | SVG | 22 KB | Department of Education |
| `ecair.png` | PNG | 214 KB | Education Center for AI Research Philippines |

**Brand rule: DepEd always left of ECAIR.** Applied in two places:

- **Landing preamble (`SetupView.jsx`)** — white rounded pill containing both logos, placed above the "Ugnay" title. Sized for desktop (`h-8`) and mobile compact (`h-6`) variants. "This platform is developed by the Education Center for AI Research." appears below the road-distance caveat.
- **Explore-view header (`App.jsx`)** — both logos rendered at `sm:` breakpoint (≥640 px) and above; hidden on phones where the header is already full. A thin divider separates the logo pair from the "Ugnay" wordmark. The "Education Institutions Map" subtitle moved from `sm:` to `lg:` so logos don't crowd it at 640–1023 px. Hovering the ECAIR logo shows the "developed by" text as a tooltip.

### Open Graph / SEO

`platform/frontend/index.html` carries a full meta-tag set:

- **Standard SEO:** `meta name="description"`, `name="keywords"`, `name="author"`.
- **Open Graph:** `og:type`, `og:url`, `og:title`, `og:description`, `og:image` (+ `og:image:width` / `og:image:height` for caching hints), `og:site_name`, `og:locale`.
- **Twitter/X Card:** `twitter:card` (`summary_large_image`), `twitter:title`, `twitter:description`, `twitter:image`.

Discord, Slack, LinkedIn, and Facebook now show a rich preview card when anyone shares the link.

**Canonical URLs** — `og:url` and both image references point to `https://ugnay.cair.ph/`. The image thumbnail will load in Discord once the domain's TLS cert provisions (see §7 below). Title and description show immediately on the `web.app` URL.

### OG social card (`public/og-image.png`)

1200×630 PNG generated programmatically with headless Chromium via `playwright-core`. Content: dark-blue gradient background matching the app's preamble, white pill with DepEd + ECAIR logos, "Ugnay" in 88 px bold, "Education Institutions Map" subtitle, tagline, and `ugnay.cair.ph` domain hint.

**To regenerate** (e.g. after a logo or brand-copy change):
```bash
node scripts/gen_og_image.mjs   # writes platform/frontend/public/og-image.png
```
Requires the `playwright-core` package in `tests/e2e/node_modules/` and the cached Chromium at `~/.cache/ms-playwright/chromium-*/chrome-linux/chrome`.

---

## 7. Still to do

- **Custom domain `ugnay.cair.ph`:** CNAME exists; Firebase TLS cert pending domain verification (TXT record step). Once resolved, `og:url` and `og:image` in `index.html` already point to the right place.
- **Delete the stray `ecair-eics-project-537f7`** project (§3.3).
- **Blaze plan:** employer billing is on the project; currently the free Spark default site suffices. Blaze is only needed for higher egress or a custom-named site.
- **Analytics + privacy review** (SPECS §3.5).

---

## 8. References
- `firebase_deployment_brief.md` — the pre-deploy plan this runbook realizes.
- `../CHANGELOG.md` — log of changes since deployment.
- `TESTS.md` (repo root) — Playwright E2E + served-artifact contract tests.
- `.github/workflows/deploy.yml` — the CI workflow.
- Repo: `git@github.com:cair-philippines/project-ugnay.git`, branch `main`.
