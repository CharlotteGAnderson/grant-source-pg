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
let oppMonth = null;     // YYYY-MM set by clicking a chart bar (full Opportunities tab)
let monthKeys = [];      // month buckets behind the deadlines chart (index -> YYYY-MM)
let oppQuery = "";
let ovFilter = "all";    // overview mini-table filter (set by KPI / chart clicks)
let ovMonth = null;      // overview mini-table month filter
let modalGrant = null;   // grant currently shown in the detail modal
let oppSort = { key: "deadline", dir: 1 };
let funderQuery = "";
let funderCat = "all";   // local-funder category filter (map + table)
let funderSort = { key: "name", dir: 1 };
let newsTopic = "all";
let newsQuery = "";
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

const FILTER_LABEL = {
  all: "Closing soonest", soon: "Closing within 120 days", big: "Awards of $100k+",
  federal: "Live federal grants", curated: "Curated local funders", high: "Strong fit",
};

// Shared matcher used by both the overview mini-table and the full Opportunities table.
function matchOpps({ filter, month, query }) {
  let list = [...DATA.grants];
  if (month) list = list.filter((g) => (g.deadline || "").slice(0, 7) === month);
  if (filter === "curated") list = list.filter((g) => g.source === "curated");
  else if (filter === "federal") list = list.filter((g) => g.source === "Grants.gov");
  else if (filter === "soon") list = list.filter((g) => { const d = daysUntil(g.deadline); return d != null && d >= 0 && d <= 120; });
  else if (filter === "high") list = list.filter((g) => /high/i.test(g.fit || ""));
  else if (filter === "big") list = list.filter((g) => (g.amount_max || 0) >= 100000);
  if (query) {
    const q = query.toLowerCase();
    list = list.filter((g) => `${g.name} ${g.funder} ${g.summary} ${g.fit}`.toLowerCase().includes(q));
  }
  return list;
}

function byDeadline(a, b) { return (a.deadline || "9999") < (b.deadline || "9999") ? -1 : 1; }

