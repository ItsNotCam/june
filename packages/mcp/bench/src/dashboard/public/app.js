// author: Claude
// Vanilla dashboard logic. Talks to the Bun.serve API in ../server.ts.
//
// Invariants enforced here (from the RSI-readiness contract):
//  - control & iterate are NEVER drawn on the same trend line (mode filter).
//  - metrics are only compared within one fixture_hash (fixture filter).
//  - a cross-judge mismatch (run judged by a different model/prompt) is flagged.
//  - holdout runs lead with retrieval metrics; reader correctness is caveated.

const TIERS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7"];
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
  active: null, // { run_id, kind, stages: [{num,name}], stageState: {} }
};

const $ = (id) => document.getElementById(id);
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
    box.innerHTML = '<span class="muted">per-tier reader-correct %, with golden baselines (dashed). Legend-click to hide a tier.</span>';
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
          ticks: { color: "#8b94a7", callback: (v) => `${Math.round(v * 100)}%` },
          grid: { color: "#232a3a" },
        },
        x: { ticks: { color: "#8b94a7", maxRotation: 0, autoSkip: true }, grid: { color: "#1a2030" } },
      },
      plugins: {
        legend: { labels: { color: "#e6e9ef", boxWidth: 12 } },
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
    tr.onclick = () => openDetail(r.run_id);
    tbody.appendChild(tr);
  }
}

function renderAll() {
  renderSeriesToggle();
  renderChart();
  renderGate();
  renderRunsTable();
}

// ---- detail drawer -------------------------------------------------------
function metricCell(m) {
  if (!m) return "—";
  return `${pct(m.point)} <span class="ci">${pct(m.ci_low)}–${pct(m.ci_high)}</span>`;
}

async function openDetail(runId) {
  $("drawer").hidden = false;
  $("drawer-scrim").hidden = false;
  $("drawer-title").textContent = runId;
  $("drawer-body").innerHTML = '<p class="empty">Loading…</p>';
  try {
    const detail = await fetchJson(`/api/runs/${runId}`);
    $("drawer-body").innerHTML = detail.kind === "holdout" ? renderHoldoutDetail(detail) : renderSyntheticDetail(detail);
  } catch (e) {
    $("drawer-body").innerHTML = `<p class="empty">Failed to load: ${escapeHtml(e.message)}</p>`;
  }
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
    .join("");
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
    <h3>Per-tier (point · 95% CI)</h3>
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
    ${detail.summary_md ? `<h3>summary.md</h3><pre class="summary">${escapeHtml(detail.summary_md)}</pre>` : ""}`;
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
    ${detail.summary_md ? `<h3>holdout_summary.md</h3><pre class="summary">${escapeHtml(detail.summary_md)}</pre>` : ""}`;
}

function closeDrawer() {
  $("drawer").hidden = true;
  $("drawer-scrim").hidden = true;
}

// ---- in-flight (SSE) -----------------------------------------------------
function setStatus(stateName, label) {
  const el = $("live-status");
  el.dataset.state = stateName;
  el.querySelector(".label").textContent = label;
}

function renderStages() {
  const list = $("stage-list");
  if (!state.active) return;
  list.innerHTML = "";
  for (const s of state.active.stages) {
    const st = state.active.stageState[s.num] || {};
    const li = document.createElement("li");
    li.className = "stage" + (st.done ? " done" : st.active ? " active" : "");
    const sub = st.total ? `${st.done_count || 0}/${st.total}` : st.done ? "done" : st.active ? "running…" : "";
    li.innerHTML = `<span class="ix">${st.done ? "✓" : s.num}</span><span class="name">${escapeHtml(s.name)}</span><span class="sub">${sub}</span>`;
    list.appendChild(li);
  }
}

function showInflight(runId, kind, stages) {
  state.active = { run_id: runId, kind, stages: stages || [], stageState: {} };
  $("inflight").hidden = false;
  $("inflight-meta").textContent = `${runId} · ${kind}`;
  setStatus("running", `running ${runId}`);
  renderStages();
}

function hideInflight() {
  state.active = null;
  $("inflight").hidden = true;
  setStatus("live", "live · idle");
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
      $("inflight-meta").textContent = `${ev.run_id} · ${ev.fixture_id || ""}`;
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

// ---- wire up -------------------------------------------------------------
function init() {
  if (window.Chart && window["chartjs-plugin-annotation"]) {
    Chart.register(window["chartjs-plugin-annotation"]);
  }
  $("fixture-select").onchange = (e) => { state.fixture = e.target.value; renderAll(); };
  $("mode-select").onchange = (e) => { state.mode = e.target.value; renderChart(); renderRunsTable(); };
  $("view-select").onchange = (e) => { state.view = e.target.value; renderSeriesToggle(); renderChart(); };
  $("drawer-close").onclick = closeDrawer;
  $("drawer-scrim").onclick = closeDrawer;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  loadAll().catch((e) => setStatus("error", `load failed: ${e.message}`));
  connectStream();
}

document.addEventListener("DOMContentLoaded", init);
