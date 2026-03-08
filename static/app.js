// ── State ──────────────────────────────────────────────────────────
let currentSource = 'csv';
let lastPlan = null, lastRows = null, lastErklaerungen = null;
let chatHistory = [];

// ── Aggregation helpers ───────────────────────────────────────────
function aggregate(rows, groupField, valueField, agg) {
  if (!Array.isArray(rows)) return { labels: [], data: [] };
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

function kpiValue(rows, field, agg) {
  if (!Array.isArray(rows)) return 0;
  if (agg === 'anzahl') return rows.length;
  const vals = rows.map(r => parseFloat(String(r[field] ?? '').replace(',', '.'))).filter(v => !isNaN(v));
  if (!vals.length) return 0;
  switch (agg) {
    case 'summe':        return vals.reduce((a, b) => a + b, 0);
    case 'durchschnitt': return vals.reduce((a, b) => a + b, 0) / vals.length;
    case 'max':          return Math.max(...vals);
    case 'min':          return Math.min(...vals);
    default:             return vals.length;
  }
}

function fmt(n) {
  if (typeof n !== 'number') return String(n);
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + ' Mrd';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + ' Mio';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + ' K';
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

// ── Analyse renderer ──────────────────────────────────────────────
const CHART_TYPE_LABELS = {
  bar:'Balkendiagramm', line:'Liniendiagramm', pie:'Kreisdiagramm',
  doughnut:'Ringdiagramm', scatter:'Streudiagramm',
};

function renderAnalysis(plan, erklaerungen, rows) {
  const kpiGrid   = document.getElementById('analyse-kpis');
  const chartGrid = document.getElementById('analyse-charts');
  if (!kpiGrid || !chartGrid) return;
  kpiGrid.innerHTML = ''; chartGrid.innerHTML = '';

  const erkKpis   = erklaerungen?.kpis      || [];
  const erkCharts = erklaerungen?.diagramme  || [];

  (plan.kpis || []).forEach((kpi, i) => {
    const val  = kpiValue(rows, kpi.feld, kpi.berechnung);
    const erkl = erkKpis[i]?.erklaerung || '';
    const card = document.createElement('div');
    card.className = 'analyse-card';
    card.innerHTML = `
      <div class="analyse-card-title">${kpi.titel}</div>
      <div class="analyse-kpi-value">${fmt(val)}<span class="analyse-kpi-unit">${kpi.einheit || ''}</span></div>
      <div class="analyse-meta">
        <span class="analyse-tag">${kpi.feld}</span>
        <span class="analyse-tag">${kpi.berechnung}</span>
      </div>
      ${erkl ? `<div class="analyse-erklaerung">${erkl}</div>` : ''}`;
    kpiGrid.appendChild(card);
  });

  (plan.diagramme || []).forEach((chart, i) => {
    const erkl = erkCharts[i]?.erklaerung || '';
    const card = document.createElement('div');
    card.className = 'analyse-card';
    card.innerHTML = `
      <div class="analyse-card-title">${chart.titel}</div>
      <div class="analyse-meta">
        <span class="analyse-tag">${CHART_TYPE_LABELS[chart.typ] || chart.typ}</span>
        <span class="analyse-tag">${chart.x_feld || chart.label_feld || '—'}</span>
        <span class="analyse-tag">${chart.y_feld || chart.wert_feld  || '—'}</span>
        <span class="analyse-tag">${chart.aggregation || '—'}</span>
      </div>
      ${erkl ? `<div class="analyse-erklaerung">${erkl}</div>` : ''}`;
    chartGrid.appendChild(card);
  });

  document.getElementById('analyse-placeholder')?.style && (document.getElementById('analyse-placeholder').style.display = 'none');
  document.getElementById('analyse-body')?.style && (document.getElementById('analyse-body').style.display = 'flex');
  document.getElementById('nav-analyse')?.classList.add('ready');
  document.getElementById('nav-viz')?.classList.add('ready');
}

// ── Navigation ────────────────────────────────────────────────────
function switchPage(name) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  document.getElementById(`nav-${name}`).classList.add('active');
}

// ── Source toggle ─────────────────────────────────────────────────
function setSource(src) {
  currentSource = src;
  document.getElementById('src-csv').className = src === 'csv' ? 'btn btn-primary' : 'btn btn-secondary';
  document.getElementById('src-db').className  = src === 'db'  ? 'btn btn-primary' : 'btn btn-secondary';
  document.getElementById('csv-section').style.display = src === 'csv' ? '' : 'none';
  document.getElementById('db-section').style.display  = src === 'db'  ? '' : 'none';
  validateInputs();
}

function updateDbInputs() {
  const type = document.getElementById('db-type').value;
  document.getElementById('db-file-group').style.display   = type === 'sqlite' ? '' : 'none';
  document.getElementById('db-fields-group').style.display = type !== 'sqlite' ? '' : 'none';
  if (type !== 'sqlite') {
    const ports = { postgresql:'5432', mysql:'3306', mssql_pymssql:'1433', mssql_pyodbc:'1433' };
    const hints = {
      postgresql:   'Treiber: pip install psycopg2-binary',
      mysql:        'Treiber: pip install pymysql',
      mssql_pymssql:'Treiber: pip install pymssql  (kein ODBC-Treiber nötig)',
      mssql_pyodbc: 'Treiber: pip install pyodbc  +  ODBC Driver 17 for SQL Server',
    };
    const portEl = document.getElementById('db-port');
    if (!portEl.value) portEl.value = ports[type] || '';
    document.getElementById('db-conn-hint').textContent = hints[type] || '';
  }
  validateInputs();
}

function buildConnectionString() {
  const type = document.getElementById('db-type').value;
  const host  = document.getElementById('db-host').value.trim();
  const port  = document.getElementById('db-port').value.trim();
  const name  = document.getElementById('db-name').value.trim();
  const user  = encodeURIComponent(document.getElementById('db-user').value.trim());
  const pass  = encodeURIComponent(document.getElementById('db-password').value);
  const hp    = port ? `${host}:${port}` : host;
  const auth  = user ? `${user}:${pass}@` : '';
  switch (type) {
    case 'postgresql':    return `postgresql://${auth}${hp}/${name}`;
    case 'mysql':         return `mysql+pymysql://${auth}${hp}/${name}`;
    case 'mssql_pymssql': return `mssql+pymssql://${auth}${hp}/${name}`;
    case 'mssql_pyodbc':  return `mssql+pyodbc://${auth}${hp}/${name}?driver=ODBC+Driver+17+for+SQL+Server`;
    default: return '';
  }
}

// ── File inputs ───────────────────────────────────────────────────
document.getElementById('csv-file').addEventListener('change', function () {
  document.getElementById('csv-filename').textContent = this.files[0] ? '✓ ' + this.files[0].name : '';
  validateInputs();
});
document.getElementById('json-file').addEventListener('change', function () {
  document.getElementById('json-filename').textContent = this.files[0] ? '✓ ' + this.files[0].name : '';
});
document.getElementById('db-file').addEventListener('change', function () {
  document.getElementById('db-filename').textContent = this.files[0] ? '✓ ' + this.files[0].name : '';
  validateInputs();
});
document.getElementById('db-query').addEventListener('input', validateInputs);

['csv-dropzone','json-dropzone','db-dropzone'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('dragover',  e => { e.preventDefault(); el.classList.add('dragover'); });
  el.addEventListener('dragleave', () => el.classList.remove('dragover'));
  el.addEventListener('drop',      e => { e.preventDefault(); el.classList.remove('dragover'); });
});

