/* Proud Ground — Grant & Funding Intelligence dashboard.
   Renders grants-data.json (curated + federal opportunities + local-funder
   prospects), auto-refreshes on a timer, and is XSS-safe: every value pulled
   from the data file — some of which originates from third-party APIs — is
   HTML-escaped before it touches the DOM, and every external URL is validated. */
"use strict";

const REFRESH_MS = 10 * 60 * 1000;   // re-fetch the data file every 10 minutes
const $ = (s) => document.querySelector(s);
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

let DATA = { grants: [], prospects: [] };
let lastGenerated = null;
let oppFilter = "all";
let oppMonth = null;     // YYYY-MM set by clicking a chart bar
let monthKeys = [];      // month buckets behind the deadlines chart (index -> YYYY-MM)
let oppQuery = "";
let oppSort = { key: "deadline", dir: 1 };
let funderQuery = "";
let funderSort = { key: "name", dir: 1 };
let charts = {};

/* ---------- safety helpers ---------- */
function esc(v) {
  return String(v == null ? "" : v)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function safeUrl(u) {
  // Only allow http(s); anything else (javascript:, data:, …) becomes inert.
  try {
    const url = new URL(u, window.location.href);
    return (url.protocol === "http:" || url.protocol === "https:") ? url.href : "#";
  } catch { return "#"; }
}

/* ---------- date helpers ---------- */
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function daysUntil(iso) {
  if (!iso) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return null;
  return Math.round((d - now) / 86400000);
}
function relTime(iso) {
  if (!iso) return "unknown";
  const t = new Date(iso);
  if (isNaN(t)) return "unknown";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return `${Math.floor(s / 86400)} day${Math.floor(s / 86400) === 1 ? "" : "s"} ago`;
}
function countdown(iso) {
  const du = daysUntil(iso);
  if (du == null) return { cls: "s-open", txt: "Rolling / no fixed date" };
  if (du < 0) return { cls: "s-soon", txt: "Recurring · est." };
  if (du === 0) return { cls: "s-now", txt: "Due today" };
  if (du === 1) return { cls: "s-now", txt: "Due tomorrow" };
  if (du <= 45) return { cls: "s-now", txt: `Due in ${du} days` };
  if (du <= 120) return { cls: "s-soon", txt: `Due in ${du} days` };
  return { cls: "s-open", txt: `Due in ${du} days` };
}
function sourceBadge(src) {
  if (src === "Grants.gov") return '<span class="badge b-federal">Federal</span>';
  if (src === "ProPublica 990") return '<span class="badge b-prospect">Prospect</span>';
  return '<span class="badge b-curated">Curated</span>';
}

/* ---------- KPIs + overview ---------- */
function renderKpis() {
  const g = DATA.grants;
  const open = g.filter((x) => { const d = daysUntil(x.deadline); return d != null && d >= 0; });
  const soon = open.filter((x) => daysUntil(x.deadline) <= 120);
  const big = g.filter((x) => (x.amount_max || 0) >= 100000);
  const fed = g.filter((x) => x.source === "Grants.gov");
  const tiles = [
    { n: g.length, l: "Open opportunities", tab: "opps", filter: "all", go: "View all" },
    { n: soon.length, l: "Closing within 120 days", cls: "alert", tab: "opps", filter: "soon", go: "View these" },
    { n: big.length, l: "Awards of $100k+", tab: "opps", filter: "big", go: "View these" },
    { n: fed.length, l: "Live federal grants", cls: "fed", tab: "opps", filter: "federal", go: "View these" },
    { n: DATA.prospects.length, l: "Local funder leads", cls: "prospect", tab: "funders", go: "View leads" },
  ];
  $("#kpis").innerHTML = tiles.map((t) =>
    `<div class="kpi click ${t.cls || ""}" role="button" tabindex="0"
          data-tab="${esc(t.tab)}" data-filter="${esc(t.filter || "")}">
       <div class="n">${esc(t.n)}</div><div class="l">${esc(t.l)}</div>
       <div class="go">${esc(t.go)} &rarr;</div>
     </div>`
  ).join("");
}

// Jump to the Opportunities tab with a given filter (also used by KPIs + charts).
function goToOpps(filter) {
  oppMonth = null;
  oppFilter = filter || "all";
  buildOppFilters();
  renderOpps();
  switchTab("opps");
}

function kpiActivate(e) {
  const el = e.target.closest(".kpi.click");
  if (!el) return;
  if (el.dataset.tab === "funders") switchTab("funders");
  else goToOpps(el.dataset.filter || "all");
}

function renderSoon() {
  const open = DATA.grants
    .filter((x) => { const d = daysUntil(x.deadline); return d != null && d >= 0; })
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline))
    .slice(0, 6);
  if (!open.length) { $("#soonList").innerHTML = '<li class="empty">No dated deadlines right now.</li>'; return; }
  $("#soonList").innerHTML = open.map((g) => {
    const c = countdown(g.deadline);
    return `<li>
      <span class="soon-when badge ${c.cls}">${esc(c.txt.replace("Due in ", "").replace(" days", "d"))}</span>
      <span class="soon-name"><b>${esc(g.name)}</b><span>${esc(g.funder)} · ${fmtDate(g.deadline)}</span></span>
      ${sourceBadge(g.source)}
    </li>`;
  }).join("");
}

