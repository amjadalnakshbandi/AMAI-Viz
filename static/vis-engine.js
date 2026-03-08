/**
 * vis-engine.js — AMAI Dash Visualization Engine
 *
 * Lädt zwei Dateien parallel und rendert das Dashboard:
 *
 *   vis-logic.json  — Regeln (KPIs, Diagramme, Meta) — klein, versionierbar
 *   {
 *     "meta":      { "erstellt": "ISO-date", "zeilen": 1000 },
 *     "kpis":      [ { "titel", "feld", "berechnung", "einheit", "erklaerung" } ],
 *     "diagramme": [ { "titel", "typ", "x_feld|label_feld", "y_feld|wert_feld",
 *                      "aggregation", "erklaerung" } ]
 *   }
 *
 *   vis-data.json   — Rohdaten (nur Zeilen-Array) — kann sehr groß sein
 *   [ { "feld1": val, ... }, ... ]
 */

'use strict';

// ── Color palette ──────────────────────────────────────────────────
const VIS_PALETTE = [
  '#2563eb','#7c3aed','#059669','#d97706','#dc2626',
  '#0891b2','#ea580c','#4f46e5','#0d9488','#db2777',
];

// ── Chart.js defaults ──────────────────────────────────────────────
if (typeof Chart !== 'undefined') {
  Chart.defaults.color        = '#64748b';
  Chart.defaults.borderColor  = '#e2e8f0';
  Chart.defaults.font.family  = "'Segoe UI',system-ui,sans-serif";
  Chart.defaults.font.size    = 11;
  Chart.defaults.plugins.legend.labels.padding       = 14;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
}

// ── Math helpers ───────────────────────────────────────────────────

/**
 * aggregate(rows, groupField, valueField, agg)
 * Groups rows by groupField, aggregates valueField with agg.
 * Returns { labels: string[], data: number[] }
 */
function aggregate(rows, groupField, valueField, agg) {
  if (!Array.isArray(rows) || !rows.length) return { labels: [], data: [] };
  const map = new Map();
  for (const row of rows) {
    const key = String(row[groupField] ?? '—');
    const num = parseFloat(String(row[valueField] ?? '').replace(',', '.')) || 0;
    if (!map.has(key)) map.set(key, { sum: 0, count: 0, vals: [] });
    const g = map.get(key);
    g.sum += num; g.count++; g.vals.push(num);
  }
  const labels = [...map.keys()];
  const data = labels.map(l => {
    const g = map.get(l);
    switch (agg) {
      case 'summe':        return g.sum;
      case 'durchschnitt': return g.count ? g.sum / g.count : 0;
      case 'anzahl':       return g.count;
      case 'max':          return Math.max(...g.vals);
      case 'min':          return Math.min(...g.vals);
      default:             return g.sum;
    }
  });
  return { labels, data };
}

/**
 * kpiValue(rows, field, agg) → number
 */
function kpiValue(rows, field, agg) {
  if (!Array.isArray(rows) || !rows.length) return 0;
  if (agg === 'anzahl') return rows.length;
  const vals = rows
    .map(r => parseFloat(String(r[field] ?? '').replace(',', '.')))
    .filter(v => !isNaN(v));
  if (!vals.length) return 0;
  switch (agg) {
    case 'summe':        return vals.reduce((a, b) => a + b, 0);
    case 'durchschnitt': return vals.reduce((a, b) => a + b, 0) / vals.length;
    case 'max':          return Math.max(...vals);
    case 'min':          return Math.min(...vals);
    default:             return vals.length;
  }
}

/**
 * fmt(n) — compact number format
 */
