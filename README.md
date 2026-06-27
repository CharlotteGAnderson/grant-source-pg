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

## Repository layout

```
proudground-grants/
├── grants-data.json          ← single source of truth (edit this)
├── build_ics.py              ← generates the calendar from the JSON
├── build_docs.js             ← generates the Word summaries from the JSON
├── .github/workflows/
│   └── deploy.yml            ← auto-rebuilds + deploys on every push to main
└── docs/                     ← published by GitHub Pages
    ├── index.html            ← the website
    ├── grants-data.json      ← copy the site reads at runtime
    ├── proudground-grants.ics← the downloadable calendar
    ├── .nojekyll
    └── grant-summaries/
        └── <grant-id>.docx   ← one Word summary per grant
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

1. Edit **`grants-data.json`** — add, remove, or change entries in the `grants` array.
2. Commit and push. The GitHub Action regenerates the `.ics` calendar and all `.docx`
   summaries and redeploys automatically.

To rebuild locally instead:
```bash
cp grants-data.json docs/grants-data.json
python3 build_ics.py            # rebuilds docs/proudground-grants.ics
npm install docx                # first time only
node build_docs.js              # rebuilds docs/grant-summaries/*.docx
```

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