function validateInputs() {
  let valid = false;
  if (currentSource === 'csv') {
    valid = !!document.getElementById('csv-file').files[0];
  } else {
    const type    = document.getElementById('db-type').value;
    const hasFile = type === 'sqlite' && !!document.getElementById('db-file').files[0];
    const hasFields = type !== 'sqlite'
      && !!document.getElementById('db-host').value.trim()
      && !!document.getElementById('db-name').value.trim();
    const hasQuery  = !!document.getElementById('db-query').value.trim();
    valid = (hasFile || hasFields) && hasQuery;
  }
  document.getElementById('analyze-btn').disabled = !valid;
}

// ── Preview ───────────────────────────────────────────────────────
function previewData() { currentSource === 'csv' ? previewCSV() : previewDB(); }

async function previewCSV() {
  const f = document.getElementById('csv-file').files[0];
  if (!f) { showError('Bitte zuerst eine CSV-Datei auswählen.'); return; }
  const fd = new FormData();
  fd.append('csv_file', f);
  fd.append('separator', document.getElementById('separator').value);
  fd.append('skip_header', document.getElementById('skip-header').checked);
  fd.append('encoding', document.getElementById('encoding').value);
  setStatus('Lade Vorschau …', false); hideError();
  try {
    const d = await (await fetch('/preview', { method: 'POST', body: fd })).json();
    if (d.error) { showError(d.error); clearStatus(); return; }
    renderTable(d.headers, d.rows, d.total);
    setStatus(`${d.total} Zeilen geladen`, true);
  } catch (e) { showError('Fehler: ' + e.message); clearStatus(); }
}

