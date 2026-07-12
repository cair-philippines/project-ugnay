# Ugnay — Firebase Deployment Brief

**Purpose.** This is the kickoff document for the deployment workstream — the "separate ops document" that `SPECS.md` (§3, §3.5) and `pipeline_implementation_plan.md` (S7) defer to. The goal is a **public URL any user can open** in a browser. This brief captures everything the deployment thread needs to start planning without re-reading the whole repo; it is *not yet* the final runbook — the deployment thread should expand it into one.

**Status of the app itself:** the pipeline and frontend run end-to-end against real nationwide data on the local Vite dev server. Nothing about deployment has been done yet. This is a greenfield deploy.

**Confirmed by the project owner (2026-07-12):**
- **Public URL / custom domain:** `ugnay.cair.ph`.
- **GCP project:** `ecair-eics-project` — the deployment lives here (Firebase is enabled on this existing GCP project; a Firebase project *is* a GCP project).
- **Reuse the `platform_aral` GCP playbook** wherever it applies — see "Reusing platform_aral's practices" under §4.

---

## 0. TL;DR

Ugnay is a **static single-page app + static JSON data** — there is **no live backend**. Deploying means: build the frontend to `dist/`, place the pipeline's data artifacts alongside it under `/tiles/` and `/boundaries/`, and serve the whole thing from Firebase Hosting at a public URL (`ugnay.cair.ph` per the plan). The only genuinely tricky parts are (a) getting the ~180 MB of data artifacts to the deploy — they are **gitignored** and need OSRM to regenerate, so a plain CI runner can't build them — and (b) choosing a Firebase plan/data-hosting split that fits the transfer profile.

---

## 1. What we're deploying

| Piece | What it is | Where it comes from |
|---|---|---|
| **Frontend SPA** | Vite + React 19 + MapLibre GL (pinned `maplibre-gl@4.7.1`) | `platform/frontend/` → `npm run build` → `dist/` |
| **Tiles** | One JSON per municipality (institutions, road-distance accessibility, gap data) + `admin_index.json` | `output/tiles/` (produced by pipeline stage S6) |
| **Boundaries** | Two GeoJSON files (provincial, municipal admin borders) | `output/boundaries/` (S6.3 / `clean_boundaries.py`) |

There is **no API, no database, no server process.** The client fetches static files. Basemap tiles come from **external CDNs** (CARTO positron/voyager, Esri world imagery) — the client calls those hosts directly, so the deploy host must not block outbound requests to them (Firebase Hosting doesn't; just don't add a restrictive CSP without allow-listing them).

The v1 `platform/backend/` (FastAPI) is **dead code from the old build** — it is not used by the current frontend and must not be deployed.

---

## 2. The served-artifact contract (exact paths the app fetches)

The frontend fetches these **root-absolute** paths (see `src/hooks/useTiles.js`, `src/hooks/useBoundaries.js`):

```
GET /tiles/admin_index.json                         ← the area picker loads this first
GET /tiles/<municity_psgc>.json                     ← one per selected municipality (lazy)
GET /boundaries/provincial_boundaries.geojson
GET /boundaries/municipal_boundaries.geojson
```

So in the deployed hosting root, the layout must be:

```
/(hosting root)
├── index.html, assets/…        ← the built SPA
├── tiles/
│   ├── admin_index.json
│   └── <psgc>.json  × ~1,664
└── boundaries/
    ├── provincial_boundaries.geojson
    └── municipal_boundaries.geojson
```

**Sizes (current build):** `output/tiles/` ≈ **173 MB** across **1,666 files** (largest single tile ≈ 6.9 MB, median ≈ 32 KB); `output/boundaries/` ≈ **9.6 MB** (2 files). No PII — institution coordinates + offerings only, so a fully public URL is fine.

**Important transfer nuance:** a user session does **not** download all 173 MB. The app lazy-loads only the tiles for the municipalities the planner drills into (usually a few KB–few MB), plus one boundary file. The 173 MB is the *corpus* size (matters for storage and total egress across many users), not per-session cost.

---

## 3. Build & stage

`platform/prepare_deploy.sh` already builds the frontend and copies tiles into `dist/tiles/`. **It has one gap: it does not copy boundaries.** The deployment thread must add a step to also copy `output/boundaries/` → `dist/boundaries/`, or the admin borders will 404 in production. (This script predates the boundaries feature.)

Corrected staging, conceptually:
```
cd platform/frontend && npm ci && npm run build      # → dist/
cp -r ../../output/tiles      dist/tiles              # already in the script
cp -r ../../output/boundaries dist/boundaries         # MISSING — add this
# dist/ is now the complete hosting root
```