function renderCharts() {
  if (!window.Chart) return;
  // Deadlines by month (open grants only)
  const open = DATA.grants.filter((x) => { const d = daysUntil(x.deadline); return d != null && d >= 0; });
  const byMonth = {};
  open.forEach((g) => {
    const d = new Date(g.deadline + "T00:00:00");
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth[key] = (byMonth[key] || 0) + 1;
  });
  const keys = Object.keys(byMonth).sort();
  monthKeys = keys;
  const labels = keys.map((k) => { const [y, m] = k.split("-"); return `${MONTHS[+m - 1]} ${y.slice(2)}`; });
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const pointer = (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; };

  charts.deadlines && charts.deadlines.destroy();
  charts.deadlines = new Chart($("#chartDeadlines"), {
    type: "bar",
    data: { labels, datasets: [{ data: keys.map((k) => byMonth[k]), backgroundColor: css("--brand"), borderRadius: 5, maxBarThickness: 38 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
      onHover: pointer,
      onClick: (e, els) => { if (els.length) { oppMonth = monthKeys[els[0].index]; oppFilter = "all"; buildOppFilters(); renderOpps(); switchTab("opps"); } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: css("--line-soft") } }, x: { grid: { display: false } } } },
  });

  // Sources doughnut
  const counts = DATA.counts || {};
  charts.sources && charts.sources.destroy();
  charts.sources = new Chart($("#chartSources"), {
    type: "doughnut",
    data: {
      labels: ["Curated", "Federal", "Local leads"],
      datasets: [{ data: [counts.curated || 0, counts.federal || 0, counts.prospects || 0],
        backgroundColor: [css("--curated"), css("--fed"), css("--prospect")], borderWidth: 0 }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: "62%",
      onHover: pointer,
      onClick: (e, els) => {
        if (!els.length) return;
        const i = els[0].index;
        if (i === 0) goToOpps("curated");
        else if (i === 1) goToOpps("federal");
        else switchTab("funders");
      },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 12 } } } } },
  });
}

/* ---------- opportunities table ---------- */
function buildOppFilters() {
  const defs = [["all", "All"], ["curated", "Curated"], ["federal", "Federal"],
    ["soon", "Closing ≤120d"], ["high", "Strong fit"], ["big", "$100k+"]];
  $("#oppFilters").innerHTML = defs.map(([k, l]) =>
    `<button class="chip ${k === oppFilter ? "active" : ""}" data-f="${k}">${esc(l)}</button>`).join("");
  $("#oppFilters").querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => { oppMonth = null; oppFilter = b.dataset.f; buildOppFilters(); renderOpps(); }));
}

