# Automatic profile submissions

The hosted site accepts submissions without manual review. A visitor supplies the exact public Kaggle username/link, a community city, and confirmation of a Jordan connection. The `submit-profile` Edge Function checks the exact public account, then atomically creates a membership and marks the nomination approved. The directory refreshes immediately. Available statistics arrive during the next hourly sync.

If Kaggle is unavailable or the exact account is not indexed, the form reports **Automatic check queued**. Saved submissions are retried by the hourly job. Invalid links are rejected, and private profiles or fuzzy matches are never accepted. Save failures preserve form input and ask the visitor to retry.

Automatic acceptance checks that the public account exists. It does **not** verify account ownership, owner consent, residency, or the submitted city/Jordan connection. The `automatic_submission` basis records this accurately; the UI labels community connections separately from Kaggle locations. Existing manual reviews retain their original basis. Duplicate submissions cannot alter an existing identity or city, and cannot restore rejected or revoked profiles.

## Configuration

The existing GitHub Actions variables remain `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Secrets remain `SUPABASE_SECRET_KEY` and `KAGGLE_API_TOKEN`; no additional user key is required.

Before discovery, the workflow runs `python -m backend.auto_approve`. This synchronizes the existing Kaggle token over HTTPS into encrypted Supabase Vault storage and retries queued submissions. The full sync then loads active memberships, rechecks public account identities, fetches statistics, and publishes an atomic snapshot.

The Edge Function uses Supabase's default backend key environment, preferring `SUPABASE_SECRET_KEYS` with the legacy service-role variable as fallback. Only a service-role invoker RPC can access the Kaggle token through private-schema helpers. It is never returned in public data or ordinary errors. Rotating the GitHub Kaggle token updates Vault on the next workflow run. Never put operator secrets in source, browser configuration, or chat.

The Edge Function checks publishable API keys itself; `verify_jwt=false` is necessary because publishable keys are not JWTs. Its CORS allowlist includes the deployed GitHub Pages origin and local preview origins. Anonymous clients cannot directly accept members, read credentials, or write tables. RLS and the existing daily cap of 100 new submissions remain active. The membership limit is 1,000 active community connections.

The legacy nomination RPC remains available for old clients; the hourly job automatically processes its saved nominations too. The Flask-only local mode retains its private review queue; automatic acceptance uses the configured Supabase integration.

## Operator controls

```powershell
.\.venv\Scripts\python.exe -m backend.supabase_admin revoke USERNAME
.\.venv\Scripts\python.exe -m backend.supabase_admin reject USERNAME
```

Server credentials must be configured in the operator environment. Revocation removes a community approval; rejection prevents automatic processing of a nomination. Public Jordan-location discovery is an independent eligibility path.

Tests cover exact account matching, private/unindexed accounts, retries, database failures, identity preservation, revocation, service-only approval, and credential access denial. PGlite uses test-only Vault stubs to verify permissions and rotation; hosted Supabase supplies actual encryption.

Official references: [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets), [Vault](https://supabase.com/docs/guides/database/vault), [API keys](https://supabase.com/docs/guides/getting-started/api-keys).
