# Security Policy

This repository powers a **static informational website** — the Proud Ground
Grant & Funding Tracker. It has no backend, no user accounts, no databases, and
stores no personal data. All data shown is public information about grant
programs and tax-exempt organizations.

## Reporting a vulnerability

If you believe you've found a security issue, please report it **privately** —
do not open a public issue, and do not exploit it beyond what's needed to
demonstrate the problem.

Preferred: use GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**). This opens a confidential channel with
the maintainer.

Please include:

- A description of the issue and where it is (file, URL, or page area)
- Steps to reproduce, or a minimal proof of concept
- The potential impact as you see it

We aim to acknowledge a report within **7 days** and to address confirmed,
valid issues as quickly as is practical for a volunteer-maintained project.

## Scope

In scope:

- This repository's code (`docs/`, build scripts, the GitHub Actions workflow)
- The deployed GitHub Pages site

Out of scope (please report to the relevant owner instead):

- **Grants.gov** and **ProPublica Nonprofit Explorer** — third-party public APIs
  this project reads from. We do not control them.
- **cdn.jsdelivr.net** — the CDN that serves Chart.js (pinned with Subresource
  Integrity in this project).
- Inaccurate, outdated, or incomplete grant data. This is a research aid, not
  authoritative — always confirm details on the funder's official page. Data
  accuracy issues are bugs, not security vulnerabilities; please open a normal
  issue for those.

## How this project is hardened

For transparency, the measures already in place:

- **No secrets.** The site uses no API keys or credentials; the external APIs it
  reads are public and keyless. `.gitignore` blocks `.env*` files.
- **Server-side data fetch only.** Third-party APIs are called inside the GitHub
  Action, never from a visitor's browser. The browser only fetches this site's
  own same-origin data file.
- **Output is escaped.** Every value rendered to the page — including text that
  originates from third-party APIs — is HTML-escaped, and every link URL is
  validated to `http(s)` before use.
- **Content Security Policy.** A strict CSP restricts script, style, and
  connection sources; there are no inline scripts.
- **Subresource Integrity.** The single external script (Chart.js) is pinned to
  an exact version with an SRI hash, so a tampered CDN file will not execute.
- **Least-privilege CI.** The deploy workflow requests only the permissions it
  needs (`contents: read`, `pages: write`, `id-token: write`) and is not
  triggered by pull requests from forks.

## Supported versions

Only the current `main` branch (the live site) is supported. There are no
released versions or backports.