async function previewDB() {
  const fd = buildDbFormData();
  if (!fd) return;
  setStatus('Lade Vorschau …', false); hideError();
  try {
    const d = await (await fetch('/preview-db', { method: 'POST', body: fd })).json();
    if (d.error) { showError(d.error); clearStatus(); return; }
    renderTable(d.headers, d.rows, d.total);
    setStatus(`${d.total} Zeilen geladen`, true);
  } catch (e) { showError('Fehler: ' + e.message); clearStatus(); }
}

function buildDbFormData() {
  const type  = document.getElementById('db-type').value;
  const query = document.getElementById('db-query').value.trim();
  if (!query) { showError('Bitte eine SQL-Abfrage eingeben.'); return null; }
  const fd = new FormData();
  if (type === 'sqlite') {
    const f = document.getElementById('db-file').files[0];
    if (!f) { showError('Bitte eine SQLite-Datei auswählen.'); return null; }
    fd.append('db_file', f);
  } else {
    if (!document.getElementById('db-host').value.trim()) { showError('Bitte Server / Host eingeben.'); return null; }
    if (!document.getElementById('db-name').value.trim()) { showError('Bitte Datenbankname eingeben.'); return null; }
    fd.append('connection_string', buildConnectionString());
  }
  fd.append('query', query);
  return fd;
}

function renderTable(headers, rows, total) {
  document.getElementById('row-count-badge').textContent = total + ' Zeilen';
  document.getElementById('preview-thead').innerHTML =
    '<tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr>';
  document.getElementById('preview-tbody').innerHTML = rows.map(r =>
    '<tr>' + headers.map(h => `<td>${r[h] ?? ''}</td>`).join('') + '</tr>'
  ).join('');
  document.getElementById('preview-card').style.display = '';
}

// ── Ollama models ─────────────────────────────────────────────────
async function loadModels() {
  try {
    const d = await (await fetch('/models')).json();
    const sel = document.getElementById('model-select');
    const dot = document.getElementById('ollama-dot');
    if (d.models?.length) {
      const cur = sel.value; sel.innerHTML = '';
      d.models.forEach(m => {
        const o = document.createElement('option');
        o.value = m; o.textContent = m;
        if (m === cur) o.selected = true;
        sel.appendChild(o);
      });
      dot.style.background = 'var(--success)';
    }
    if (d.error) dot.style.background = 'var(--warning)';
  } catch { document.getElementById('ollama-dot').style.background = 'var(--error)'; }
}
loadModels();

