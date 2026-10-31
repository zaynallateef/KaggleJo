# KaggleJo

A community directory and leaderboard for Kagglers who publicly share a location in Jordan. Built with **Python/Flask + SQLite** and **React + TypeScript + Vite + Tailwind CSS**. Charcoal, light blue, and gold, with a self-hosted Manrope font.

## What works

- A directory of all imported members, including unranked contributors and novices, with search, city, highest-tier, ranking-status, and sort filters.
- Automatic discovery through Kaggle’s official user-search SDK, using opted-in public locations in Jordan.
- Separate category leaderboards. Search supplies competition, dataset, and notebook points/ranks; optional Meta Kaggle imports also support discussion statistics, category tiers, and medals.
- Name/username search, city and tier filters, shareable filter URLs, and pagination.
- Top-three profiles, category-specific community statistics, and city browsing.
- Profile details, category-by-category comparison of up to three people, and CSV export.
- Public profile submissions saved to a private operator review queue.
- Streaming import of official Meta Kaggle CSVs, optional downloads through Kaggle’s CLI, atomic snapshot replacement, and stored ranking history.
- An explicitly labeled sample dataset so you can explore the interface immediately.

**A fresh demo database uses fictional people; production starts empty.** The local workspace has now been populated with a real search snapshot. Real imports remove all sample people and sample history. The directory is the default page; use `#leaderboard` for rankings.

## Run locally

Use Node.js 24 LTS and Python 3.13 or newer. The project was checked on Windows with Node 24 and Python 3.15. Run these commands from the repository root.

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.lock
```

Terminal 1 — Python API:

```powershell
.\.venv\Scripts\python.exe -m backend.app
```

Terminal 2 — React frontend:

```powershell
npm run dev
```

Open **http://127.0.0.1:5173**. Vite forwards `/api` to Python on port 8000. On macOS/Linux, use `.venv/bin/python` instead of `.\.venv\Scripts\python.exe`.

After installation, you can start both services in one terminal instead:

```powershell
npm run dev:all
```

Press Ctrl+C to stop both services. Use the default backend port 8000 with this launcher.

To serve the built frontend and API together:

```powershell
npm run build
.\.venv\Scripts\python.exe -m backend.serve
```

Open **http://127.0.0.1:8000**. Waitress binds to all interfaces by default for hosting; use `$env:HOST="127.0.0.1"` to restrict it to your machine.

## Real Kaggle data

### Recommended: discover public profiles in Jordan

Install the operator dependencies and authenticate with the [official Kaggle CLI](https://github.com/Kaggle/kaggle-cli/blob/main/docs/README.md#authentication):

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-data.txt
.\.venv\Scripts\kaggle.exe auth login
.\.venv\Scripts\python.exe -m backend.kaggle_source
```

The sync uses `SearchApiClient.list_entities` with a public-user filter and `user_locations=["Jordan"]`. It follows all result pages, then checks that each profile's returned location explicitly ends in Jordan. There is no ranking or minimum-tier requirement for membership. The directory includes unranked people, and preserves country-only locations as `Not specified` instead of guessing a city.

The sync validates the full result before changing the database. A failed, truncated, repeated-page, or empty result leaves the existing profiles untouched. Successful syncs replace the previous membership snapshot and retain a database backup in ignored `data/backups/`. Members no longer sharing Jordan are removed on the next successful sync. Progression opt-outs have no ranking statistics or stored rank history.

This is a directory of people **publicly listing a location in Jordan**, not a claim about their nationality or verified residency. It cannot find people who do not share that location publicly. Search indexes can lag behind profile edits.

Search supplies competition, dataset, and notebook points/ranks and the member's **highest overall tier**. It does not supply medal counts, category-specific tiers, or discussion statistics. Unavailable fields are `null` or explicitly labeled; they are never inferred from the overall tier. The refresh button reloads the database; repeat the sync command above to fetch a new snapshot. Credentials remain in the CLI's local credential store, outside frontend code.

To fetch without changing the database, or import the last downloaded cache:

```powershell
.\.venv\Scripts\python.exe -m backend.kaggle_source --fetch-only
.\.venv\Scripts\python.exe -m backend.kaggle_source --from-cache
```

### Optional: Meta Kaggle CSV import

