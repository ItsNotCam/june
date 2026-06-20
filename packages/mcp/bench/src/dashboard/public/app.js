// author: Claude
// Vanilla dashboard logic. Talks to the Bun.serve API in ../server.ts.
//
// Invariants enforced here (from the RSI-readiness contract):
//  - control & iterate are NEVER drawn on the same trend line (mode filter).
//  - metrics are only compared within one fixture_hash (fixture filter).
//  - a cross-judge mismatch (run judged by a different model/prompt) is flagged.
//  - holdout runs lead with retrieval metrics; reader correctness is caveated.

const TIERS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7"];
// Plain-English query tiers (source of truth: src/types/query.ts).
const TIER_INFO = {
  T1: "lexical — query words overlap the source sentence",
  T2: "paraphrase — same fact, different words",
  T3: "conceptual — scenario framing; the fact must be inferred",
  T4: "2-hop — two facts chained (both must be retrieved)",
  T5: "negative — no answer exists; refusing is correct",
  T6: "3-hop — three facts chained (all required)",
  T7: "4-hop — four facts chained (all required)",
};
function tierGlossaryHtml() {
  const rows = TIERS.map((t) => `<dt>${t}</dt><dd>${TIER_INFO[t]}</dd>`).join("");
  return `<details class="glossary"><summary>What do T1–T7 mean?</summary><dl class="kv">${rows}</dl></details>`;
}
// Plain-English metric definitions.
const METRIC_INFO = {
  "correct %": "share of answers the judge graded CORRECT (for negative T5 queries, refusing counts as correct).",
  "recall@k": "share of queries where a correct chunk landed in the top-k retrieved results. recall@5 = in the top 5 — higher means retrieval surfaced the answer.",
  "MRR": "mean reciprocal rank — averages 1 ÷ (rank of the first correct chunk). 1.0 = always ranked #1, 0.5 = typically #2, lower = buried deeper.",
};
function metricGlossaryHtml() {
  const rows = Object.entries(METRIC_INFO).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  return `<details class="glossary"><summary>What do the metrics mean?</summary><dl class="kv wide">${rows}</dl></details>`;
}
const METRIC_COLORS = {
  reader_correct_pct: "#5eead4",
  recall_at_5: "#60a5fa",
  mrr: "#c084fc",
};
const METRIC_LABELS = {
  reader_correct_pct: "correct %",
  recall_at_5: "recall@5",
  mrr: "MRR",
};
const TIER_COLORS = ["#5eead4", "#60a5fa", "#c084fc", "#fbbf24", "#f472b6", "#34d399", "#fb923c"];

const state = {
  runs: [],
  golden: {},
  fixture: null, // selected fixture_hash
  mode: "control",
  view: "overall",
  series: { reader_correct_pct: true, recall_at_5: true, mrr: true },
  chart: null,
  tierChart: null, // per-tier bar chart inside the detail pane
  tierData: null, // last per-tier payload, kept so charts can re-color on theme switch
  selected: null, // run_id shown in the persistent detail pane
  active: null, // { run_id, kind, stages: [{num,name}], stageState: {} }
  logRunId: null, // run_id whose run.log the live-log card is polling
  logTimer: null, // setInterval handle for the 5s log poll
  logFollow: true, // auto-scroll the log to the newest line
};

const $ = (id) => document.getElementById(id);
// Chart.js can't read CSS variables, so pull the live theme palette off :root.
// Re-read on every render so a theme switch repaints axes/legend correctly.
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const chartColors = () => ({
  tick: cssVar("--muted"),
  grid: cssVar("--border"),
  gridSoft: cssVar("--surface-2"),
  legend: cssVar("--fg"),
});
const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const shortHash = (h) => (h ? h.slice(0, 8) : "—");
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtWhen = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

// ---- data fetching -------------------------------------------------------
async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function loadAll() {
  const [runs, golden] = await Promise.all([fetchJson("/api/runs"), fetchJson("/api/golden")]);
  state.runs = runs;
  state.golden = golden;
  if (!state.fixture || !runs.some((r) => r.fixture_hash === state.fixture)) {
    // default to the fixture of the most recent run (runs are newest-first)
    const newest = runs.find((r) => r.fixture_hash);
    state.fixture = newest ? newest.fixture_hash : null;
  }
  renderFixtureSelect();
  renderAll();
}