// ── Analyze ───────────────────────────────────────────────────────
async function analyzeData() {
  hideError(); showLoading();
  try {
    let endpoint, fd;
    if (currentSource === 'csv') {
      const csvFile = document.getElementById('csv-file').files[0];
      if (!csvFile) { hideLoading(); showError('Bitte CSV-Datei auswählen.'); return; }
      fd = new FormData();
      fd.append('csv_file', csvFile);
      fd.append('separator', document.getElementById('separator').value);
      fd.append('skip_header', document.getElementById('skip-header').checked);
      fd.append('encoding', document.getElementById('encoding').value);
      const jf = document.getElementById('json-file').files[0];
      if (jf) fd.append('field_definitions', jf);
      fd.append('model', document.getElementById('model-select').value);
      endpoint = '/analyze';
    } else {
      fd = buildDbFormData();
      if (!fd) { hideLoading(); return; }
      const jf = document.getElementById('json-file').files[0];
      if (jf) fd.append('field_definitions', jf);
      fd.append('model', document.getElementById('model-select').value);
      endpoint = '/analyze-db';
    }

    const resp = await fetch(endpoint, { method: 'POST', body: fd });
    const d = await resp.json();
    hideLoading();

    if (!resp.ok || d.error || d.detail) {
      showError('Fehler: ' + (d.error || JSON.stringify(d.detail) || `HTTP ${resp.status}`));
      return;
    }
    if (!d.plan || !d.rows) {
      showError('Unerwartete Server-Antwort: ' + JSON.stringify(d).slice(0, 200));
      return;
    }

    lastPlan = d.plan; lastRows = d.rows; lastErklaerungen = d.erklaerungen;

    // Reload the output iframe with cache-bust
    const frame   = document.getElementById('viz-frame');
    const vizEmpty = document.getElementById('viz-empty');
    if (frame) {
      frame.src = '/output/index.html?t=' + Date.now();
      frame.style.display = 'block';
    }
    if (vizEmpty) vizEmpty.style.display = 'none';

    renderAnalysis(d.plan, d.erklaerungen, d.rows);
    setStatus(`Analyse abgeschlossen — ${d.row_count} Zeilen`, true);
    switchPage('viz');

  } catch (e) {
    hideLoading(); showError('Netzwerkfehler: ' + e.message);
  }
}

// ── Export ────────────────────────────────────────────────────────
function download(filename, content, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename; a.click();
}

function exportCSV() {
  if (!lastRows?.length) { showError('Keine Daten vorhanden.'); return; }
  const headers = Object.keys(lastRows[0]);
  const lines   = [headers.join(','), ...lastRows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))];
  download('daten.csv', lines.join('\n'), 'text/csv');
}

function exportPlan() {
  if (!lastPlan) { showError('Keine Analyse vorhanden.'); return; }
  download('analyse-plan.json', JSON.stringify(lastPlan, null, 2), 'application/json');
}

function exportErklaerungen() {
  if (!lastErklaerungen) { showError('Keine Erklärungen vorhanden.'); return; }
  let text = 'KPIs\n' + '='.repeat(40) + '\n\n';
  (lastErklaerungen.kpis || []).forEach(k => {
    text += `${k.titel}\n${k.erklaerung}\n\n`;
  });
  text += '\nDiagramme\n' + '='.repeat(40) + '\n\n';
  (lastErklaerungen.diagramme || []).forEach(d => {
    text += `${d.titel}\n${d.erklaerung}\n\n`;
  });
  download('erklaerungen.txt', text, 'text/plain');
}

function exportPDF() {
  if (!lastPlan) { showError('Keine Visualisierung vorhanden.'); return; }
  const wasActive = document.querySelector('.page.active')?.id;
  switchPage('viz');
  setTimeout(() => {
    window.print();
    if (wasActive && wasActive !== 'page-viz') {
      const name = wasActive.replace('page-', '');
      setTimeout(() => switchPage(name), 500);
    }
  }, 100);
}

// ── Chat ──────────────────────────────────────────────────────────
function chatAddMsg(text, rolle) {
  const box = document.getElementById('chat-messages');
  if (!box) return;

  const row = document.createElement('div');
  row.className = `chat-row ${rolle}`;

  if (rolle === 'system') {
    const span = document.createElement('div');
    span.className = 'chat-system-text';
    span.textContent = text;
    row.appendChild(span);
  } else {
    const now = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

    if (rolle === 'agent') {
      const avatar = document.createElement('div');
      avatar.className = 'chat-mini-avatar';
      avatar.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
      row.appendChild(avatar);
    }

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';

    const body = document.createElement('div');
    body.className = 'chat-bubble-body';
    body.textContent = text;

    const time = document.createElement('div');
    time.className = 'chat-time';
    time.textContent = now;

    bubble.appendChild(body);
    bubble.appendChild(time);
    row.appendChild(bubble);
  }

  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
  return row;
}

