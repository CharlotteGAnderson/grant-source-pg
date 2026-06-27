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


# Google News RSS queries for Pacific-Northwest housing/funding news (keyless).
NEWS_QUERIES = [
    ("Oregon affordable housing", "Housing"),
    ("Portland affordable housing grant", "Funding"),
    ("Oregon housing grant funding", "Funding"),
    ("community land trust Oregon Washington", "Housing"),
    ("Oregon housing policy legislature", "Policy"),
    ("first-time homebuyer Oregon assistance", "Housing"),
    ("Southwest Washington affordable housing Vancouver", "Housing"),
    ("HUD Oregon housing", "Government"),
]
NEWS_RELEVANCE = (
    "hous", "home", "rent", "afford", "grant", "fund", "hud", "land trust",
    "homeless", "tenant", "mortgage", "down payment", "displace", "zoning",
    "development", "shelter", "buyer", "equity",
)
MAX_NEWS = 30

# Built-in coordinates for OR / SW-WA cities so the funder map needs no external
# geocoder (keeps the build self-contained and the site CSP strict). Approximate
# city centroids — fine for a stylized regional bubble map.
CITY_COORDS = {
    "portland": (45.52, -122.68), "beaverton": (45.487, -122.80), "hillsboro": (45.523, -122.99),
    "gresham": (45.50, -122.43), "salem": (44.94, -123.04), "eugene": (44.05, -123.09),
    "springfield": (44.05, -123.02), "corvallis": (44.56, -123.26), "albany": (44.64, -123.11),
    "bend": (44.06, -121.31), "redmond": (44.27, -121.17), "medford": (42.33, -122.87),
    "ashland": (42.19, -122.71), "central point": (42.38, -122.92), "grants pass": (42.44, -123.33),
    "roseburg": (43.22, -123.34), "coos bay": (43.37, -124.22), "klamath falls": (42.22, -121.78),
    "pendleton": (45.67, -118.79), "la grande": (45.32, -118.09), "astoria": (46.19, -123.83),
    "newport": (44.64, -124.05), "tillamook": (45.46, -123.84), "the dalles": (45.59, -121.18),
    "hood river": (45.71, -121.52), "hermiston": (45.84, -119.29), "ontario": (44.03, -116.96),
    "baker city": (44.77, -117.83), "mcminnville": (45.21, -123.20), "newberg": (45.30, -122.97),
    "forest grove": (45.52, -123.11), "banks": (45.62, -123.11), "hubbard": (45.18, -122.81),
    "woodburn": (45.14, -122.86), "molalla": (45.15, -122.58), "canby": (45.26, -122.69),
    "oregon city": (45.36, -122.61), "wilsonville": (45.30, -122.77), "tualatin": (45.38, -122.76),
    "tigard": (45.43, -122.77), "lake oswego": (45.42, -122.67), "west linn": (45.37, -122.61),
    "milwaukie": (45.45, -122.64), "sherwood": (45.36, -122.84), "carlton": (45.29, -123.18),
    "dallas": (44.92, -123.32), "monmouth": (44.85, -123.23), "silverton": (45.00, -122.78),
    "stayton": (44.80, -122.79), "lebanon": (44.54, -122.91), "sweet home": (44.40, -122.74),
    "florence": (43.98, -124.10), "cottage grove": (43.80, -123.06), "sutherlin": (43.39, -123.31),
    "brookings": (42.05, -124.28), "lincoln city": (44.96, -124.02), "seaside": (45.99, -123.92),
    "st. helens": (45.86, -122.82), "st helens": (45.86, -122.82), "sandy": (45.40, -122.26),
    "prineville": (44.30, -120.83), "madras": (44.63, -121.13), "sisters": (44.29, -121.55),
    "burns": (43.59, -118.97), "enterprise": (45.43, -117.28), "john day": (44.42, -118.95),
    "vancouver": (45.63, -122.66), "camas": (45.59, -122.40), "washougal": (45.58, -122.35),
    "battle ground": (45.78, -122.53), "ridgefield": (45.81, -122.74), "longview": (46.14, -122.94),
    "kelso": (46.15, -122.91), "olympia": (47.04, -122.90), "seattle": (47.61, -122.33),
    "tacoma": (47.25, -122.44), "spokane": (47.66, -117.43), "bellingham": (48.75, -122.48),
    "walla walla": (46.06, -118.34), "yakima": (46.60, -120.51), "wenatchee": (47.42, -120.31),
    "aberdeen": (46.98, -123.82), "centralia": (46.72, -122.95),
}


