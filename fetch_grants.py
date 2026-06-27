#!/usr/bin/env python3
"""
fetch_grants.py — Build the live data file for the Proud Ground grant tracker.

Combines three sources into a single `grants-data.json`:
  1. CURATED   — hand-researched, high-value local funders (grants-curated.json).
                 These have no API; they are the trusted baseline.
  2. FEDERAL   — live housing / homeownership opportunities from the public
                 Grants.gov Search2 API (no key required).
  3. PROSPECTS — Oregon / SW-Washington grantmaking foundations from the public
                 ProPublica Nonprofit Explorer API (IRS 990 data, no key).
                 These are "local orgs that give money" to research — they do
                 NOT have deadlines, so they live in a separate `prospects`
                 array and are never written to the calendar / Word summaries.

Design rules (match the repo conventions):
  * Standard library only — no pip install needed, so the GitHub Action that
    runs this on a schedule has nothing to break.
  * Resilient: if any remote source errors or times out, log a warning and keep
    going. The curated baseline guarantees the site is never empty.
  * Deterministic-ish: results are sorted and de-duplicated by id / EIN.
"""

import json
import os
import re
import sys
import html
import datetime
import urllib.request
import urllib.error
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
CURATED_PATH = os.path.join(HERE, "grants-curated.json")
OUT_ROOT = os.path.join(HERE, "grants-data.json")
OUT_DOCS = os.path.join(HERE, "docs", "grants-data.json")

UA = "ProudGroundGrantTracker/1.0 (+https://github.com/CharlotteGAnderson/grant-source-pg)"
TIMEOUT = 25

# Keywords that describe what a Community Land Trust can actually use money for.
FEDERAL_KEYWORDS = "affordable housing homeownership community land trust first-time homebuyer"
# Geographies we care about (ProPublica is state-scoped).
PROSPECT_STATES = ["OR", "WA"]
PROSPECT_QUERIES = ["community foundation", "housing foundation", "charitable trust"]
MAX_FEDERAL = 25
MAX_PROSPECTS = 30

# A federal hit is only kept if its title/agency actually relates to housing or
# community development — the Grants.gov keyword search is fuzzy and otherwise
# lets in cemeteries, arts, robotics, etc.
FEDERAL_RELEVANCE = (
    "housing", "homeown", "home buyer", "homebuyer", "affordable", "rental",
    "community development", "neighbor", "homeless", "cdfi", "land trust",
    "down payment", "foreclosure", "habitat", "shelter", "section 4",
    "section 8", "section 811", "self-help", "hud",
)


def _relevant(title, agency):
    blob = f"{title} {agency}".lower()
    return any(term in blob for term in FEDERAL_RELEVANCE)


def log(msg):
    print(f"[fetch_grants] {msg}", file=sys.stderr)


