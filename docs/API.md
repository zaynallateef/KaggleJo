# KaggleJo API

Base path: `/api`. Responses are JSON unless explicitly marked as CSV. No login is required for public read endpoints or nominations. There are no public sync, approval, deletion, or other administrative endpoints.

Errors use `{ "error": "Human-readable message" }` with an appropriate HTTP status. Unsupported HTTP methods return 405. Request bodies are limited to 8 KB.

## Read endpoints

| Method/path | Response |
| --- | --- |
| `GET /health` | `{status: "ok", service: "KaggleJo"}` after a database connectivity check. |
| `GET /overview?category=competitions` | Ranked/total member counts, medals, gold medals, city/tier counts, the top three, and snapshot metadata. |
| `GET /leaderboard` | `{items, total, page, page_size, pages, category, meta}`. |
| `GET /members` | All-member directory, including unranked people. `{items, total, page, page_size, pages, community, meta}`. |
| `GET /members/:username` | `{member, achievements, history, meta}`; 404 if absent. |
| `GET /export` | Filtered CSV, including `is_demo`. String values that can initiate spreadsheet formulas are prefixed with an apostrophe. |

Leaderboard query parameters:

| Parameter | Values/default |
| --- | --- |
| `category` | `competitions` (default), `datasets`, `notebooks`, `discussions` |
| `q` | Name/username/organization search, `@username`, or Kaggle profile URL; limited to 80 characters. Case/diacritic insensitive; all words must match, in any order. |
| `city` | Empty or a city returned by the community facets; also accepts the nomination city list. |
| `tier` | Empty or `Expert`, `Master`, `Grandmaster` |
| `page` | Integer >= 1, default 1 |
| `page_size` | Integer 1–100, default 10 |

Export accepts `category`, `q`, `city`, and `tier` and exports all matching records. Category ranks are calculated before city/tier/search filters.

Ranking items include `id`, `username`, `display_name`, `city`, `joined`, `location_source`, `is_demo`, `category`, `tier`, `points`, `global_rank`, `gold`, `silver`, `bronze`, and `local_rank`.

`meta` includes `mode` (`demo` or `live` after import), `updated_at` (ISO UTC snapshot time), and `source`. A fresh production database has no data-source metadata until import. Here `live` identifies real imported records; it does not mean continuously fetched data.

For search snapshots, `available_categories` is the comma-separated list `competitions,datasets,notebooks`, `medals_available` is `"false"`, and `category_tiers_available` is `"false"`. Category `tier`, `gold`, `silver`, and `bronze` are `null` when absent from the source. `overall_tier` is separate and describes the member's highest tier. No discussion statistics are supplied by search.

## Community directory

`GET /members` accepts `q` (name, username, or organization), `city`, `tier` (highest tier: Novice, Contributor, Expert, Master, Grandmaster, Unspecified), `status` (empty, ranked, unranked), `sort` (name, newest, tier), `page` (>=1), and `page_size` (1–100; default 24). All filters are optional.

Both directory and leaderboard searches also accept a Kaggle profile URL or `@username`. Each word must match a field, in any order. Unicode normalization ignores accents and Arabic vowel marks. `%` and `_` are literal characters. The static site uses the same matching rules. Search and browser refresh read the latest imported snapshot; neither triggers a public Kaggle download. Operators can diagnose upstream omissions with `python -m backend.kaggle_source --check-username NAME`.

Results include `has_ranking`, `ranked_categories`, `overall_tier`, `organization`, raw shared `location`, `city`, `progression_opt_out`, and `checked_at`, alongside member identity fields. Unknown cities use `Not specified`. Community facets report total members, members with any available rank, members without an available rank, city counts, and highest-tier counts. Facets describe the full snapshot and remain stable while filtering.

Profiles return available achievements even without ranks. `local_rank` and `global_rank` are `null` when the person is not ranked. Progression opt-outs return empty achievements/history.

## Submit a profile

`POST /nominations`, `Content-Type: application/json`:

```json
{
  "username": "a_real_kaggle_username",
  "city": "Amman",
  "evidence_url": "https://www.kaggle.com/a_real_kaggle_username",
  "confirmed": true
}
```

- Username: 3–50 ASCII letters, numbers, or underscores.
- City must be from the documented list.
- The evidence URL must be HTTPS on `kaggle.com` or `www.kaggle.com`, with the matching username as its only path segment. Query strings and fragments are rejected.
- `confirmed` must be the boolean `true`.
- Submission does not verify identity, fetch the URL, or publish a member.
- 201: saved for operator review, with `{message: "…"}`.
- 400: invalid input; 409: member already present or awaiting review; 429: submission limit reached.
- The per-source-address limit is 10 syntactically valid attempts per rolling one-hour window. SQLite stores only the address hash; arbitrary `X-Forwarded-For` values are ignored.

The `backend.manage` command lists the review queue. An operator checks location evidence, updates the private registry, then runs `backend.sync`.