def _coords(city):
    return CITY_COORDS.get((city or "").strip().lower())


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
                latlng = _coords(city)
                out.append({
                    "id": f"prospect-{ein}",
                    "name": name,
                    "funder": name,
                    "location": ", ".join(p for p in [city, st] if p),
                    "city": city,
                    "state": st,
                    "lat": latlng[0] if latlng else None,
                    "lng": latlng[1] if latlng else None,
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
    log(f"prospects: {len(out)} local funders ({sum(1 for p in out if p['lat'])} mappable)")
    return out


# --------------------------------------------------------------------------- #
# 4. Pacific-Northwest housing / funding news (Google News RSS, keyless)
# --------------------------------------------------------------------------- #
def _news_relevant(title):
    t = (title or "").lower()
    return any(term in t for term in NEWS_RELEVANCE)


def _news_topic(title):
    """Curate each story into a topic from its headline (not the query that found
    it), so the News tab's filters are meaningful."""
    t = (title or "").lower()
    if any(k in t for k in ("grant", "fund", "million", "award", "invest", "financ", "bond", "$", "dollar")):
        return "Funding"
    if any(k in t for k in ("bill", "legislat", "policy", "senate", "lawmaker", "council", "measure", "zoning", "ballot", "governor", "ordinance")):
        return "Policy"
    if any(k in t for k in ("hud", "federal", "county", "city of", "government", "agency", "state of", "oregon housing")):
        return "Government"
    return "Housing"


def fetch_news():
    import xml.etree.ElementTree as ET
    from email.utils import parsedate_to_datetime

    seen = set()
    out = []
    per_query = 6  # cap each query so several topics/regions are represented
    for query, _hint in NEWS_QUERIES:
        url = ("https://news.google.com/rss/search?q="
               + urllib.parse.quote(f"{query} when:30d")
               + "&hl=en-US&gl=US&ceid=US:en")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                root = ET.fromstring(r.read())
        except (urllib.error.URLError, TimeoutError, ET.ParseError, OSError) as e:
            log(f"WARNING news {query!r} failed: {e!r} — skipping")
            continue
        added = 0
        for item in root.iter("item"):
            if added >= per_query or len(out) >= MAX_NEWS:
                break
            title = html.unescape((item.findtext("title") or "").strip())
            link = (item.findtext("link") or "").strip()
            if not title or not link or not _news_relevant(title):
                continue
            key = title.lower()[:80]
            if key in seen:
                continue
            seen.add(key)
            src_el = item.find("source")
            source = html.unescape((src_el.text or "").strip()) if src_el is not None else "Google News"
            iso = ""
            pub = item.findtext("pubDate")
            if pub:
                try:
                    iso = parsedate_to_datetime(pub).date().isoformat()
                except (TypeError, ValueError):
                    iso = ""
            out.append({
                "id": f"news-{abs(hash(key)) % (10 ** 10)}",
                "title": title,
                "source": source,
                "date": iso,
                "url": link,
                "topic": _news_topic(title),
            })
            added += 1
        if len(out) >= MAX_NEWS:
            break
    out.sort(key=lambda n: n["date"], reverse=True)
    log(f"news: {len(out)} PNW stories (topics: "
        + ", ".join(sorted({n['topic'] for n in out})) + ")")
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
    news = fetch_news()

    sources = ["curated"]
    if federal:
        sources.append("Grants.gov")
    if prospects:
        sources.append("ProPublica 990")
    if news:
        sources.append("Google News")

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
            "news": len(news),
        },
        "grants": grants,
        "prospects": prospects,
        "news": news,
    }

    payload = json.dumps(out, indent=2, ensure_ascii=False)
    with open(OUT_ROOT, "w") as f:
        f.write(payload + "\n")
    os.makedirs(os.path.dirname(OUT_DOCS), exist_ok=True)
    with open(OUT_DOCS, "w") as f:
        f.write(payload + "\n")

    log(f"WROTE {OUT_ROOT} and {OUT_DOCS}: "
        f"{len(grants)} grants ({len(curated)} curated + {len(federal)} federal), "
        f"{len(prospects)} prospects, {len(news)} news")


if __name__ == "__main__":
    main()
