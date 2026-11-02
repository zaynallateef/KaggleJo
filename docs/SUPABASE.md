# Supabase community directory

Supabase holds the last successful public Kaggle snapshot, private profile submissions, and a separate registry of approved Jordan community connections. The GitHub Pages frontend reads that data directly through restricted database functions. Python/GitHub Actions remains responsible for fetching Kaggle; Supabase does not make missing location fields reappear.

## Behavior

- Public search reads `kagglejo_directory()` from Supabase when its browser configuration is present. The existing static JSON mode remains available when Supabase is not configured.
- Visitors can submit a username, city, and matching public Kaggle link for review. Submission does not establish account ownership or approve community membership.
- An operator reviews public evidence of a Jordan connection or the owner's opt-in. Approval records the exact public Kaggle account ID, review basis, timestamp, and a private note.
- Approved people appear on the next website refresh, even before another Kaggle import. Newly approved people have no invented location, tier, points, or rank. Cards and profiles label this as community-approved membership.
- Every full sync rechecks exact public account identities and available statistics. A community approval can permit membership even when the Kaggle search location is empty; its reviewed city is a community connection, not a claim about current residency.
- Revoking an approval removes community-only members from live reads immediately after the browser refreshes. If someone independently qualifies through a public Jordan location, revoking the separate approval does not remove that automatically discovered profile.
- Private Kaggle profiles stay excluded. Progression opt-outs have no statistics or history.
- Failed or older data imports do not replace the previous Supabase snapshot. The configured frontend shows an error rather than silently returning to a static snapshot that could contain revoked members.

## Create or connect the project

Connect the Supabase integration in ChatGPT to enable project inspection and migration deployment without sharing credentials in chat. Choose a project dedicated to KaggleJo. No Supabase project has been created or migrated merely by adding these source files.

Apply [the migration](../supabase/migrations/202611020001_community.sql) once through Supabase migrations or the project's SQL editor. Inspect the project target first; do not run resets on an existing database. The migration only adds KaggleJo-prefixed tables and functions.

The tables enable Row Level Security and revoke direct access for `anon` and `authenticated`. Only the public directory and validated nomination functions are executable by visitors. Publication and direct table writes require the server's secret key or an operator's database access. The directory function exposes no pending submissions, private review notes, or submission counters.

## Configure automation and the site

In the GitHub repository, set these **Actions variables**:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | The HTTPS project origin, such as `https://PROJECT_REF.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | The project's `sb_publishable_...` key; intended for public clients |

Set these **Actions secrets**:

| Secret | Purpose |
| --- | --- |
| `SUPABASE_SECRET_KEY` | The server-only `sb_secret_...` key for loading approvals and publishing snapshots |
| `KAGGLE_API_TOKEN` | Existing official Kaggle credentials for the data-fetch job |

Never put the secret key in `VITE_` variables, source, public JSON, issues, or chat. The frontend build receives only the URL and publishable key. The Pages content security policy adds only the configured Supabase origin. Builds reject partial configuration, non-HTTPS project origins, and non-publishable browser keys.

Run the existing **Refresh data and publish Pages** workflow. With `SUPABASE_URL` configured, its data job loads active approvals, fetches public Kaggle data, imports it locally, and atomically publishes the allowlisted public snapshot to Supabase. The subsequent frontend build enables live Supabase reads and profile submissions.

The workflow currently runs hourly; this integration does not promise real-time Kaggle updates. Approvals and submissions are database operations and do not require a website redeploy. Open pages recheck data every five minutes and on returning to the tab; the snapshot button rechecks immediately.

For local browser development, put only the public values in ignored `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_PUBLIC_KEY
```

Set the server/operator values separately in the environment. Python does not automatically load `.env` files:

```powershell
$env:SUPABASE_URL="https://PROJECT_REF.supabase.co"
# Set SUPABASE_SECRET_KEY using your private environment/secret manager.
.\.venv\Scripts\python.exe -m backend.kaggle_source --with-supabase
```

The operator client also accepts a legacy server `service_role` JWT if an existing project still requires it. The frontend uses a new publishable key only.

## Review missing profiles

List pending nominations privately:

```powershell
.\.venv\Scripts\python.exe -m backend.supabase_admin nominations
```

Review the actual Jordan evidence or owner request before approving. The following is command syntax, not a statement that `loplop05` has already been reviewed or approved:

```powershell
.\.venv\Scripts\python.exe -m backend.supabase_admin approve loplop05 --city "Not specified" --basis public_profile --note "Describe the Jordan evidence actually reviewed."
```

Use `--basis owner_opt_in` only after the owner explicitly requests inclusion. The command verifies the exact public Kaggle account and ID before saving approval. It does not verify control of the Kaggle account. Use `Not specified` when no city is established.

An approved member appears without waiting for the next data import. The next sync fetches statistics; an empty location remains empty. If the account becomes private or cannot be found in Kaggle search, a successful full sync marks its approval unavailable and removes it from public reads. The approval remains private so later syncs can recheck it. Availability and snapshot publication change in one database transaction. A slow sync cannot overwrite a newer review or an approval for a different account ID. Review removal requests and stale approvals promptly.

```powershell
.\.venv\Scripts\python.exe -m backend.supabase_admin revoke loplop05
.\.venv\Scripts\python.exe -m backend.supabase_admin reject unwanted_submission
```

Revocation and rejection are separate: rejection handles a pending nomination; revocation removes an active approval. Duplicate submissions return a generic receipt and do not publish a second record. If a command fails after an ambiguous network response, inspect stored state before retrying.

## Abuse limits and operations

The anonymous submission function validates every field, serializes duplicate checks/counter updates, and allows at most 100 new submissions per UTC day across the site. It stores no raw IP addresses and does not trust browser-supplied forwarding headers. This global cap bounds writes but is not a per-visitor limit or bot protection; someone can exhaust the daily allowance. Add a server-verified CAPTCHA/rate-limiting layer if abuse requires it.

At most 1,000 active reviewed members are supported by this first version. The operator client requests one extra record and fails if that bound is exceeded, instead of silently importing a truncated registry. Full snapshots are fetched as one JSON document, which is suitable for this community's current size; larger directories should use paginated server queries.

Free project availability and quotas are subject to Supabase's current plan. Do not assume guaranteed uptime or backups. This change does not purchase infrastructure or automatically create paid resources.

## Verification

```powershell
npm test
npm run test:db
npm run build:pages
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

`test:db` executes the migration in isolated in-memory PostgreSQL using PGlite. It verifies public/private access, service-only publication, validation, duplicate submissions, daily caps, revocation visibility, and snapshot preservation. These tests are not proof of a deployed Supabase project's gateway, keys, CORS, or hosted settings. Verify those against the selected project before declaring the integration live.

Official references: [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions and grants](https://supabase.com/docs/guides/database/functions).
