# Free deployment with GitHub Pages

KaggleJo can run as a free public directory: React is hosted on GitHub Pages, while a Python GitHub Actions job fetches Kaggle profiles and publishes a new data snapshot hourly. No continuously running Python server or paid database is required for this version.

GitHub Pages on GitHub Free requires a **public repository**. Source code and the public profile snapshot will be public. Credentials, local databases, nominations, and backups are excluded. See [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

## 1. Create the source repository

Create an empty **public** GitHub repository named `KaggleJo`. Leave its README and other starter files unchecked to avoid a conflicting initial commit. From a PowerShell terminal in this project:

```powershell
cd D:\KaggleJo
git init -b main
git add .
git commit -m "Prepare KaggleJo for free hosting"
git remote add origin https://github.com/YOUR_USERNAME/KaggleJo.git
git push -u origin main
```

Replace `YOUR_USERNAME`. Before pushing, inspect `git status` and the staged files. `.gitignore` excludes `.env` files, `.kaggle`, the local database, data caches, private nominations in SQLite, and generated snapshots. Do not add those files with `git add -f`.

These commands are for first-time setup. Skip repository creation and remote initialization if the project is already connected to GitHub.

## 2. Add the Kaggle secret

Open [Kaggle API settings](https://www.kaggle.com/settings/api) and generate an API token for automation. The browser login used on your computer does not automatically authenticate a GitHub runner. Kaggle documents the `KAGGLE_API_TOKEN` environment variable in its [CLI authentication guide](https://github.com/Kaggle/kaggle-cli/blob/main/docs/README.md#authentication).

In your GitHub repository:

1. Open **Settings → Secrets and variables → Actions**.
2. Select **New repository secret**.
3. Name it **`KAGGLE_API_TOKEN`** and paste the token into the secret value.

Do not put it in source code, workflow YAML values, `.env` files committed to Git, a `VITE_` variable, issues, or chat. The workflow exposes it only to the Python data-fetch step. The frontend build runs in a separate job without the Kaggle secret. See [GitHub's secrets guide](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## 3. Enable Pages and run the workflow

1. Open **Settings → Pages → Build and deployment**.
2. Choose **GitHub Actions** as the source.
3. Open **Actions → Refresh data and publish Pages**.
4. Select **Run workflow** on `main`.
5. Wait for **data**, **build**, and **deploy** to succeed.
6. Open the URL shown by the `github-pages` deployment environment. It will usually be `https://YOUR_USERNAME.github.io/KaggleJo/`.
7. In **Settings → Pages**, enable **Enforce HTTPS** when available.

The first push may run before the secret and Pages are configured and fail. After configuration, use **Run workflow** to retry. Nothing is published until the complete workflow succeeds.

The custom workflow follows [GitHub's Pages workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). A custom domain is optional and may have a separate registration cost; the provided `github.io` address is enough.

## Refresh behavior

- The workflow runs on pushes to `main`, manual runs, and at minute **17 of every hour**, in UTC.
- Python fetches every page of public-user search results for the English and Arabic country names. It also checks exact usernames from `data/discovery-usernames.json` without the country filter. It checks every returned public location, includes people with and without rankings, and respects progression opt-outs.
- A validated snapshot is exported to JSON and deployed with the built site. Invalid, incomplete, or empty fetches fail before deployment; the last successful site remains live.
- Open browser pages check for updated data every **five minutes**, and when the tab becomes visible again. Normal browser/CDN caching can add delay.
- Clicking the snapshot refresh button immediately revalidates published JSON, bypassing the browser's in-memory snapshot cache. It shows the snapshot time in Amman; it does not launch a new Actions job or query Kaggle directly.
- A new account appears only after its profile publicly lists a location in Jordan and Kaggle search indexes it. There is no account-creation webhook in this integration.
- This free workflow is stateless. It republishes the current snapshot and does not accumulate long-term ranking history or operate a public nomination queue. **Get listed** explains automatic inclusion instead.

For a missing account, run `python -m backend.kaggle_source --check-username NAME` with operator dependencies and Kaggle authentication. If country discovery missed a public Jordan profile, add its username to `data/discovery-usernames.json` and publish the source change; scheduled jobs will recheck it. An empty location in the search API cannot be corrected by browser refresh or a username override. Check the owner's location sharing and indexing instead. The local source changes must be pushed before GitHub's workflow can use them.

GitHub schedules can be delayed or dropped during high load. Public repository schedules are automatically disabled after **60 days without repository activity**. Check the Actions page periodically and re-enable the workflow if needed. There is no guarantee of instant updates or unattended operation forever on this free setup. These are [documented schedule limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

GitHub Pages and standard public-repository Actions usage are subject to [Pages usage limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) and [Actions billing rules](https://docs.github.com/en/billing/concepts/product-billing/github-actions). This configuration uses standard `ubuntu-latest` runners. Do not choose paid larger runners or enable paid spending for this project. The directory is a community project; review hosting terms if you later turn it into a commercial service.

## Security properties and maintenance

- Only `dist/` is published. The public snapshot has an explicit field allowlist; it contains no database files, nominations, source credentials, or rate-limit records.
- There is no public database, login system, administrative endpoint, or write API on the Pages version. Search, filtering, comparisons, profile views, and formula-safe CSV export run against the public snapshot in the browser.
- The Pages build adds a content security policy that limits scripts, requests, fonts, and images to the same origin and blocks object embeds and native form submissions. GitHub Pages does not provide arbitrary response-header control; the meta policy is not equivalent to a full configurable reverse proxy.
- Frontend builds and deploys have no Kaggle token. Workflow permissions are read-only by default, with Pages deployment permissions granted only to the deploy job. Pull requests never trigger the publishing workflow. Official Actions are pinned to verified release commit SHAs; Dependabot can propose reviewed updates.
- Keep GitHub account 2FA enabled. Protect `main` with review requirements if others can contribute. Anyone who can change the publishing workflow on `main` must be trusted with its secrets.
- Review Dependabot updates and keep Actions and dependencies maintained. The workflow checks browser runtime dependencies with `npm audit --omit=dev --audit-level=high` before publishing. An audit is not a complete security assessment.
- Revoke/replace the Kaggle token if it is exposed or expires, and update the repository secret. Check failed workflow notifications; the website can keep serving an older snapshot when a job fails.

## Local verification of the free build

With the current real database:

```powershell
.\.venv\Scripts\python.exe -m backend.export_static
npm run build:pages
npm run preview
```

Open the preview URL printed by Vite. This build reads `data/snapshot.json` relative to the website root, so it also works under a repository path such as `/KaggleJo/`. The normal `npm run dev:all` path continues to use the local Flask API.

Automated checks:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
npm test
npm run build:pages
```

After configuring your repository, inspect the workflow runs and verify the published HTTPS site. The workflow records each deployment's status and URL.
