# Proud Ground — Grant & Funding Tracker

A self-hosted, GitHub Pages website that tracks grant and funding opportunities relevant to
**Proud Ground**, a 501(c)(3) Community Land Trust (EIN 93-1290320) serving affordable
homeownership for first-time and BIPOC buyers across Oregon and SW Washington.

The site gives you, for every opportunity:

- **Funder, amount, and deadline** (with a live countdown)
- **Strategic fit** assessment for a Community Land Trust
- **Eligibility, eligible uses, and an application checklist**
- A **downloadable Word (.docx) summary** per grant
- A **downloadable Google-Calendar-compatible `.ics` file** with all deadlines + 30-day and 7-day reminders

Everything is generated from a single file: **`grants-data.json`**.

---

## Live site

Once deployed (see below), the site is served from the `docs/` folder at:

```
https://<your-github-username>.github.io/<repo-name>/
```

---

## How it stays up to date

This is a **static site**, so the page itself can't crawl the web. Instead, a
**scheduled GitHub Action runs once a week** (Mondays), rebuilds the data file
from live sources, and redeploys. The page also **re-fetches the data every 10
minutes** and shows a "last updated" badge, so an open tab stays current on its own.

`fetch_grants.py` blends four sources into `grants-data.json`:

| Source | What it adds | API |
|--------|--------------|-----|
| **Curated** | hand-researched high-value local funders (`grants-curated.json`) | none — edit by hand |
| **Federal** | live housing / community-development opportunities | [Grants.gov Search2](https://www.grants.gov/) (no key) |
| **Prospects** | OR / SW-WA grantmakers to research, geocoded for the Local Funders map (separate `prospects` list, no deadlines) | [ProPublica Nonprofit Explorer](https://projects.propublica.org/nonprofits/api) (no key) |
| **PNW News** | Pacific-Northwest housing / funding / policy headlines, curated by topic (separate `news` list) | [Google News RSS](https://news.google.com/) (no key) |

The dashboard surfaces this as five views: **Overview** (clickable KPIs + charts
that filter a mini-table), **Opportunities** (sortable table; each row opens a
detail modal with a downloadable Word summary), **Local Funders** (a self-contained
SVG map of OR/SW-WA grantmakers + filterable list), **PNW News**, and **About**.

The fetcher uses only the Python standard library and is resilient: if a remote
source is down it logs a warning and falls back to the curated baseline, so a
build never produces an empty site.

## Repository layout

```
proudground-grants/
├── grants-curated.json       ← hand-curated funders (the part you edit)
├── fetch_grants.py           ← builds grants-data.json from curated + live APIs
├── build_ics.py              ← generates the calendar from the JSON
├── build_docs.js             ← generates Word summaries (curated grants only)
├── .github/workflows/
│   └── deploy.yml            ← cron (2×/day) + push: fetch → build → deploy
├── grants-data.json          ← generated; seed/fallback committed to the repo
└── docs/                     ← published by GitHub Pages
    ├── index.html            ← the dashboard shell
    ├── app.js                ← rendering, search/sort, charts, auto-refresh
    ├── grants-data.json      ← the data the site reads at runtime
    ├── proudground-grants.ics← the downloadable calendar
    ├── .nojekyll
    └── grant-summaries/
        └── <grant-id>.docx   ← one Word summary per curated grant
```

## One-time deployment

1. Create a new repository on GitHub and push this folder to the `main` branch:
   ```bash
   git init
   git add .
   git commit -m "Initial grant tracker"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
   (The included workflow rebuilds the calendar and Word docs, then deploys.)
4. Wait for the **Actions** tab to show a green check. Your site is live.

> Prefer no Actions? You can instead set Pages **Source** to "Deploy from a branch",
> branch `main`, folder `/docs`. In that case, rerun the two build scripts locally
> whenever you edit the data (see below) and commit the regenerated files.

## Updating opportunities

The **federal** opportunities and **local-funder prospects** update themselves on
the schedule — you don't touch those. To change the **curated** list:

1. Edit **`grants-curated.json`** — add, remove, or change entries in the `grants` array.
2. Commit and push. The GitHub Action runs `fetch_grants.py` (which re-merges your
   curated edits with fresh federal + prospect data), regenerates the `.ics` calendar
   and `.docx` summaries, and redeploys automatically.

To rebuild locally instead:
```bash
python3 fetch_grants.py         # curated + live APIs -> grants-data.json (+ docs/)
python3 build_ics.py            # rebuilds docs/proudground-grants.ics
npm install docx                # first time only
node build_docs.js              # rebuilds docs/grant-summaries/*.docx
```
> On macOS, if `fetch_grants.py` reports an SSL certificate error locally, run the
> "Install Certificates.command" that ships with Python, or prefix the command with
> `SSL_CERT_FILE=/etc/ssl/cert.pem`. This only affects local runs; GitHub Actions is fine.

### Grant entry fields

| Field | Purpose |
|-------|---------|
| `id` | unique slug; also the `.docx` filename |
| `name`, `funder` | display title and funder |
| `amount`, `amount_min`, `amount_max` | award size (the min/max drive the “$100k+” filter) |
| `deadline` | `YYYY-MM-DD`; drives the calendar event and countdown |
| `deadline_note` | human detail about the window/cycle |
| `status` | short label (e.g. “Annual – next ~June 2027”) |
| `fit` | strategic-fit assessment (contains “High” to match the Strong-fit filter) |
| `url` | official funder/application page |
| `eligibility`, `use` | who qualifies / what funds can be used for |
| `needed` | array of checklist items shown on the site and in the Word doc |
| `summary` | the paragraph shown on the card and in the Word doc |

## Using the calendar

1. From the live site, click **Download calendar (.ics)**.
2. In Google Calendar: **Settings → Import & Export → Import**, select the file, pick a
   target calendar, and import. Each deadline appears as an all-day event with reminders
   30 days and 7 days out.

---

## Important note on accuracy

Grant deadlines, amounts, and eligibility change frequently. Several entries are **recurring
programs** whose next-cycle dates are *estimated* from the most recently published round
(noted in `status` / `deadline_note`). **Always confirm details on the funder’s official
page before applying.** This tracker is a research aid, not legal or financial advice.

Data compiled June 26, 2026.