**⚠️ Where do the artifacts come from in CI?** This is the key decision. `output/**` is **gitignored** (correctly — 180 MB shouldn't live in git), so a fresh `git clone` on a GitHub Actions runner will **not** have the tiles/boundaries, and it **cannot regenerate them** — S2b needs a running **OSRM** server and the four source coordinate parquets, neither of which exist on a vanilla runner. Options to resolve:
- **(A) Deploy from a machine that already has `output/`** (e.g. the workstation that ran the pipeline) — simplest for the demo; `firebase deploy` from there.
- **(B) Sync artifacts from GCS in CI** — a CI job authenticates to GCS, pulls `tiles/` + `boundaries/`, then deploys. Cleanest for repeatable CI. **This is exactly how `platform_aral` solved the same problem:** its gitignored analytics parquets live in `gs://ecair-aral-platform-snapshots/`, kept current with `gcloud storage rsync -r <local> gs://…`, and the GitHub Actions workflow downloads them **before** the build so they're baked into the deploy. Mirror it: create a bucket in `ecair-eics-project` (e.g. `gs://ecair-ugnay-tiles/`), `rsync` `output/tiles` + `output/boundaries` into it after each pipeline run, and have CI pull from it before `firebase deploy`.
- **(C) Store artifacts in a deploy branch / release asset** and have CI fetch them.
Recommend **(A)** for the first public deploy, **(B)** as the durable CI path (the proven `platform_aral` pattern).

---

## 4. Firebase shape (starting point — verify in the thread)

**Firebase Hosting** on the `ecair-eics-project` GCP project, custom domain **`ugnay.cair.ph`**, deployed via **GitHub Actions**.

**Why Firebase Hosting and not Cloud Run (which is what `platform_aral` uses):** ARAL runs on Cloud Run because it has a live FastAPI backend + Postgres. Ugnay has **neither** — it is pure static files — so Firebase Hosting is the better fit: purpose-built for static + global CDN, no container/Terraform machinery, cheaper, simpler. Both sit inside the same GCP project, so this is consistent, not a departure. (If org policy ever mandates one substrate for everything, Cloud Run *can* serve static via a container — but don't take on that complexity without a reason.) A minimal `firebase.json` to start from:

```jsonc
{
  "hosting": {
    "public": "platform/frontend/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      // SPA fallback — but it must NOT swallow data paths. Static files that exist
      // are served before rewrites, so /tiles/*.json and /boundaries/*.geojson win
      // as long as they're present. Keep the fallback last.
      { "source": "**", "destination": "/index.html" }
    ],
    "headers": [
      // Data is regenerated by pipeline reruns; don't let a CDN pin stale geometry.
      // (This repo already learned that lesson in dev — boundaries were served with
      //  no-store. In prod, prefer versioning or short/no cache on data paths.)
      { "source": "/boundaries/**", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] },
      { "source": "/tiles/**",      "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
    ]
  }
}
```
`no-cache` (revalidate every load) is the safe default; if you'd rather cache aggressively for speed, switch to a **versioned data path** (e.g. deploy under `/tiles/<build>/…` and bake the version into the fetch base) so a rerun never serves stale data. Firebase purges changed files on each deploy, so `no-cache` + redeploy is already correct for most cases.

### Reusing platform_aral's practices

ARAL is the sister project with a working `cair-philippines` → GCP deploy. What transfers to Ugnay:

- **✅ Gitignored artifacts in GCS, pulled in CI before deploy** — the single most useful pattern to copy (see §3, option B). ARAL's parquets live in `gs://ecair-aral-platform-snapshots/`, `rsync`'d up and downloaded in the workflow before build. Do the same for `output/tiles` + `output/boundaries`.
- **✅ GitHub Actions triggered by a branch push**, authenticating to GCP with a service-account credential stored as a repo secret. Same `cair-philippines` org, same SSH key location (`/workspace/innovation-projects/.ssh/id_ed25519`) as documented for this repo.
- **✅ Env-configurable data paths** — ARAL resolves data dirs from env vars first (`config.py::_resolve()`). The analogue here: if tiles/boundaries move to a separate bucket/CDN (§5), make the frontend's `TILES_BASE` / boundary `FILES` read from a build-time env var (`import.meta.env.VITE_TILES_BASE`) instead of the hardcoded `/tiles`, `/boundaries`.
- **⚠️ Does NOT apply (ARAL-specific because it uses Cloud Run + Terraform + Docker):** the Docker image build/push, Terraform, Postgres/Alembic — and therefore ARAL's **mutable-tag deploy bug** (Terraform saw no diff on a fixed `:dev` image tag and silently skipped every redeploy). Firebase Hosting has no image tags, so this class of "deploy succeeded but nothing changed" bug doesn't exist here. *Only* relevant if the thread chooses Cloud Run instead of Hosting — in which case, re-read ARAL's fix (pin the `sha256` digest per deploy).

---

## 5. Plan / cost

- **Spark (free) plan** caps egress at ~360 MB/day. Because sessions lazy-load only a few tiles, light pilot use may fit — but a few planners exploring dense regions can exceed it, and the 173 MB corpus exceeds nothing storage-wise (Spark gives 10 GB). **Blaze (pay-as-you-go)** is the safer choice for a public URL with unknown traffic; cost at this scale is negligible.
- **Alternative for the tile corpus:** serve `tiles/` + `boundaries/` from a **Cloud Storage bucket behind a CDN** and keep only the SPA on Hosting. Decouples data egress from Hosting quotas and is a natural fit since artifacts already live in GCS. Trade-off: the fetch base changes from `/tiles` to an absolute bucket/CDN URL, so the frontend's `TILES_BASE` / `FILES` constants (currently hardcoded to `/tiles` and `/boundaries`) would need to read from an env-configurable base. Decide this before wiring CI.

---

## 6. Constraints & gotchas (carried from SPECS, the plan, and hard-won lessons)

- **Audience vs access:** SPECS frames users as **non-technical planners** at DepEd/CHED/TESDA, *not* the general public. That's a *design* stance, not an access-control requirement — a public URL is acceptable (no PII). If access ever needs restricting, that's a separate decision, not a blocker for launch.
- **Analytics required:** SPECS §3.5 commits to **basic, privacy-reviewed anonymous usage analytics** (areas viewed, features used). Pick a lightweight, privacy-respecting tool and get the privacy review done as part of deployment.
- **Mobile-first performance bar:** SPECS §3.5 — must be responsive on a target phone, including the **worst-case dense municipality** (that 6.9 MB tile). Worth a real device check post-deploy.
- **Frontend fetches use relative root paths, not `new URL()`** — good, keep it that way (a prior sister-project bug: `new URL()` in the browser threw and silently blanked the map).
- **Build with `npm run build`, serve the static output** — never ship a dev server.
- **`maplibre-gl` is pinned at 4.7.1** on purpose (react-map-gl 7.x peer-compat). Don't let a deploy step bump it.
- **Boundaries must bust cache on regen** — the one caching rule that already bit us in dev.

---

## 7. Open decisions for the deployment thread to resolve

1. ~~**Firebase project**~~ — **RESOLVED: `ecair-eics-project`** (enable Firebase Hosting on it; confirm billing account is attached).
2. ~~**Domain**~~ — **RESOLVED: `ugnay.cair.ph`.** Still to do: control the `cair.ph` DNS zone to add Firebase's verification + A/AAAA (or CNAME) records; TLS is auto-provisioned by Firebase.
3. **Plan** — Spark vs Blaze (recommend Blaze for a public URL).
4. **Data hosting split** — tiles/boundaries on Hosting (simple) vs Cloud Storage + CDN (decoupled egress, needs an env-configurable fetch base).
5. **Artifact source for deploys** — local machine (A), GCS sync in CI (B), or deploy branch (C). See §3.
6. **Cache strategy** — `no-cache` + redeploy purge vs versioned data paths.
7. **Analytics tool** + privacy review.
8. **CI secrets** — Firebase service account / token in GitHub Actions (mirror `platform_aral`).
9. **Access** — fully public vs any gating (default: public).

---

## 8. Suggested first steps

1. Enable Firebase Hosting on **`ecair-eics-project`**, confirm billing, and begin the **`ugnay.cair.ph`** custom-domain flow (add the DNS records Firebase asks for).
2. On a machine that has `output/` populated, fix the boundaries copy in `prepare_deploy.sh`, run it, and do a **manual `firebase deploy --only hosting`** to get *a* public URL working (option A). This validates the whole static contract before automating.
3. Smoke-test the public URL: area picker loads, a dense municipality renders on mobile, borders draw, gap analysis + accessibility edges work, no console errors.
4. Only then automate: GitHub Actions workflow (build → fetch artifacts from GCS → deploy), wire secrets, decide cache/versioning.

---

## 9. References

- **`SPECS.md`** — product/data decisions; §3 & §3.5 (delivery, non-functional bar, telemetry), Appendix A (one-page summary).
- **`pipeline_implementation_plan.md`** — S6 (tile schema — the served contract), S7 (publish), §6 (frontend JSON contract).
- **`frontend_design.md`** — what the app does and how it reads the tiles.
- **Repo:** `git@github.com:cair-philippines/project-ugnay.git`, branch `main`. Frontend: `platform/frontend/`. Data: `output/tiles/`, `output/boundaries/` (gitignored). Staging: `platform/prepare_deploy.sh`.
- **Pattern reference:** `platform_aral` (`git@github.com:cair-philippines/project-aral-platform.git`) — sister project with a working GitHub Actions → GCP deploy. Reuse: the **GCS-artifacts-pulled-in-CI** pattern (its parquets live in `gs://ecair-aral-platform-snapshots/`, `gcloud storage rsync`'d and downloaded pre-build), branch-triggered Actions, service-account secret auth, env-configurable data paths. Note it uses Cloud Run + Terraform + Docker (because it has a backend); Ugnay does not, so those pieces don't carry over. See §4 "Reusing platform_aral's practices".
- **Deploy target (confirmed):** GCP project `ecair-eics-project`, Firebase Hosting, custom domain `ugnay.cair.ph`.