// ---- derived selections --------------------------------------------------
function fixtureRuns() {
  return state.runs.filter((r) => r.fixture_hash === state.fixture);
}
function trendRuns() {
  // chronological (oldest→newest), completed only, mode-filtered, this fixture
  return fixtureRuns()
    .filter((r) => r.status === "completed" || r.status === "awaiting_verdicts")
    .filter((r) => (state.mode === "all" ? true : r.mode === state.mode))
    .slice()
    .reverse();
}

// ---- rendering: controls -------------------------------------------------
function renderFixtureSelect() {
  const sel = $("fixture-select");
  const byHash = new Map();
  for (const r of state.runs) {
    if (!r.fixture_hash) continue;
    if (!byHash.has(r.fixture_hash)) byHash.set(r.fixture_hash, { id: r.fixture_id, n: 0 });
    byHash.get(r.fixture_hash).n++;
  }
  sel.innerHTML = "";
  for (const [hash, info] of byHash) {
    const opt = document.createElement("option");
    opt.value = hash;
    opt.textContent = `${shortHash(hash)} · ${info.n} run${info.n === 1 ? "" : "s"}`;
    if (hash === state.fixture) opt.selected = true;
    sel.appendChild(opt);
  }
  if (byHash.size === 0) {
    const opt = document.createElement("option");
    opt.textContent = "no runs";
    sel.appendChild(opt);
  }
}

function renderSeriesToggle() {
  const box = $("series-toggle");
  if (state.view !== "overall") {
    box.innerHTML =
      '<span class="muted">per-tier reader-correct %, with golden baselines (dashed). Legend-click to hide a tier.</span>' +
      tierGlossaryHtml() +
      metricGlossaryHtml();
    return;
  }
  box.innerHTML = "";
  for (const key of Object.keys(METRIC_LABELS)) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.setAttribute("aria-pressed", String(state.series[key]));
    chip.innerHTML = `<span class="swatch" style="background:${METRIC_COLORS[key]}"></span>${METRIC_LABELS[key]}`;
    chip.onclick = () => {
      state.series[key] = !state.series[key];
      chip.setAttribute("aria-pressed", String(state.series[key]));
      renderChart();
    };
    box.appendChild(chip);
  }
  box.insertAdjacentHTML("beforeend", metricGlossaryHtml());
}

// ---- rendering: chart ----------------------------------------------------
function buildOverallDatasets(runs, labels) {
  const ds = [];
  for (const key of Object.keys(METRIC_LABELS)) {
    if (!state.series[key]) continue;
    ds.push({
      label: METRIC_LABELS[key],
      data: runs.map((r) => (r.overall[key] ? r.overall[key].point : null)),
      borderColor: METRIC_COLORS[key],
      backgroundColor: METRIC_COLORS[key],
      tension: 0.25,
      spanGaps: true,
      pointRadius: 3,
      // stash CI for the tooltip
      _ci: runs.map((r) => r.overall[key]),
    });
  }
  return { datasets: ds, annotations: {} };
}

function buildPerTierDatasets(runs) {
  const golden = state.golden[state.fixture];
  const datasets = [];
  const annotations = {};
  TIERS.forEach((tier, i) => {
    const data = runs.map((r) => (tier in r.per_tier_correct ? r.per_tier_correct[tier] : null));
    if (data.every((v) => v == null)) return;
    const color = TIER_COLORS[i % TIER_COLORS.length];
    datasets.push({
      label: tier,
      data,
      borderColor: color,
      backgroundColor: color,
      tension: 0.2,
      spanGaps: true,
      pointRadius: 2,
    });
    // golden baseline for this tier (dashed) when present
    if (golden && tier in golden.per_tier_correct) {
      annotations[`g_${tier}`] = {
        type: "line",
        yMin: golden.per_tier_correct[tier],
        yMax: golden.per_tier_correct[tier],
        borderColor: color,
        borderWidth: 1,
        borderDash: [4, 4],
        label: { display: false },
      };
    }
  });
  return { datasets, annotations };
}