function filteredOpps() {
  let list = [...DATA.grants];
  if (oppMonth) list = list.filter((g) => (g.deadline || "").slice(0, 7) === oppMonth);
  if (oppFilter === "curated") list = list.filter((g) => g.source === "curated");
  else if (oppFilter === "federal") list = list.filter((g) => g.source === "Grants.gov");
  else if (oppFilter === "soon") list = list.filter((g) => { const d = daysUntil(g.deadline); return d != null && d >= 0 && d <= 120; });
  else if (oppFilter === "high") list = list.filter((g) => /high/i.test(g.fit || ""));
  else if (oppFilter === "big") list = list.filter((g) => (g.amount_max || 0) >= 100000);
  if (oppQuery) {
    const q = oppQuery.toLowerCase();
    list = list.filter((g) => `${g.name} ${g.funder} ${g.summary} ${g.fit}`.toLowerCase().includes(q));
  }
  const { key, dir } = oppSort;
  list.sort((a, b) => {
    let av, bv;
    if (key === "days") { av = daysUntil(a.deadline) ?? 1e9; bv = daysUntil(b.deadline) ?? 1e9; }
    else if (key === "amount_max") { av = a.amount_max || 0; bv = b.amount_max || 0; }
    else if (key === "deadline") { av = a.deadline || "9999"; bv = b.deadline || "9999"; }
    else { av = (a[key] || "").toString().toLowerCase(); bv = (b[key] || "").toString().toLowerCase(); }
    return av < bv ? -dir : av > bv ? dir : 0;
  });
  return list;
}

function renderOppMonthBar() {
  const bar = $("#oppMonthBar");
  if (!oppMonth) { bar.innerHTML = ""; return; }
  const [y, m] = oppMonth.split("-");
  const label = `${MONTHS[+m - 1]} ${y}`;
  bar.innerHTML = `<span class="pill">Deadlines in ${esc(label)} <button type="button" id="clearMonth" aria-label="Clear month filter">&times;</button></span>`;
  $("#clearMonth").addEventListener("click", () => { oppMonth = null; renderOpps(); });
}

function renderOpps() {
  renderOppMonthBar();
  const list = filteredOpps();
  const body = $("#oppBody");
  if (!list.length) { body.innerHTML = '<tr><td colspan="6"><div class="empty">No opportunities match.</div></td></tr>'; return; }
  body.innerHTML = list.map((g) => {
    const c = countdown(g.deadline);
    const docx = g.source === "curated"
      ? `<a href="grant-summaries/${esc(encodeURIComponent(g.id))}.docx" download>Word</a>` : "";
    return `<tr>
      <td class="cell-name">
        <b>${esc(g.name)}</b>
        <div class="funder">${esc(g.funder)}</div>
        <div class="fit">${esc(g.fit || "")}</div>
      </td>
      <td class="hide-sm">${sourceBadge(g.source)}</td>
      <td class="hide-sm amount">${esc(g.amount || "—")}</td>
      <td class="deadline">${fmtDate(g.deadline)}</td>
      <td><span class="count badge ${c.cls}">${esc(c.txt)}</span></td>
      <td class="links"><a class="primary" href="${esc(safeUrl(g.url))}" target="_blank" rel="noopener noreferrer">Apply ↗</a>${docx}</td>
    </tr>`;
  }).join("");
}

/* ---------- funders table ---------- */
function filteredFunders() {
  let list = [...DATA.prospects];
  if (funderQuery) {
    const q = funderQuery.toLowerCase();
    list = list.filter((p) => `${p.name} ${p.location} ${p.matched_on}`.toLowerCase().includes(q));
  }
  const { key, dir } = funderSort;
  list.sort((a, b) => {
    const av = (a[key] || "").toString().toLowerCase(), bv = (b[key] || "").toString().toLowerCase();
    return av < bv ? -dir : av > bv ? dir : 0;
  });
  return list;
}

function renderFunders() {
  const list = filteredFunders();
  const body = $("#funderBody");
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="4"><div class="empty">No local funder leads loaded yet. The scheduled job populates these from IRS 990 data.</div></td></tr>';
    return;
  }
  body.innerHTML = list.map((p) => `<tr>
      <td class="cell-name"><b>${esc(p.name)}</b><div class="fit">EIN ${esc(p.ein || "—")}</div></td>
      <td class="hide-sm funder">${esc(p.location || "—")}</td>
      <td class="hide-sm funder">${esc(p.matched_on || "—")}</td>
      <td class="links"><a class="primary" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">990 profile ↗</a></td>
    </tr>`).join("");
}