def _post_json(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json", "User-Agent": UA},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


# --------------------------------------------------------------------------- #
# 1. Curated baseline
# --------------------------------------------------------------------------- #
def load_curated():
    with open(CURATED_PATH) as f:
        data = json.load(f)
    grants = data.get("grants", [])
    for g in grants:
        g.setdefault("source", "curated")
        g.setdefault("category", "Local / curated")
    log(f"curated: {len(grants)} grants")
    return data.get("org", {}), grants


# --------------------------------------------------------------------------- #
# 2. Federal opportunities (Grants.gov Search2)
# --------------------------------------------------------------------------- #
def _iso_from_mdy(s):
    """Grants.gov close dates look like '08/03/2026'. Return ISO or None."""
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def fetch_federal():
    try:
        resp = _post_json(
            "https://api.grants.gov/v1/api/search2",
            {"keyword": FEDERAL_KEYWORDS, "rows": 60, "oppStatuses": "forecasted|posted"},
        )
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
        log(f"WARNING federal source failed: {e!r} — skipping")
        return []

    if resp.get("errorcode") not in (0, None):
        log(f"WARNING Grants.gov errorcode={resp.get('errorcode')} — skipping")
        return []

    hits = resp.get("data", {}).get("oppHits", []) or []
    out = []
    for h in hits:
        deadline = _iso_from_mdy(h.get("closeDate"))
        if not deadline:
            continue  # no usable deadline -> not an actionable opportunity
        # Sanitize the id to a strict allowlist before it ever lands in a URL or
        # the .ics file — never trust raw API strings in a constructed link.
        opp_id = re.sub(r"[^A-Za-z0-9_-]", "", str(h.get("id") or h.get("number") or ""))
        number = re.sub(r"[^A-Za-z0-9 ._/-]", "", (h.get("number") or "").strip())
        if not opp_id:
            continue
        agency = html.unescape((h.get("agency") or h.get("agencyCode") or "Federal agency").strip())
        title = html.unescape((h.get("title") or "Untitled federal opportunity").strip())
        if not _relevant(title, agency):
            continue  # drop fuzzy-keyword noise (cemeteries, arts, robotics, ...)
        out.append({
            "id": f"fed-{opp_id}",
            "name": title,
            "funder": f"{agency} (via Grants.gov)",
            "amount": "See funder page",
            "amount_min": 0,
            "amount_max": 0,
            "deadline": deadline,
            "deadline_note": (
                f"Federal opportunity {number or opp_id}. Close date {h.get('closeDate', 'n/a')}. "
                "Confirm the exact deadline and any cycle on Grants.gov."
            ),
            "status": "Federal – open",
            "fit": "Review – federal housing/community-development program; confirm nonprofit/CLT eligibility.",
            "url": f"https://www.grants.gov/search-results-detail/{opp_id}",
            "eligibility": "See listing. Many HUD/USDA/Treasury housing programs include nonprofits and CLTs.",
            "use": "Varies by program – see the official opportunity.",
            "needed": [
                "Active SAM.gov registration (UEI)",
                "Grants.gov Workspace application",
                "Program-specific project narrative & budget",
            ],
            "summary": (
                f"{title} — {agency}. Pulled automatically from Grants.gov. "
                "This is a federal listing surfaced because it matches affordable-housing / "
                "homeownership keywords; verify eligibility, amounts, and the deadline on the "
                "official page before investing time."
            ),
            "pg_application": (
                "As an Oregon-based 501(c)(3) Community Land Trust, Proud Ground may be an eligible "
                f"applicant for this {agency} program supporting affordable housing and community development. "
                "Confirm the specific eligibility, then tie the request to a current Proud Ground need "
                "such as land acquisition, homebuyer support, or organizational capacity before applying."
            ),
            "source": "Grants.gov",
            "category": "Federal",
        })
        if len(out) >= MAX_FEDERAL:
            break
    log(f"federal: {len(out)} opportunities")
    return out


# --------------------------------------------------------------------------- #
# 3. Local funder prospects (ProPublica Nonprofit Explorer)
# --------------------------------------------------------------------------- #
def fetch_prospects():
    seen = set()
    out = []
    for state in PROSPECT_STATES:
        for q in PROSPECT_QUERIES:
            if len(out) >= MAX_PROSPECTS:
                break
            url = (
                "https://projects.propublica.org/nonprofits/api/v2/search.json"
                f"?q={urllib.parse.quote(q)}&state%5Bid%5D={state}"
            )
            try:
                resp = _get_json(url)
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
                log(f"WARNING prospects {state}/{q!r} failed: {e!r} — skipping")
                continue
            for o in resp.get("organizations", []) or []:
                ein = str(o.get("ein") or "").strip()
                if not ein or ein in seen:
                    continue
                seen.add(ein)
                name = (o.get("name") or "").title().strip()
                city = (o.get("city") or "").strip()
                st = (o.get("state") or state).strip()
                out.append({
                    "id": f"prospect-{ein}",
                    "name": name,
                    "funder": name,
                    "location": ", ".join(p for p in [city, st] if p),
                    "ein": ein,
                    "url": f"https://projects.propublica.org/nonprofits/organizations/{ein}",
                    "matched_on": q,
                    "summary": (
                        f"{name}{(' — ' + city) if city else ''}, {st}. A local tax-exempt "
                        "organization surfaced from IRS 990 data as a potential funder/partner. "
                        "Open the ProPublica profile to review its 990s, grants paid, and contact "
                        "info, then check whether it funds housing/homeownership work."
                    ),
                    "source": "ProPublica 990",
                    "category": "Local funder prospect",
                })
                if len(out) >= MAX_PROSPECTS:
                    break
    out.sort(key=lambda p: p["name"])
    log(f"prospects: {len(out)} local funders")
    return out


# --------------------------------------------------------------------------- #
# Assemble + write
# --------------------------------------------------------------------------- #
def main():
    org, curated = load_curated()
    federal = fetch_federal()

    # Merge opportunities, de-dupe by id (curated wins).
    by_id = {}
    for g in curated + federal:
        by_id.setdefault(g["id"], g)
    grants = sorted(by_id.values(), key=lambda g: g.get("deadline", "9999-12-31"))

    prospects = fetch_prospects()

    sources = ["curated"]
    if federal:
        sources.append("Grants.gov")
    if prospects:
        sources.append("ProPublica 990")

    org = dict(org)
    org["updated"] = datetime.date.today().isoformat()

    out = {
        "org": org,
        "generated_at": datetime.datetime.now(datetime.timezone.utc)
                        .replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "sources": sources,
        "counts": {
            "grants": len(grants),
            "curated": len(curated),
            "federal": len(federal),
            "prospects": len(prospects),
        },
        "grants": grants,
        "prospects": prospects,
    }

    payload = json.dumps(out, indent=2, ensure_ascii=False)
    with open(OUT_ROOT, "w") as f:
        f.write(payload + "\n")
    os.makedirs(os.path.dirname(OUT_DOCS), exist_ok=True)
    with open(OUT_DOCS, "w") as f:
        f.write(payload + "\n")

    log(f"WROTE {OUT_ROOT} and {OUT_DOCS}: "
        f"{len(grants)} grants ({len(curated)} curated + {len(federal)} federal), "
        f"{len(prospects)} prospects")


if __name__ == "__main__":
    main()