function renderChart() {
  const runs = trendRuns();
  const labels = runs.map((r) => fmtWhen(r.completed_at || r.started_at));
  const { datasets, annotations } =
    state.view === "overall" ? buildOverallDatasets(runs, labels) : buildPerTierDatasets(runs);

  const c = chartColors();
  const cfg = {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          min: 0, max: 1,
          ticks: { color: c.tick, callback: (v) => `${Math.round(v * 100)}%` },
          grid: { color: c.grid },
        },
        x: { ticks: { color: c.tick, maxRotation: 0, autoSkip: true }, grid: { color: c.gridSoft } },
      },
      plugins: {
        legend: { labels: { color: c.legend, boxWidth: 12 } },
        annotation: { annotations },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const base = `${ctx.dataset.label}: ${pct(ctx.parsed.y)}`;
              const ci = ctx.dataset._ci && ctx.dataset._ci[ctx.dataIndex];
              return ci ? `${base}  (CI ${pct(ci.ci_low)}–${pct(ci.ci_high)})` : base;
            },
            afterTitle: (items) => {
              const r = runs[items[0].dataIndex];
              return r ? `${r.run_id} · ${r.mode || "?"}` : "";
            },
          },
        },
      },
    },
  };

  if (state.chart) {
    state.chart.config.type = cfg.type;
    state.chart.data = cfg.data;
    state.chart.options = cfg.options;
    state.chart.update();
  } else {
    state.chart = new Chart($("trend"), cfg);
  }

  const note = $("trend-note");
  if (runs.length === 0) note.textContent = "No matching runs for this fixture/mode.";
  else if (state.mode === "all")
    note.textContent = "⚠ showing all modes — iterate (flash) and control (gemma) fail on different queries; do not read across modes.";
  else note.textContent = `${runs.length} ${state.mode} run(s). Bench is a gauge, not a goal.`;
}

// ---- rendering: gate -----------------------------------------------------
function renderGate() {
  const body = $("gate-body");
  const meta = $("gate-meta");
  const golden = state.golden[state.fixture];
  if (!golden) {
    meta.textContent = "";
    body.innerHTML = '<p class="empty">No golden pinned for this fixture (or it is a legacy entry that needs re-pinning via <code>control-pin</code>).</p>';
    return;
  }
  meta.innerHTML = `noise floor ±${pct(golden.noise_floor)} · pinned ${escapeHtml(golden.run_id)} · schema v${golden.schema_version}` +
    (golden.judge ? ` · judge ${escapeHtml(golden.judge.model)}` : " · judge n/a (v1)");

  // latest control run for this fixture
  const latest = fixtureRuns().find((r) => r.mode === "control" && r.status === "completed");
  let rows = "";
  if (!latest) {
    rows = '<p class="empty">No completed control run yet to check against the baseline.</p>';
  } else {
    // cross-judge guard
    let judgeWarn = "";
    if (golden.judge && latest.judge && latest.judge.model !== golden.judge.model) {
      judgeWarn = `<div class="caveat">⚠ latest control run judged by <b>${escapeHtml(latest.judge.model)}</b> but golden pinned under <b>${escapeHtml(golden.judge.model)}</b> — gate comparison is not calibrated across judges.</div>`;
    }
    const tierRows = Object.keys(golden.per_tier_correct)
      .sort()
      .map((tier) => {
        const base = golden.per_tier_correct[tier];
        const actual = latest.per_tier_correct[tier];
        if (actual == null) return "";
        const pass = actual >= base - golden.noise_floor;
        const width = Math.max(0, Math.min(100, actual * 100));
        return `<div class="gate-row">
          <span class="pill ${pass ? "pass" : "fail"}">${pass ? "PASS" : "FAIL"}</span>
          <b style="width:28px">${tier}</b>
          <div class="bar"><span style="width:${width}%;background:${pass ? "var(--green)" : "var(--red)"}"></span></div>
          <span class="num" style="width:150px">${pct(actual)} <span class="ci">vs ${pct(base)}</span></span>
        </div>`;
      })
      .join("");
    rows = judgeWarn + `<p class="muted" style="margin:0 0 8px">latest control run <code>${escapeHtml(latest.run_id)}</code> vs golden baseline (− noise floor)</p>` + tierRows;
  }

  // synthetic ↔ holdout divergence alarm
  const ctrlSynthetic = fixtureRuns().find((r) => r.kind === "synthetic" && r.mode === "control" && r.status === "completed");
  const holdout = state.runs.find((r) => r.kind === "holdout" && r.status === "completed");
  let diverge = "";
  if (ctrlSynthetic && holdout && ctrlSynthetic.overall.recall_at_5 && holdout.overall.recall_at_5) {
    const gap = ctrlSynthetic.overall.recall_at_5.point - holdout.overall.recall_at_5.point;
    if (Math.abs(gap) >= 0.15) {
      diverge = `<div class="caveat">⚠ synthetic↔holdout divergence: synthetic recall@5 ${pct(ctrlSynthetic.overall.recall_at_5.point)} vs holdout ${pct(holdout.overall.recall_at_5.point)} (Δ ${pct(Math.abs(gap))}) — possible overfitting to the toy domain.</div>`;
    }
  }
  body.innerHTML = rows + diverge;
}