The existing CSV importer is available for an explicitly reviewed member registry. It imports category tiers and medals from [Meta Kaggle](https://www.kaggle.com/datasets/kaggle/meta-kaggle), but replaces current membership with that registry. Do not run it over the public-search directory unless that replacement is intended. The full upstream files are large (the inspected October 2026 `UserAchievements.csv` alone is over 10 GB uncompressed).

The search sync does not need these CSVs or a manual username list.

#### 1. Review profiles for CSV import

Inspect the stored submissions locally:

```powershell
.\.venv\Scripts\python.exe -m backend.manage nominations
```

Copy `data/members.example.json` to `data/members.json`. Replace its example with real public Kaggle profiles you have reviewed. Each member needs a username, city, matching Kaggle profile URL, and review date. The example username is a placeholder, not a verified account.

Submissions are nominations, not ownership verification. Manually check the public Jordan connection before adding someone to the registry. Removal means removing their entry from the registry before the next full import. A successful import replaces current membership, rather than accumulating removed profiles.

#### 2. Fetch and import CSVs

Install and authenticate the [official Kaggle CLI](https://github.com/Kaggle/kaggle-cli). Keep its credentials on the server/operator machine. KaggleJo does not ask visitors for passwords or API keys.

```powershell
.\.venv\Scripts\python.exe -m pip install kaggle
# Authenticate following the official CLI instructions, then:
.\.venv\Scripts\python.exe -m backend.sync --download --as-of "2026-10-31T00:00:00Z"
```

**Replace the date with the actual dataset snapshot timestamp.** It is not the time you click refresh. The command downloads only `Users.csv` and `UserAchievements.csv`, which can still be large. Ensure the Kaggle CLI executable is on `PATH`; in PowerShell you can prepend the environment’s scripts directory:

```powershell
$env:PATH = "$PWD\.venv\Scripts;$env:PATH"
```

You can also download those CSVs yourself and import without network access:

```powershell
.\.venv\Scripts\python.exe -m backend.sync --directory data/meta-kaggle --registry data/members.json --as-of "2026-10-31T00:00:00Z"
```

The importer accepts plain CSVs or the per-file ZIPs produced by Kaggle’s CLI. It streams the files instead of loading the full dataset into memory. Invalid schemas, missing registry members, invalid scores, and older snapshots fail without replacing existing ranking data. The source-date metadata and real/sample flag travel with every ranking response and export.

The web refresh button **reloads the latest stored snapshot**. It does not start an expensive Kaggle download. Run the sync command from an operator job when a newer dataset snapshot is available. Scheduling depends on your hosting platform; pass the actual source timestamp for each import.

### Ranking rules

- Rank by Kaggle points descending **within one category**; categories are never added together.
- Tied point totals share a rank, with gaps (`1, 1, 3`). Username orders tied display rows deterministically.
- Filters retain each member’s rank among the full reviewed Jordan community.
- A supplied global rank is required for the leaderboard. In Meta Kaggle mode, Expert tier or above is also required. Members without rankings remain in the community directory.
- Snapshot history is stored after imports. The UI currently reports recorded snapshot counts, not a movement chart or invented trends.
- Membership is incomplete by design. This is a community index, not an official national ranking or a census of Jordanians.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `KAGGLEJO_MODE` | `demo` | Set `production` before the first startup for an empty, real-data installation. Existing databases are never automatically reseeded. |
| `KAGGLEJO_DB` | `data/kagglejo.db` | SQLite file. Use durable storage in production; also pass `--db` to operator commands if needed. |
| `PORT` | `8000` | Backend port. |
| `HOST` | `0.0.0.0` | Waitress bind address. The development server binds only to `127.0.0.1`. |
| `VITE_API_URL` | empty | Optional API origin for a separately hosted frontend; baked in during the Vite build. |
| `KAGGLEJO_ALLOWED_ORIGIN` | unset | Exact allowed frontend origin for separate hosting. No wildcard CORS. |

`.env.example` documents variable names. Set backend values in the shell or hosting environment; Python does not automatically load `.env`. Vite reads its own `.env` at build/dev time. Never put Kaggle credentials in a variable beginning with `VITE_`.

Example PowerShell configuration:

```powershell
$env:KAGGLEJO_MODE="production"
$env:KAGGLEJO_DB="data/production.db"
.\.venv\Scripts\python.exe -m backend.serve
```

## Verification

```powershell
npm run build
npm test
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

Python tests cover category separation, ties, filters, CSV injection handling, nomination validation and persistence, rate limits, empty production startup, and snapshot import/rollback behavior. Frontend tests use mocked API responses in a DOM test environment; they are not a live Kaggle integration test or real-browser accessibility audit.

The public-user search was run against Kaggle and imported 1,247 profiles explicitly sharing Jordan, including 1,227 without a rank in the available categories (31 October 2026). The bulk Meta Kaggle download was not run. Browser visual/accessibility checks and Docker deployment remain unverified in this environment.

## Deployment later

**Free option:** use [the GitHub Pages deployment guide](docs/FREE_DEPLOYMENT.md). The included workflow fetches public Kaggle data hourly with Python, then publishes a static React site. It requires a public GitHub repository and a Kaggle token stored as a repository secret. Search, profiles, comparisons, and CSV exports work without a hosted Python API. Open pages check for updates every five minutes. Scheduled jobs can be delayed or disabled after repository inactivity; see the guide for exact limits. The free version uses automatic inclusion instructions instead of a public submission queue and keeps only current snapshot history.

For a host that supports an always-on Python service and persistent storage, Flask can serve `dist/` and the JSON API together. Docker support is included:

```bash
docker build -t kagglejo .
docker volume create kagglejo-data
docker run --rm -p 8000:8000 -v kagglejo-data:/app/data kagglejo
```

The image starts in production mode with no sample people and runs as a non-root user. Configure TLS through your hosting provider or reverse proxy. Back up the database, retain the reviewed registry securely, and run imports against the same persistent database. The SQLite volume must be writable by the container’s `appuser`.

For a non-Docker host, build with `npm ci && npm run build`, install `backend/requirements.lock`, set production environment variables, and start `python -m backend.serve`. A single instance is the intended initial deployment model. For multiple replicas, migrate persistence and rate limiting to a shared database first. Behind a proxy, submission limits currently share the proxy’s source IP because the app deliberately does not trust arbitrary forwarded headers; configure trusted proxy handling for that exact deployment before scaling public submissions.

The GitHub Pages configuration uses a public repository and standard runners. The deployment workflow records the current publication status; no paid hosting is required for that configuration.

## Layout

```text
src/                  React pages, components, API client, styles
backend/app.py        JSON API and frontend serving
backend/ranking.py    Ranking calculations and category statistics
backend/directory.py  All-member search, facets, sorting, and pagination
backend/kaggle_source.py Official public-location discovery and snapshot sync
backend/db.py         SQLite schema and connections
backend/sync.py       Reviewed-registry + Meta Kaggle importer
backend/manage.py     Local nomination review command
backend/tests/        Isolated API and import tests
data/                 Local database and operator-managed registry
docs/API.md           API contract
Dockerfile            Combined frontend/backend image
```

KaggleJo is independent and is not affiliated with or endorsed by Kaggle or Google.