// KPI / chart clicks filter the overview mini-table in place (stay on Overview).
function kpiActivate(e) {
  const el = e.target.closest(".kpi.click");
  if (!el) return;
  if (el.dataset.tab === "funders") { switchTab("funders"); return; }
  ovMonth = null;
  ovFilter = el.dataset.filter || "all";
  renderMini();
  $("#miniBody").closest(".panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderOvActiveBar() {
  const bar = $("#ovActiveBar");
  let label = null;
  if (ovMonth) { const [y, m] = ovMonth.split("-"); label = `Deadlines in ${MONTHS[+m - 1]} ${y}`; }
  else if (ovFilter !== "all") label = FILTER_LABEL[ovFilter] || ovFilter;
  if (!label) { bar.innerHTML = ""; return; }
  bar.innerHTML = `<div class="monthbar"><span class="pill">${esc(label)} <button type="button" id="ovClear" aria-label="Clear filter">&times;</button></span></div>`;
  $("#ovClear").addEventListener("click", () => { ovFilter = "all"; ovMonth = null; renderMini(); });
}

function renderMini() {
  renderOvActiveBar();
  $("#miniTitle").textContent = ovMonth
    ? "Filtered opportunities"
    : (FILTER_LABEL[ovFilter] || "Opportunities");
  const list = matchOpps({ filter: ovFilter, month: ovMonth }).sort(byDeadline).slice(0, 8);
  const body = $("#miniBody");
  if (!list.length) { body.innerHTML = '<tr><td colspan="4"><div class="empty">No opportunities match.</div></td></tr>'; return; }
  body.innerHTML = list.map((g) => {
    const c = countdown(g.deadline);
    return `<tr class="rowlink" data-id="${esc(g.id)}" tabindex="0">
      <td><div class="nm">${esc(g.name)}</div><div class="fn">${esc(g.funder)}</div></td>
      <td class="hide-sm">${sourceBadge(g.source)}</td>
      <td class="deadline">${fmtDate(g.deadline)}</td>
      <td><span class="count badge ${c.cls}">${esc(c.txt)}</span></td>
    </tr>`;
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
      onClick: (e, els) => { if (els.length) { ovMonth = monthKeys[els[0].index]; ovFilter = "all"; renderMini(); $("#miniBody").closest(".panel").scrollIntoView({ behavior: "smooth", block: "nearest" }); } },
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
        if (i === 2) { switchTab("funders"); return; }
        ovMonth = null;
        ovFilter = i === 0 ? "curated" : "federal";
        renderMini();
        $("#miniBody").closest(".panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  let list = matchOpps({ filter: oppFilter, month: oppMonth, query: oppQuery });
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
    return `<tr class="rowlink" data-id="${esc(g.id)}" tabindex="0">
      <td class="cell-name">
        <b>${esc(g.name)}</b>
        <div class="funder">${esc(g.funder)}</div>
        <div class="fit">${esc(g.fit || "")}</div>
      </td>
      <td class="hide-sm">${sourceBadge(g.source)}</td>
      <td class="hide-sm amount">${esc(g.amount || "—")}</td>
      <td class="deadline">${fmtDate(g.deadline)}</td>
      <td><span class="count badge ${c.cls}">${esc(c.txt)}</span></td>
      <td class="links"><a class="primary" href="${esc(safeUrl(g.url))}" target="_blank" rel="noopener noreferrer">Apply ↗</a><button class="detail-btn" type="button" data-id="${esc(g.id)}">Details</button></td>
    </tr>`;
  }).join("");
}

/* ---------- funders table + map ---------- */
function filteredFunders() {
  let list = [...DATA.prospects];
  if (funderCat !== "all") list = list.filter((p) => (p.matched_on || "") === funderCat);
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
      <td class="hide-sm funder">${esc(p.address || p.location || "—")}</td>
      <td class="hide-sm funder">${esc(p.matched_on || "—")}</td>
      <td class="links"><a class="primary" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">990 profile ↗</a></td>
    </tr>`).join("");
}

const CAT_COLOR = {
  "community foundation": "#2f6b5e", "housing foundation": "#8a5a16",
  "charitable trust": "#2d5b86",
};
const CAT_LABEL = {
  all: "All", "community foundation": "Community foundations",
  "housing foundation": "Housing foundations", "charitable trust": "Charitable trusts",
};
// Esri World Imagery — satellite basemap, no API key required (attribution req'd).
const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTR = "Imagery &copy; Esri, Maxar, Earthstar Geographics &amp; the GIS User Community";
let funderMapObj = null;        // the Leaflet map instance
let funderLayer = null;         // layer group holding the current markers

function ensureFunderMap() {
  if (funderMapObj || !window.L || !$("#funderMap")) return funderMapObj;
  funderMapObj = L.map("funderMap", {
    center: [44.9, -122.0], zoom: 7, minZoom: 5, maxZoom: 18,
    scrollWheelZoom: true, worldCopyJump: false,
  });
  L.tileLayer(ESRI_IMAGERY, { attribution: ESRI_ATTR, maxZoom: 18, maxNativeZoom: 19 }).addTo(funderMapObj);
  funderLayer = L.layerGroup().addTo(funderMapObj);
  return funderMapObj;
}

function renderFunderMap() {
  if (!ensureFunderMap()) return;
  funderLayer.clearLayers();
  const list = filteredFunders().filter((p) => p.lat != null && p.lng != null);
  const pts = [];
  list.forEach((p) => {
    const color = CAT_COLOR[p.matched_on] || "#2f6b5e";
    const m = L.circleMarker([p.lat, p.lng], {
      radius: 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95,
    });
    const profile = (p.url && safeUrl(p.url) !== "#")
      ? `<a class="m-btn primary" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer">Open 990 profile &#8599;</a>` : "";
    const addr = p.address
      ? `<div class="fp-loc">&#127968; ${esc(p.address)}</div>` : "";
    m.bindPopup(
      `<div class="fp-cat">${esc(CAT_LABEL[p.matched_on] || p.matched_on || "Local funder")}</div>
       <h4>${esc(p.name)}</h4>
       ${addr}
       <div class="fp-loc">&#128205; ${esc(p.location || "")}${p.ein ? " &middot; EIN " + esc(p.ein) : ""}</div>
       <p class="fp-sum">${esc(p.summary || "")}</p>${profile}`,
      // autoPan + padding so a popup near the top/edge is never clipped by the
      // map frame; maxHeight gives the popup its own scroll if content is long.
      { maxWidth: 260, maxHeight: 300, autoPan: true, keepInView: true,
        autoPanPaddingTopLeft: [24, 56], autoPanPaddingBottomRight: [24, 24] });
    m.bindTooltip(esc(p.name));
    m.addTo(funderLayer);
    pts.push([p.lat, p.lng]);
  });
  if (pts.length) funderMapObj.fitBounds(pts, { padding: [40, 40], maxZoom: 11 });

  const total = DATA.prospects.filter((p) => p.lat != null).length;
  $("#mapNote").textContent =
    `Showing ${list.length} mapped funder${list.length === 1 ? "" : "s"}` +
    (funderCat === "all" ? ` of ${total} with known locations.` : ` in "${CAT_LABEL[funderCat]}".`) +
    " Scroll or use +/− to zoom into the satellite imagery, drag to pan, and click a marker for details.";
}