// ---- rendering: runs table ----------------------------------------------
function renderRunsTable() {
  const rows = fixtureRuns();
  $("runs-meta").textContent = `${rows.length} run(s) · fixture ${shortHash(state.fixture)}`;
  const tbody = $("runs-body");
  tbody.innerHTML = "";
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty">No runs for this fixture.</td></tr>';
    return;
  }
  // distinct judges among control runs → cross-judge warning marker
  const controlJudges = new Set(rows.filter((r) => r.mode === "control" && r.judge).map((r) => r.judge.model));
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.dataset.runid = r.run_id;
    if (r.run_id === state.selected) tr.classList.add("selected");
    const judgeMismatch = r.mode === "control" && controlJudges.size > 1;
    tr.innerHTML = `
      <td>${escapeHtml(fmtWhen(r.completed_at || r.started_at))}</td>
      <td><span class="badge ${r.mode || "freeform"}">${escapeHtml(r.mode || "?")}</span></td>
      <td><span class="badge ${r.kind}">${r.kind}</span></td>
      <td class="mono">${escapeHtml(r.reader ? r.reader.model : "—")}</td>
      <td class="mono">${escapeHtml(r.judge ? r.judge.model : "—")}${judgeMismatch ? ' <span class="warn" title="control runs here use >1 judge — not comparable">⚠</span>' : ""}</td>
      <td class="num">${pct(r.overall.reader_correct_pct && r.overall.reader_correct_pct.point)}</td>
      <td class="num">${pct(r.overall.recall_at_5 && r.overall.recall_at_5.point)}</td>
      <td class="num">${r.overall.mrr ? r.overall.mrr.point.toFixed(3) : "—"}</td>
      <td><span class="badge ${r.status}">${escapeHtml(r.run_status || r.status)}</span></td>
      <td class="num">${r.cost_total != null ? "$" + r.cost_total.toFixed(2) : "—"}</td>`;
    tr.onclick = () => selectRun(r.run_id);
    tbody.appendChild(tr);
  }
}

function renderAll() {
  renderSeriesToggle();
  renderChart();
  renderGate();
  renderRunsTable();
  autoSelect();
}

// ---- detail pane (persistent right column) -------------------------------------------------------
function metricCell(m) {
  if (!m) return "—";
  return `${pct(m.point)} <span class="ci">${pct(m.ci_low)}–${pct(m.ci_high)}</span>`;
}

// Render trusted, locally-generated summary markdown (GFM tables). Falls back to
// escaped preformatted text if the CDN marked lib didn't load.
function renderMarkdown(md) {
  if (window.marked && typeof window.marked.parse === "function") {
    return `<div class="markdown">${window.marked.parse(md, { gfm: true })}</div>`;
  }
  return `<pre class="summary">${escapeHtml(md)}</pre>`;
}