/* ---------- sorting headers ---------- */
function wireSort(tableSel, state, rerender) {
  $(tableSel).querySelectorAll("thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.key === key) state.dir *= -1; else { state.key = key; state.dir = 1; }
      $(tableSel).querySelectorAll("thead th").forEach((h) => {
        const base = h.textContent.replace(/[ ▲▼]+$/, "");
        h.innerHTML = esc(base) + (h.dataset.sort === key ? ` <span class="arrow">${state.dir > 0 ? "▲" : "▼"}</span>` : "");
      });
      rerender();
    });
  });
}

/* ---------- chrome: tabs, meta, refresh ---------- */
function switchTab(name) {
  document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tabpanel").forEach((p) => p.classList.toggle("active", p.id === `tab-${name}`));
  window.scrollTo(0, 0);
  if (name === "overview") renderCharts();
}

function renderMeta() {
  const org = DATA.org || {};
  $("#updatedLabel").textContent = "Updated " + relTime(DATA.generated_at);
  $("#aboutMeta").textContent =
    `${org.name || "Proud Ground"} · ${org.type || ""} · data generated ${DATA.generated_at ? new Date(DATA.generated_at).toLocaleString() : "—"} · sources: ${(DATA.sources || []).join(", ")}`;
  $("#footer").innerHTML =
    `<b>${esc(org.name || "Proud Ground")}</b> — ${esc(org.type || "")}. ${esc(org.address || "")} · EIN ${esc(org.ein || "")}.
     Data auto-refreshed on a schedule; this is a research aid, not advice — confirm every detail on the funder's official page.
     <div style="margin-top:10px">Built as <b>volunteer work</b> in support of Proud Ground · <a href="https://www.proudground.org/" target="_blank" rel="noopener noreferrer">proudground.org &#8599;</a></div>`;
}

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---------- calendar drawer ---------- */
function openDrawer() {
  $("#calDrawer").classList.add("open");
  $("#calDrawer").setAttribute("aria-hidden", "false");
  $("#drawerOverlay").hidden = false;
  document.addEventListener("keydown", drawerEsc);
}
function closeDrawer() {
  $("#calDrawer").classList.remove("open");
  $("#calDrawer").setAttribute("aria-hidden", "true");
  $("#drawerOverlay").hidden = true;
  document.removeEventListener("keydown", drawerEsc);
}
function drawerEsc(e) { if (e.key === "Escape") closeDrawer(); }

function renderAll() {
  renderKpis(); renderSoon(); renderCharts();
  renderOpps(); renderFunders(); renderMeta();
}

async function load(announce) {
  try {
    const r = await fetch("grants-data.json?cb=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    DATA = d;
    DATA.grants = Array.isArray(d.grants) ? d.grants : [];
    DATA.prospects = Array.isArray(d.prospects) ? d.prospects : [];
    const changed = d.generated_at && d.generated_at !== lastGenerated;
    lastGenerated = d.generated_at;
    renderAll();
    if (announce && changed) toast("Data updated — " + (DATA.counts ? DATA.counts.grants : DATA.grants.length) + " opportunities");
  } catch (e) {
    $("#updatedLabel").textContent = "Couldn't load data";
    if (!DATA.grants.length) {
      $("#oppBody").innerHTML = '<tr><td colspan="6"><div class="empty">Could not load grants-data.json. If viewing locally, serve over HTTP (e.g. <code>python3 -m http.server</code>).</div></td></tr>';
    }
  }
}

/* ---------- init ---------- */
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]"); if (b) switchTab(b.dataset.tab);
});
$("#refreshBtn").addEventListener("click", () => load(true));
$("#oppSearch").addEventListener("input", (e) => { oppQuery = e.target.value; renderOpps(); });
$("#funderSearch").addEventListener("input", (e) => { funderQuery = e.target.value; renderFunders(); });
$("#kpis").addEventListener("click", kpiActivate);
$("#kpis").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); kpiActivate(e); } });
$("#calBtn").addEventListener("click", openDrawer);
$("#calClose").addEventListener("click", closeDrawer);
$("#drawerOverlay").addEventListener("click", closeDrawer);
buildOppFilters();
wireSort("#oppTable", oppSort, renderOpps);
wireSort("#funderTable", funderSort, renderFunders);

load(false);
setInterval(() => load(true), REFRESH_MS);      // auto-refresh data
setInterval(() => { if (DATA.generated_at) $("#updatedLabel").textContent = "Updated " + relTime(DATA.generated_at); }, 60000);