function buildFunderCatFilters() {
  const cats = ["all", "community foundation", "housing foundation", "charitable trust"];
  $("#funderCatFilters").innerHTML = cats.map((c) => {
    const dot = c === "all" ? "" : `<i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${CAT_COLOR[c]};margin-right:6px;vertical-align:middle"></i>`;
    return `<button class="chip ${c === funderCat ? "active" : ""}" data-c="${esc(c)}">${dot}${esc(CAT_LABEL[c])}</button>`;
  }).join("");
  $("#funderCatFilters").querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => { funderCat = b.dataset.c; buildFunderCatFilters(); renderFunderMap(); renderFunders(); }));
}

/* ---------- PNW news ---------- */
function filteredNews() {
  let list = [...(DATA.news || [])];
  if (newsTopic !== "all") list = list.filter((n) => n.topic === newsTopic);
  if (newsQuery) {
    const q = newsQuery.toLowerCase();
    list = list.filter((n) => `${n.title} ${n.source}`.toLowerCase().includes(q));
  }
  return list;
}

function buildNewsFilters() {
  const topics = ["all", "Housing", "Funding", "Policy", "Government"];
  $("#newsFilters").innerHTML = topics.map((t) =>
    `<button class="chip ${t === newsTopic ? "active" : ""}" data-t="${esc(t)}">${t === "all" ? "All topics" : esc(t)}</button>`).join("");
  $("#newsFilters").querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => { newsTopic = b.dataset.t; buildNewsFilters(); renderNews(); }));
}

function renderNews() {
  const grid = $("#newsGrid");
  if (!grid) return;
  const list = filteredNews();
  if (!list.length) {
    grid.innerHTML = '<div class="empty">No matching news. The weekly build scans Pacific-Northwest housing &amp; funding headlines.</div>';
    return;
  }
  grid.innerHTML = list.map((n) => `
    <div class="news-card" role="button" tabindex="0" data-news-id="${esc(n.id)}">
      <span class="news-topic nt-${esc(n.topic)}">${esc(n.topic)}</span>
      <div class="nt">${esc(n.title)}</div>
      <div class="nm"><span>${esc(n.source || "")}</span><span>${n.date ? fmtDate(n.date) : ""}</span></div>
    </div>`).join("");
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
  if (name === "funders" && funderMapObj) {
    // Leaflet must recalc size now that the (previously display:none) map is visible.
    setTimeout(() => { funderMapObj.invalidateSize(); renderFunderMap(); }, 60);
  }
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
  renderKpis(); renderMini(); renderCharts();
  renderOpps(); renderFunders(); renderFunderMap(); renderNews(); renderMeta();
  if (modalGrant) { const g = DATA.grants.find((x) => x.id === modalGrant.id); if (g) fillModal(g); }
}

/* ---------- opportunity detail modal + Word export ---------- */
function pgApplication(g) {
  if (g.pg_application) return g.pg_application;
  return "As an Oregon-based 501(c)(3) Community Land Trust, Proud Ground may be a strong fit for this funder's affordable-housing and community-development priorities. Confirm eligibility, then frame the request around a current Proud Ground need such as land acquisition, homebuyer support, or organizational capacity.";
}