async function selectRun(runId) {
  state.selected = runId;
  highlightSelectedRow();
  $("detail-title").textContent = runId;
  $("detail-sub").textContent = "";
  $("detail-body").innerHTML = '<p class="empty">Loading…</p>';
  if (state.tierChart) { state.tierChart.destroy(); state.tierChart = null; }
  state.tierData = null;
  try {
    const detail = await fetchJson(`/api/runs/${runId}`);
    if (state.selected !== runId) return; // a newer selection won the race
    $("detail-sub").textContent = detail.kind;
    $("detail-body").innerHTML = detail.kind === "holdout" ? renderHoldoutDetail(detail) : renderSyntheticDetail(detail);
    if (detail.kind === "synthetic") renderTierChart(detail.results.per_tier);
  } catch (e) {
    $("detail-body").innerHTML = `<p class="empty">Failed to load: ${escapeHtml(e.message)}</p>`;
  }
}

function highlightSelectedRow() {
  for (const tr of document.querySelectorAll("#runs-body tr")) {
    tr.classList.toggle("selected", tr.dataset.runid === state.selected);
  }
}

// Keep the persistent pane populated: keep the current selection if it's still in
// the active fixture, else default to the newest completed run (or the newest run).
function autoSelect() {
  const rows = fixtureRuns();
  if (state.selected && rows.some((r) => r.run_id === state.selected)) {
    highlightSelectedRow();
    return;
  }
  const def = rows.find((r) => r.status === "completed") || rows[0];
  if (def) {
    selectRun(def.run_id);
  } else {
    state.selected = null;
    $("detail-title").textContent = "Run detail";
    $("detail-sub").textContent = "";
    $("detail-body").innerHTML = '<p class="empty">No runs for this fixture.</p>';
  }
}