function chatAddTyping() {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'chat-typing';
  el.innerHTML = '<span></span><span></span><span></span>';
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

function chatAddUpdateBadge(rowEl) {
  const bubble = rowEl.querySelector('.chat-bubble') || rowEl;
  const badge = document.createElement('div');
  badge.className = 'chat-update-badge';
  badge.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Dashboard aktualisiert`;
  bubble.appendChild(badge);
}

function chatChip(chipEl) {
  const input = document.getElementById('chat-input');
  if (input) { input.value = chipEl.textContent; input.focus(); }
}

async function sendChat() {
  if (!lastPlan) { chatAddMsg('Bitte zuerst eine Analyse durchführen.', 'system'); return; }

  const input = document.getElementById('chat-input');
  const btn   = document.getElementById('chat-send');
  const msg   = input.value.trim();
  if (!msg) return;

  input.value = ''; input.disabled = true; btn.disabled = true;
  chatAddMsg(msg, 'user');
  chatHistory.push({ rolle: 'nutzer', text: msg });

  const typingEl = chatAddTyping();

  try {
    const resp = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message:     msg,
        plan:        lastPlan,
        sample_rows: lastRows?.slice(0, 5) || [],
        history:     chatHistory.slice(-6),
        model:       document.getElementById('model-select').value,
      }),
    });
    const d = await resp.json();
    typingEl.remove();

    if (d.error) {
      chatAddMsg('Fehler: ' + d.error, 'system');
    } else {
      const agentEl = chatAddMsg(d.antwort, 'agent');
      chatHistory.push({ rolle: 'agent', text: d.antwort });

      if (d.aktion === 'update_plan' && d.updated_plan) {
        lastPlan = d.updated_plan;
        const frame = document.getElementById('viz-frame');
        if (frame && frame.src) frame.src = '/output/index.html?t=' + Date.now();
        renderAnalysis(lastPlan, lastErklaerungen, lastRows || []);
        chatAddUpdateBadge(agentEl);
      }
    }
  } catch (e) {
    typingEl.remove();
    chatAddMsg('Netzwerkfehler: ' + e.message, 'system');
  } finally {
    input.disabled = false; btn.disabled = false; input.focus();
  }
}

// ── Loading ───────────────────────────────────────────────────────
function showLoading() {
  [1, 2].forEach(n => document.getElementById(`step-${n}`).classList.remove('active','done'));
  document.getElementById('step-1').classList.add('active');
  document.getElementById('loading-overlay').classList.add('visible');
  setTimeout(() => {
    const s1 = document.getElementById('step-1');
    s1.classList.remove('active'); s1.classList.add('done');
    document.getElementById('step-2').classList.add('active');
  }, 8000);
}
function hideLoading() {
  [1, 2].forEach(n => {
    const s = document.getElementById(`step-${n}`);
    s.classList.remove('active'); s.classList.add('done');
  });
  setTimeout(() => document.getElementById('loading-overlay').classList.remove('visible'), 400);
}

// ── Status / errors ───────────────────────────────────────────────
function setStatus(msg, ok) {
  const dot  = document.getElementById('status-dot-hdr');
  const text = document.getElementById('status-text-hdr');
  dot.className  = 'status-dot' + (ok ? ' ok' : ' err');
  text.textContent = msg;
  const sb = document.getElementById('sidebar-status');
  sb.textContent = msg; sb.classList.add('visible');
}
function clearStatus() { document.getElementById('sidebar-status').classList.remove('visible'); }
function showError(msg) { const b = document.getElementById('error-box'); b.textContent = msg; b.classList.add('visible'); }
function hideError()    { document.getElementById('error-box').classList.remove('visible'); }