function fillModal(g) {
  modalGrant = g;
  const c = countdown(g.deadline);
  const needed = (g.needed || []).map((n) => `<li>${esc(n)}</li>`).join("");
  const wordBtn = g.source === "curated"
    ? `<a class="m-btn accent" href="grant-summaries/${esc(encodeURIComponent(g.id))}.docx" download>&#128196; Download Word summary</a>`
    : `<button class="m-btn accent" type="button" id="wordGen">&#128196; Download Word summary</button>`;
  $("#modalContent").innerHTML = `
    <div class="badges">${sourceBadge(g.source)} <span class="badge ${c.cls}">${esc(g.status || c.txt)}</span></div>
    <h2 id="modalTitle">${esc(g.name)}</h2>
    <div class="m-funder">${esc(g.funder)}</div>
    <dl class="m-facts">
      <dt>Due date</dt><dd>${fmtDate(g.deadline)} &middot; ${esc(c.txt)}</dd>
      <dt>Award</dt><dd>${esc(g.amount || "See funder page")}</dd>
      <dt>Eligible uses</dt><dd>${esc(g.use || "See funder page")}</dd>
      <dt>Eligibility</dt><dd>${esc(g.eligibility || "See funder page")}</dd>
    </dl>
    <h3>Summary</h3>
    <p class="m-body">${esc(g.summary || "")}</p>
    <h3>How this applies to Proud Ground</h3>
    <div class="m-pg">${esc(pgApplication(g))}</div>
    ${needed ? `<h3>What you'll need</h3><ul class="m-body">${needed}</ul>` : ""}
    <div class="m-actions">
      <a class="m-btn primary" href="${esc(safeUrl(g.url))}" target="_blank" rel="noopener noreferrer">Visit funder site &#8599;</a>
      ${wordBtn}
    </div>`;
  const wg = $("#wordGen");
  if (wg) wg.addEventListener("click", () => downloadWord(g));
}

function showModal() {
  $("#modalOverlay").hidden = false;
  $("#grantModal").classList.add("open");
  $("#grantModal").setAttribute("aria-hidden", "false");
  document.addEventListener("keydown", modalEsc);
}

function openModal(id) {
  const g = DATA.grants.find((x) => x.id === id);
  if (!g) return;
  fillModal(g);
  showModal();
}

// Two-sentence brief generated from the headline + topic. The full article text
// can't be fetched (Google News links don't resolve to the publisher and there's
// no key), so this is an honest relevance brief, not a scrape of the article body.
const NEWS_RELEVANCE_NOTE = {
  Housing: "It covers a Pacific-Northwest housing or affordability development. Worth a scan for sites, partners, or market signals that affect permanently affordable homeownership.",
  Funding: "It involves grants, capital, or investment in regional housing. Open it to check whether a funder, program, or deadline could fit Proud Ground.",
  Policy: "It concerns housing legislation or policy in Oregon/Washington. Policy shifts can change what a community land trust is able to build or fund.",
  Government: "It involves a government housing program or agency action. It may surface public funding or rule changes relevant to a community land trust.",
};
function newsBrief(n) {
  const s1 = `${n.source ? n.source + " reports" : "This story"}: “${n.title}”${n.date ? " (" + fmtDate(n.date) + ")" : ""}.`;
  const s2 = NEWS_RELEVANCE_NOTE[n.topic] || "Surfaced for its relevance to affordable housing and community land trusts in the Pacific Northwest.";
  return [s1, s2];
}

function openNewsModal(id) {
  const n = (DATA.news || []).find((x) => x.id === id);
  if (!n) return;
  const [s1, s2] = newsBrief(n);
  $("#modalContent").innerHTML = `
    <div class="badges"><span class="news-topic nt-${esc(n.topic)}">${esc(n.topic)}</span></div>
    <h2 id="modalTitle">${esc(n.title)}</h2>
    <div class="m-funder">${esc(n.source || "")}${n.date ? " &middot; " + fmtDate(n.date) : ""}</div>
    <h3>In brief</h3>
    <p class="m-body">${esc(s1)}</p>
    <p class="m-body">${esc(s2)}</p>
    <p class="m-body" style="font-size:.78rem;color:var(--ink-mute)">Auto-generated relevance note from the headline &mdash; read the full article for the complete story.</p>
    <div class="m-actions">
      <a class="m-btn primary" href="${esc(safeUrl(n.url))}" target="_blank" rel="noopener noreferrer">Read full article &#8599;</a>
    </div>`;
  showModal();
}
function closeModal() {
  modalGrant = null;
  $("#grantModal").classList.remove("open");
  $("#grantModal").setAttribute("aria-hidden", "true");
  $("#modalOverlay").hidden = true;
  document.removeEventListener("keydown", modalEsc);
}
function modalEsc(e) { if (e.key === "Escape") closeModal(); }

// Auto-generate a Word document from the CURRENT data (federal/auto entries).
// Because it builds from live data every time, it always reflects the latest
// refresh; curated entries instead link to their pre-built .docx.
function downloadWord(g) {
  const c = countdown(g.deadline);
  const row = (k, v) => `<tr><td style="background:#eef3f1;font-weight:bold;color:#1d4940;padding:6px 10px;border:1px solid #ddd">${esc(k)}</td><td style="padding:6px 10px;border:1px solid #ddd">${esc(v)}</td></tr>`;
  const needed = (g.needed || []).map((n) => `<li>${esc(n)}</li>`).join("");
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><title>${esc(g.name)}</title></head>
    <body style="font-family:Arial,sans-serif;color:#1f2d2b;font-size:11pt">
      <p style="font-size:8pt;letter-spacing:1px;color:#46605c"><b>PROUD GROUND &bull; GRANT OPPORTUNITY SUMMARY</b></p>
      <h1 style="color:#1d4940;font-size:17pt;margin:0">${esc(g.name)}</h1>
      <p style="color:#46605c;font-weight:bold;margin:2px 0 14px">${esc(g.funder)}</p>
      <h2 style="color:#c8732f;font-size:12pt">Key Facts</h2>
      <table style="border-collapse:collapse;width:100%">
        ${row("Deadline", fmtDate(g.deadline) + " (" + c.txt + ")")}
        ${row("Status", g.status || "")}
        ${row("Award amount", g.amount || "See funder page")}
        ${row("Eligible uses", g.use || "See funder page")}
        ${row("Eligibility", g.eligibility || "See funder page")}
      </table>
      <h2 style="color:#c8732f;font-size:12pt">Summary</h2>
      <p>${esc(g.summary || "")}</p>
      <h2 style="color:#c8732f;font-size:12pt">How This Applies to Proud Ground</h2>
      <p>${esc(pgApplication(g))}</p>
      ${needed ? `<h2 style="color:#c8732f;font-size:12pt">What You'll Need</h2><ul>${needed}</ul>` : ""}
      <h2 style="color:#c8732f;font-size:12pt">Where to Apply</h2>
      <p>${esc(safeUrl(g.url))}</p>
      <hr><p style="font-size:8pt;color:#46605c"><i>Auto-generated ${esc(new Date().toLocaleDateString())} from live data for Proud Ground (EIN 93-1290320), a 501(c)(3) Community Land Trust. Research aid only &mdash; confirm all details on the funder's official page before applying.</i></p>
    </body></html>`;
  const blob = new Blob(["﻿", html], { type: "application/msword" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${g.id}.doc`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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

// Row / Details clicks open the detail modal (Apply link keeps its own action).
function rowOpen(e) {
  if (e.target.closest("a")) return;            // let "Apply" links work
  const el = e.target.closest("[data-id]");
  if (el) openModal(el.dataset.id);
}
$("#oppBody").addEventListener("click", rowOpen);
$("#miniBody").addEventListener("click", rowOpen);
$("#oppBody").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("rowlink")) { e.preventDefault(); openModal(e.target.dataset.id); } });
$("#miniBody").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("rowlink")) { e.preventDefault(); openModal(e.target.dataset.id); } });
$("#modalClose").addEventListener("click", closeModal);
$("#modalOverlay").addEventListener("click", closeModal);
$("#miniViewAll").addEventListener("click", () => {
  oppFilter = ovFilter; oppMonth = ovMonth; oppQuery = ""; $("#oppSearch").value = "";
  buildOppFilters(); renderOpps(); switchTab("opps");
});
$("#newsSearch").addEventListener("input", (e) => { newsQuery = e.target.value; renderNews(); });
function newsOpen(e) { const el = e.target.closest("[data-news-id]"); if (el) openNewsModal(el.dataset.newsId); }
$("#newsGrid").addEventListener("click", newsOpen);
$("#newsGrid").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("news-card")) { e.preventDefault(); openNewsModal(e.target.dataset.newsId); } });

buildOppFilters();
buildFunderCatFilters();
buildNewsFilters();
wireSort("#oppTable", oppSort, renderOpps);
wireSort("#funderTable", funderSort, renderFunders);

load(false);
setInterval(() => load(true), REFRESH_MS);      // auto-refresh data
setInterval(() => { if (DATA.generated_at) $("#updatedLabel").textContent = "Updated " + relTime(DATA.generated_at); }, 60000);
