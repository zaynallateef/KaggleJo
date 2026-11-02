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

## Search and refresh

Search accepts names, `@username`, and Kaggle profile URLs, with case and diacritic normalization. Refresh immediately revalidates the published snapshot and displays its time in Amman. A browser refresh does not start a Kaggle download.

### Missing profiles

Website search accepts names, `@username`, and Kaggle profile links. Multiple words can appear in any order across name, username, and organization. Searches ignore case, accent marks, and Arabic vowel marks. City, tier, and ranking filters still apply; use the community directory to include unranked people.

If the profile is missing from the imported data, diagnose the exact username without changing the database:

```powershell
.\.venv\Scripts\python.exe -m backend.kaggle_source --check-username loplop05
```

The diagnostic distinguishes `included`, `not_indexed`, `location_not_shared`, `outside_jordan`, and `private`. `location_not_shared` means the search API returned no location; it does not prove the user intentionally hid it. Being visible on Kaggle's website does not guarantee that its search API returns a public location.

Add missing usernames to the JSON list in `data/discovery-usernames.json`. Every normal sync, including the Pages workflow, checks those usernames without a country filter if country discovery missed them. It imports only the exact account with a returned public Jordan location, never similar usernames or an assumed city. Entries are revalidated every sync, so moving or hiding a location removes the member. For a one-time check during a full sync, use `--username NAME` (repeatable). Keep the JSON entry for checks on future scheduled runs; the limit is 100 usernames.

On 2 November 2026 the live diagnostic found `loplop05` with `location_not_shared`. It is registered for future rechecks but was not added as a verified Jordan profile. The profile owner should check their Kaggle location and sharing settings, then allow time for search indexing. If the website and search continue to disagree, an operator must investigate rather than infer location.

See [API documentation](docs/API.md) and the [Pages deployment guide](docs/FREE_DEPLOYMENT.md) for configuration and refresh behavior.