// Grouped bar chart of per-tier correct% + recall@5, drawn into the detail pane.
function renderTierChart(perTier) {
  const canvas = document.getElementById("tier-chart");
  if (!canvas || !perTier) return;
  state.tierData = perTier; // remembered so a theme switch can repaint this chart
  const tiers = Object.keys(perTier).sort();
  if (!tiers.length) return;
  const c = chartColors();
  const ds = (key, label, color) => ({
    label,
    backgroundColor: color,
    borderColor: color,
    data: tiers.map((t) => (perTier[t][key] ? perTier[t][key].point : null)),
  });
  state.tierChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: tiers,
      datasets: [
        ds("reader_correct_pct", "correct %", METRIC_COLORS.reader_correct_pct),
        ds("recall_at_5", "recall@5", METRIC_COLORS.recall_at_5),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { min: 0, max: 1, ticks: { color: c.tick, callback: (v) => `${Math.round(v * 100)}%` }, grid: { color: c.grid } },
        x: { ticks: { color: c.tick }, grid: { display: false } },
      },
      plugins: {
        legend: { labels: { color: c.legend, boxWidth: 12 } },
        annotation: { annotations: {} },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${pct(ctx.parsed.y)}` } },
      },
    },
  });
}

function renderSyntheticDetail(detail) {
  const r = detail.results;
  const m = r.manifest || {};
  const roles = m.roles || {};
  const tierRows = Object.keys(r.per_tier || {})
    .sort()
    .map((tier) => {
      const t = r.per_tier[tier];
      return `<tr><td><b>${tier}</b></td><td class="num">${t.query_count}</td>
        <td class="num">${metricCell(t.recall_at_1)}</td>
        <td class="num">${metricCell(t.recall_at_5)}</td>
        <td class="num">${metricCell(t.recall_at_10)}</td>
        <td class="num">${t.mrr ? t.mrr.point.toFixed(3) : "—"}</td>
        <td class="num">${metricCell(t.reader_correct_pct)}</td>
        <td class="num">${metricCell(t.reader_refused_pct)}</td></tr>`;
    })
    .join("") + `<tr><td colspan="8" style="border:0;padding-top:8px">${metricGlossaryHtml()}${tierGlossaryHtml()}</td></tr>`;
  const integ = r.integrity || {};
  return `
    <h3>Manifest</h3>
    <dl class="kv">
      <dt>status</dt><dd>${escapeHtml(r.run_status)}</dd>
      <dt>mode</dt><dd>${escapeHtml(m.mode || "—")}</dd>
      <dt>fixture</dt><dd class="mono">${escapeHtml(m.fixture_hash || "")}</dd>
      <dt>reader</dt><dd>${escapeHtml(roles.reader ? roles.reader.provider + " / " + roles.reader.model : "—")}</dd>
      <dt>judge</dt><dd>${escapeHtml(roles.judge ? roles.judge.provider + " / " + roles.judge.model : "—")}</dd>
      <dt>embedding</dt><dd>${escapeHtml(m.june ? m.june.embedding_model : "—")}</dd>
      <dt>cost</dt><dd>$${(r.cost_usd ? r.cost_usd.total : 0).toFixed(4)}</dd>
    </dl>
    <h3>Per-tier</h3>
    <div class="tier-chart-wrap"><canvas id="tier-chart"></canvas></div>
    <div class="table-wrap"><table>
      <thead><tr><th>tier</th><th class="num">n</th><th class="num">r@1</th><th class="num">r@5</th><th class="num">r@10</th><th class="num">mrr</th><th class="num">correct</th><th class="num">refused</th></tr></thead>
      <tbody>${tierRows}</tbody></table></div>
    <h3>Integrity</h3>
    <dl class="kv">
      <dt>unresolved</dt><dd>${pct(integ.unresolved_pct)}</dd>
      <dt>via embedding</dt><dd>${pct(integ.embedding_pct)}</dd>
      <dt>unjudged</dt><dd>${pct(integ.unjudged_pct)}</dd>
      <dt>leakage warns</dt><dd>${integ.queries_with_leakage_warning ?? 0}</dd>
    </dl>
    ${detail.summary_md ? `<h3>summary.md</h3>${renderMarkdown(detail.summary_md)}` : ""}`;
}

function renderHoldoutDetail(detail) {
  const r = detail.results;
  const m = r.manifest || {};
  const a = r.answerable || {};
  const u = r.unanswerable || {};
  return `
    <div class="caveat">Sealed real-doc holdout — <b>retrieval metrics lead</b>. Reader correctness is contaminated by the model's parametric memory of real docs; trust recall@k.</div>
    <h3>Manifest</h3>
    <dl class="kv">
      <dt>status</dt><dd>${escapeHtml(r.run_status)}</dd>
      <dt>mode</dt><dd>${escapeHtml(m.mode || "—")}</dd>
      <dt>source</dt><dd>${escapeHtml(m.source ? m.source.name + " (" + m.source.doc_count + " docs)" : "—")}</dd>
      <dt>reader</dt><dd>${escapeHtml(m.reader ? m.reader.provider + " / " + m.reader.model : "—")}</dd>
      <dt>judge</dt><dd>${escapeHtml(m.judge ? m.judge.provider + " / " + m.judge.model : "—")}</dd>
    </dl>
    <h3>Answerable — retrieval (point · CI)</h3>
    <dl class="kv">
      <dt>queries</dt><dd>${a.query_count ?? "—"}</dd>
      <dt>recall@1</dt><dd>${metricCell(a.recall_at_1)}</dd>
      <dt>recall@5</dt><dd>${metricCell(a.recall_at_5)}</dd>
      <dt>recall@10</dt><dd>${metricCell(a.recall_at_10)}</dd>
      <dt>mrr</dt><dd>${a.mrr ? a.mrr.point.toFixed(3) : "—"}</dd>
    </dl>
    <h3>Reader (caveated)</h3>
    <dl class="kv">
      <dt>RAG correct</dt><dd>${metricCell(r.reader_rag_correct_pct)}</dd>
      <dt>no-RAG correct</dt><dd>${metricCell(r.reader_norag_correct_pct)}</dd>
      <dt>unanswerable refused</dt><dd>${metricCell(u.reader_refused_pct)}</dd>
    </dl>
    ${detail.summary_md ? `<h3>holdout_summary.md</h3>${renderMarkdown(detail.summary_md)}` : ""}`;
}

// ---- live log tail (polled every 5s for the active run) ------------------
const LOG_POLL_MS = 5000;
// Colorize a run.log line by its level token (format: "ts | <emoji> level | msg").
function logLineClass(line) {
  const m = line.match(/\|\s*\S*\s*(debug|info|warn|error)\s*\|/);
  return m ? `log-${m[1]}` : "";
}
function renderLogLines(log) {
  const view = $("logview");
  if (!log.present) {
    view.innerHTML = '<span class="empty">waiting for run.log…</span>';
    return;
  }
  if (!log.lines.length) {
    view.innerHTML = '<span class="empty">run.log is empty so far…</span>';
    return;
  }
  const head = log.truncated ? '<span class="log-trunc">… earlier lines trimmed …</span>\n' : "";
  view.innerHTML =
    head + log.lines.map((l) => `<span class="${logLineClass(l)}">${escapeHtml(l)}</span>`).join("\n");
  if (state.logFollow) view.scrollTop = view.scrollHeight;
}

async function pollLog() {
  const runId = state.logRunId;
  if (!runId) return;
  try {
    const log = await fetchJson(`/api/runs/${runId}/log`);
    if (state.logRunId !== runId) return; // active run changed mid-fetch
    renderLogLines(log);
  } catch {
    /* a transient read error must not kill the poll loop */
  }
}

function startLogPolling(runId) {
  stopLogPolling();
  state.logRunId = runId;
  $("logcard").hidden = false;
  $("log-meta").textContent = `tailing ${runId} · every ${LOG_POLL_MS / 1000}s`;
  $("logview").innerHTML = '<span class="empty">waiting for run.log…</span>';
  void pollLog();
  state.logTimer = setInterval(() => void pollLog(), LOG_POLL_MS);
}

function stopLogPolling() {
  if (state.logTimer) clearInterval(state.logTimer);
  state.logTimer = null;
  state.logRunId = null;
  $("logcard").hidden = true;
}

// ---- in-flight (SSE) -----------------------------------------------------
function setStatus(stateName, label) {
  const el = $("live-status");
  el.dataset.state = stateName;
  el.querySelector(".label").textContent = label;
}

// Render the stage progress bar: one dot per stage, evenly spaced, with a fill
// that "jumps" to the dot of the stage currently running (or the furthest done
// stage when nothing is active). Lives under the "Live log" header.
function renderStages() {
  const wrap = $("stage-progress");
  const stages = state.active?.stages || [];
  if (!state.active || !stages.length) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  const ss = state.active.stageState;
  const n = stages.length;
  const posOf = (i) => (n === 1 ? 0 : (i / (n - 1)) * 100);

  // Marker = the active stage; else the furthest done stage (run just completed).
  let activeIx = -1, lastDone = -1;
  stages.forEach((s, i) => {
    const st = ss[s.num] || {};
    if (st.active) activeIx = i;
    if (st.done) lastDone = i;
  });
  const markerIx = activeIx >= 0 ? activeIx : lastDone;
  const fillPct = markerIx < 0 ? 0 : posOf(markerIx);

  const dots = stages
    .map((s, i) => {
      const st = ss[s.num] || {};
      const cls = st.done ? "done" : st.active ? "active" : "pending";
      return `<div class="stage-dot ${cls}" style="left:${posOf(i)}%">
        <span class="stage-tip">${s.num}. ${escapeHtml(s.name)}</span></div>`;
    })
    .join("");

  let caption = `${state.active.run_id}`;
  if (markerIx >= 0) {
    const cur = stages[markerIx];
    const st = ss[cur.num] || {};
    const count = st.total ? ` · ${st.done_count || 0}/${st.total}` : "";
    const verb = activeIx >= 0 ? "running" : st.done ? "complete" : "";
    caption = `stage ${cur.num}/${stages[n - 1].num} · ${escapeHtml(cur.name)}${count} · ${verb}`;
  }

  wrap.innerHTML = `
    <div class="stage-line">
      <div class="stage-rail"></div>
      <div class="stage-fill" style="width:${fillPct}%"></div>
      ${dots}
    </div>
    <div class="stage-caption">${escapeHtml(caption)}</div>`;
}

function showInflight(runId, kind, stages) {
  const initial = stages && stages.length ? stages : FALLBACK_STAGES;
  state.active = { run_id: runId, kind, stages: initial, stageState: {} };
  setStatus("running", `running ${runId}`);
  if (state.logRunId !== runId) startLogPolling(runId);
  renderStages();
}

function hideInflight() {
  state.active = null;
  setStatus("live", "live · idle");
  renderStages();
  stopLogPolling();
}

// Default 6-stage roster (used when artifacts-mode progress has no run_start).
const FALLBACK_STAGES = [
  { num: 4, name: "ingest" }, { num: 5, name: "ground-truth resolution" },
  { num: 6, name: "retrieval evaluation" }, { num: 7, name: "reader evaluation" },
  { num: 8, name: "judging" }, { num: 9, name: "scoring + report" },
];

function handleProgress(ev) {
  if (!state.active) showInflight(ev.run_id || "run", "synthetic", FALLBACK_STAGES);
  const ss = state.active.stageState;
  switch (ev.type) {
    case "run_start":
      state.active.stages = ev.stages && ev.stages.length ? ev.stages : FALLBACK_STAGES;
      state.active.run_id = ev.run_id;
      state.active.fixture_id = ev.fixture_id || null;
      break;
    case "stage_start":
      ss[ev.stage] = { active: true, total: ev.total, done_count: 0 };
      break;
    case "tick":
      ss[ev.stage] = { ...(ss[ev.stage] || {}), active: true, total: ev.total, done_count: ev.done };
      break;
    case "stage_end":
      ss[ev.stage] = { done: true };
      break;
    case "stage_inferred": // artifacts fallback: stages ≤ N done, N active
      if (!state.active.stages.length) state.active.stages = FALLBACK_STAGES;
      for (const s of state.active.stages) {
        if (s.num < ev.stage) ss[s.num] = { done: true };
        else if (s.num === ev.stage) ss[s.num] = { active: true };
      }
      break;
    case "run_complete":
      for (const s of state.active.stages) ss[s.num] = { done: true };
      break;
    case "run_error":
      setStatus("error", `error: ${ev.name || "run failed"}`);
      break;
  }
  renderStages();
}

function connectStream() {
  const es = new EventSource("/api/stream");
  es.addEventListener("hello", () => setStatus("live", "live · idle"));
  es.addEventListener("runs_changed", () => loadAll().catch(() => {}));
  es.addEventListener("active", (e) => {
    const d = JSON.parse(e.data);
    showInflight(d.run_id, d.kind, []);
  });
  es.addEventListener("idle", () => hideInflight());
  es.addEventListener("progress", (e) => handleProgress(JSON.parse(e.data)));
  es.onerror = () => setStatus("error", "stream disconnected — retrying…");
}

// ---- theme (light/dark) --------------------------------------------------
const THEME_KEY = "june-bench-theme";
function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  // Chart.js bakes colors in at build time, so repaint the live charts.
  if (state.chart) renderChart();
  if (state.tierChart && state.tierData) {
    state.tierChart.destroy();
    state.tierChart = null;
    renderTierChart(state.tierData);
  }
}
function toggleTheme() {
  applyTheme(currentTheme() === "light" ? "dark" : "light");
}

// ---- wire up -------------------------------------------------------------
function init() {
  if (window.Chart && window["chartjs-plugin-annotation"]) {
    Chart.register(window["chartjs-plugin-annotation"]);
  }
  $("fixture-select").onchange = (e) => { state.fixture = e.target.value; renderAll(); };
  $("mode-select").onchange = (e) => { state.mode = e.target.value; renderChart(); renderRunsTable(); };
  $("view-select").onchange = (e) => { state.view = e.target.value; renderSeriesToggle(); renderChart(); };
  $("log-follow").onchange = (e) => { state.logFollow = e.target.checked; if (state.logFollow) void pollLog(); };
  $("theme-toggle").onclick = toggleTheme;

  loadAll().catch((e) => setStatus("error", `load failed: ${e.message}`));
  connectStream();
}

document.addEventListener("DOMContentLoaded", init);