function fmt(n) {
  if (typeof n !== 'number') return String(n);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + ' Mrd';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + ' Mio';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + ' K';
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

// ── KPI renderer ───────────────────────────────────────────────────

/**
 * renderKPIs(container, kpis, rows)
 * Fills a .kpi-strip element with .kpi-card elements.
 */
function renderKPIs(container, kpis, rows) {
  container.innerHTML = '';
  for (const kpi of kpis) {
    const val  = kpiValue(rows, kpi.feld, kpi.berechnung);
    const card = document.createElement('div');
    card.className = 'kpi-card';
    card.innerHTML = `
      <div class="kpi-lbl">${kpi.titel}</div>
      <div class="kpi-val">${fmt(val)}<span class="kpi-unit">${kpi.einheit || ''}</span></div>`;
    container.appendChild(card);
  }
}

// ── Chart renderer ─────────────────────────────────────────────────

let _activeCharts = [];

/**
 * renderCharts(container, diagramme, rows)
 * Fills a .chart-grid element with chart cells using Chart.js.
 */
function renderCharts(container, diagramme, rows) {
  _activeCharts.forEach(c => c.destroy());
  _activeCharts = [];
  container.innerHTML = '';

  const n = diagramme.length;
  let cols = 2, rowCount = Math.ceil(n / 2);
  if      (n === 1)  { cols = 1; rowCount = 1; }
  else if (n <= 2)   { cols = 2; rowCount = 1; }
  else if (n <= 4)   { cols = 2; rowCount = 2; }
  else if (n <= 6)   { cols = 3; rowCount = 2; }
  else               { cols = 3; rowCount = 3; }

  container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  container.style.gridTemplateRows    = `repeat(${rowCount}, 1fr)`;

  diagramme.forEach((chart, i) => {
    const cid  = `vc-${i}`;
    const cell = document.createElement('div');
    cell.className = 'chart-cell';
    cell.innerHTML = `
      <div class="chart-ttl">${chart.titel}</div>
      <div class="chart-wrap"><canvas id="${cid}"></canvas></div>`;
    container.appendChild(cell);

    requestAnimationFrame(() => {
      const canvas = document.getElementById(cid);
      if (!canvas) return;

      const isPie   = chart.typ === 'pie' || chart.typ === 'doughnut';
      const color   = VIS_PALETTE[i % VIS_PALETTE.length];
      let labels, data, datasets;

      if (isPie) {
        const agg = aggregate(rows, chart.label_feld, chart.wert_feld, chart.aggregation || 'summe');
        labels = agg.labels; data = agg.data;
        datasets = [{
          data,
          backgroundColor: VIS_PALETTE.slice(0, data.length),
          borderColor: '#fff', borderWidth: 2,
        }];
      } else {
        const agg = aggregate(rows, chart.x_feld, chart.y_feld, chart.aggregation || 'summe');
        labels = agg.labels; data = agg.data;
        const isLine = chart.typ === 'line';
        datasets = [{
          label: chart.y_feld, data,
          backgroundColor: isLine ? color + '18' : color + 'cc',
          borderColor: color, borderWidth: 2,
          pointRadius: isLine ? 3 : 0, pointHoverRadius: 5,
          fill: isLine, tension: 0.3,
        }];
      }

      const type = (chart.typ === 'doughnut') ? 'doughnut'
                 : (chart.typ === 'pie')       ? 'pie'
                 : chart.typ;

      const inst = new Chart(canvas, {
        type,
        data: { labels, datasets },
        options: {
          responsive: true, maintainAspectRatio: false,
          animation: { duration: 400 },
          plugins: {
            legend: { display: isPie, position: 'bottom' },
            tooltip: {
              backgroundColor: '#fff', borderColor: '#e2e8f0', borderWidth: 1,
              titleColor: '#0f172a', bodyColor: '#64748b', padding: 10,
              callbacks: { label: ctx => ' ' + fmt(ctx.parsed.y ?? ctx.parsed) },
            },
          },
          scales: isPie ? {} : {
            x: { grid: { color: '#f1f5f9' }, ticks: { maxRotation: 40, maxTicksLimit: 12 } },
            y: { grid: { color: '#f1f5f9' }, ticks: { callback: v => fmt(v) } },
          },
        },
      });
      _activeCharts.push(inst);
    });
  });
}

// ── Analyse renderer ───────────────────────────────────────────────

const TYPE_LABELS = {
  bar: 'Balkendiagramm', line: 'Liniendiagramm', pie: 'Kreisdiagramm',
  doughnut: 'Ringdiagramm', scatter: 'Streudiagramm',
};

/**
 * renderAnalyse(kpiContainer, chartContainer, kpis, diagramme, rows)
 */
function renderAnalyse(kpiContainer, chartContainer, kpis, diagramme, rows) {
  kpiContainer.innerHTML   = '';
  chartContainer.innerHTML = '';

  for (const kpi of kpis) {
    const val  = kpiValue(rows, kpi.feld, kpi.berechnung);
    const card = document.createElement('div');
    card.className = 'analyse-card';
    card.innerHTML = `
      <div class="analyse-card-title">${kpi.titel}</div>
      <div class="analyse-kpi-value">${fmt(val)}<span class="analyse-kpi-unit">${kpi.einheit || ''}</span></div>
      <div class="analyse-meta">
        <span class="analyse-tag">${kpi.feld}</span>
        <span class="analyse-tag">${kpi.berechnung}</span>
      </div>
      ${kpi.erklaerung ? `<div class="analyse-erklaerung">${kpi.erklaerung}</div>` : ''}`;
    kpiContainer.appendChild(card);
  }

  for (const chart of diagramme) {
    const card = document.createElement('div');
    card.className = 'analyse-card';
    card.innerHTML = `
      <div class="analyse-card-title">${chart.titel}</div>
      <div class="analyse-meta">
        <span class="analyse-tag">${TYPE_LABELS[chart.typ] || chart.typ}</span>
        <span class="analyse-tag">${chart.x_feld || chart.label_feld || '—'}</span>
        <span class="analyse-tag">${chart.y_feld || chart.wert_feld  || '—'}</span>
        <span class="analyse-tag">${chart.aggregation || '—'}</span>
      </div>
      ${chart.erklaerung ? `<div class="analyse-erklaerung">${chart.erklaerung}</div>` : ''}`;
    chartContainer.appendChild(card);
  }
}

// ── Main bootstrap ─────────────────────────────────────────────────

/**
 * initDashboard(logicUrl, dataUrl)
 * Fetches vis-logic.json + vis-data.json in parallel and renders the dashboard.
 * Called automatically when the script loads (uses document.currentScript).
 */
async function initDashboard(logicUrl, dataUrl) {
  try {
    const [logicRes, dataRes] = await Promise.all([
      fetch(logicUrl),
      fetch(dataUrl),
    ]);
    if (!logicRes.ok) throw new Error(`vis-logic.json nicht gefunden — bitte Analyse erneut starten (${logicRes.status})`);
    if (!dataRes.ok)  throw new Error(`vis-data.json nicht gefunden — bitte Server neu starten und Analyse erneut durchführen (${dataRes.status})`);

    const [logic, rows] = await Promise.all([logicRes.json(), dataRes.json()]);
    if (!Array.isArray(rows)) throw new Error('vis-data.json hat ein ungültiges Format (kein Array)');

    const kpis      = logic.kpis       || [];
    const diagramme = logic.diagramme  || [];
    const meta      = logic.meta       || {};

    // Toolbar
    const tbRows   = document.getElementById('tb-rows');
    const tbCharts = document.getElementById('tb-charts');
    const tbTime   = document.getElementById('tb-time');
    if (tbRows)   tbRows.innerHTML   = `<strong>${meta.zeilen ?? rows.length}</strong> Datensätze`;
    if (tbCharts) tbCharts.innerHTML = `<strong>${diagramme.length}</strong> Diagramme`;
    if (tbTime)   tbTime.textContent = meta.erstellt
      ? new Date(meta.erstellt).toLocaleString('de-DE')
      : '';

    // KPI strip
    const kpiStrip = document.getElementById('kpi-strip');
    if (kpiStrip) renderKPIs(kpiStrip, kpis, rows);

    // Chart grid
    const chartGrid = document.getElementById('chart-grid');
    if (chartGrid) renderCharts(chartGrid, diagramme, rows);

    // Analyse cards (optional — only if containers exist)
    const anlKpi   = document.getElementById('analyse-kpis');
    const anlChart = document.getElementById('analyse-charts');
    if (anlKpi && anlChart) renderAnalyse(anlKpi, anlChart, kpis, diagramme, rows);

    // Show dash body, hide placeholder
    const ph    = document.getElementById('vis-placeholder');
    const body  = document.getElementById('dash-body');
    const tb    = document.getElementById('dash-toolbar');
    if (ph)   ph.style.display   = 'none';
    if (body) body.style.display = 'flex';
    if (tb)   tb.classList.add('visible');

  } catch (err) {
    const ph = document.getElementById('vis-placeholder');
    if (ph) ph.innerHTML = `<p style="color:#dc2626">Fehler: ${err.message}</p>`;
    console.error('[vis-engine]', err);
  }
}

// Auto-init when loaded inside output/index.html
// Reads data-logic / data-data attributes from <script> tag, or uses defaults.
(function autoInit() {
  const script   = document.currentScript || document.querySelector('script[src*="vis-engine"]');
  const logicUrl = (script && script.dataset.logic) || 'vis-logic.json';
  const dataUrl  = (script && script.dataset.data)  || 'vis-data.json';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initDashboard(logicUrl, dataUrl));
  } else {
    initDashboard(logicUrl, dataUrl);
  }
})();