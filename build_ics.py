#!/usr/bin/env python3
"""Generate an iCalendar (.ics) file with one all-day event per grant deadline,
each with a 30-day and 7-day reminder. Reads grants-data.json."""
import json, datetime, hashlib, textwrap, os

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "grants-data.json")) as f:
    data = json.load(f)

def esc(s):
    return (s.replace("\\", "\\\\").replace(";", "\\;")
             .replace(",", "\\,").replace("\n", "\\n"))

def fold(line):
    # RFC 5545: fold lines longer than 75 octets
    out = []
    while len(line.encode("utf-8")) > 73:
        # find a safe cut point under 73 bytes
        cut = 73
        while len(line[:cut].encode("utf-8")) > 73:
            cut -= 1
        out.append(line[:cut])
        line = " " + line[cut:]
    out.append(line)
    return "\r\n".join(out)

now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Proud Ground//Grant Tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Proud Ground Grant Deadlines",
    "X-WR-TIMEZONE:America/Los_Angeles",
    "X-WR-CALDESC:Grant and funding deadlines relevant to Proud Ground (CLT).",
]

events = 0
for g in data["grants"]:
    # Auto-pulled entries could lack a usable deadline; skip rather than crash.
    try:
        d = datetime.date.fromisoformat(g.get("deadline", ""))
    except (ValueError, TypeError):
        continue
    dt = d.strftime("%Y%m%d")
    dt_end = (d + datetime.timedelta(days=1)).strftime("%Y%m%d")
    uid = hashlib.sha1((g["id"] + g["deadline"]).encode()).hexdigest()[:16] + "@proudground"
    desc = (f"Funder: {g['funder']}\n"
            f"Amount: {g['amount']}\n"
            f"Status: {g['status']}\n"
            f"Fit: {g['fit']}\n\n"
            f"Deadline detail: {g['deadline_note']}\n\n"
            f"Eligibility: {g['eligibility']}\n\n"
            f"Apply: {g['url']}")
    ev = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{now}",
        f"DTSTART;VALUE=DATE:{dt}",
        f"DTEND;VALUE=DATE:{dt_end}",
        fold("SUMMARY:" + esc(f"Grant deadline: {g['name']} ({g['funder'].split('/')[0].strip()})")),
        fold("DESCRIPTION:" + esc(desc)),
        fold("URL:" + g["url"]),
        "TRANSP:TRANSPARENT",
        "STATUS:CONFIRMED",
        # 30-day reminder
        "BEGIN:VALARM",
        "TRIGGER:-P30D",
        "ACTION:DISPLAY",
        fold("DESCRIPTION:" + esc(f"30 days until {g['name']} deadline")),
        "END:VALARM",
        # 7-day reminder
        "BEGIN:VALARM",
        "TRIGGER:-P7D",
        "ACTION:DISPLAY",
        fold("DESCRIPTION:" + esc(f"1 week until {g['name']} deadline")),
        "END:VALARM",
        "END:VEVENT",
    ]
    lines.extend(ev)
    events += 1

lines.append("END:VCALENDAR")

out_path = os.path.join(HERE, "docs", "proudground-grants.ics")
with open(out_path, "w", newline="") as f:
    f.write("\r\n".join(lines) + "\r\n")
print("Wrote", out_path, "with", events, "events")
