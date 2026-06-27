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
