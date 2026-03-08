"""writer.py — Generiert output/vis-logic.json, output/vis-data.json und output/index.html"""

import datetime
import json
from pathlib import Path

BASE_DIR   = Path(__file__).parent.parent   # data-visualizer/
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# Standalone dashboard HTML — loaded in the iframe in the main app
# ---------------------------------------------------------------------------

_HTML = """\
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AMAI Dash — Dashboard</title>
  <link rel="stylesheet" href="/static/style.css" />
  <style>
    html, body { height: 100%; background: #f1f5f9; overflow: hidden; }
    body { display: flex; flex-direction: column; }
    #dash-toolbar { flex-shrink: 0; }
    #dash-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    #vis-placeholder { flex: 1; display: flex; align-items: center; justify-content: center; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="dash-toolbar visible" id="dash-toolbar">
    <span class="dt-info" id="tb-rows"></span>
    <div class="dt-sep"></div>
    <span class="dt-info" id="tb-charts"></span>
    <div class="dt-sep"></div>
    <span class="dt-info" id="tb-time"></span>
  </div>

  <div id="vis-placeholder"><p>Lade Dashboard …</p></div>

  <div class="dash-body" id="dash-body" style="display:none;">
    <div class="kpi-strip" id="kpi-strip"></div>
    <div class="chart-grid" id="chart-grid"></div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="/static/vis-engine.js"
          data-logic="/output/vis-logic.json"
          data-data="/output/vis-data.json"></script>
</body>
</html>
"""


def write_output(plan: dict, erklaerungen: dict, rows: list[dict], row_count: int) -> None:
    """
    Merges plan + erklaerungen and writes:
      output/vis-logic.json  — rules + meta (always small)
      output/vis-data.json   — raw rows   (can be large)
      output/index.html      — standalone dashboard
    """
    erk_kpis   = (erklaerungen or {}).get("kpis",      [])
    erk_charts = (erklaerungen or {}).get("diagramme", [])

    kpis = []
    for i, kpi in enumerate(plan.get("kpis", [])):
        entry = dict(kpi)
        if i < len(erk_kpis):
            entry["erklaerung"] = erk_kpis[i].get("erklaerung", "")
        kpis.append(entry)

    diagramme = []
    for i, chart in enumerate(plan.get("diagramme", [])):
        entry = dict(chart)
        if i < len(erk_charts):
            entry["erklaerung"] = erk_charts[i].get("erklaerung", "")
        diagramme.append(entry)

    vis_logic = {
        "meta": {
            "erstellt": datetime.datetime.now().isoformat(timespec="seconds"),
            "zeilen":   row_count,
        },
        "kpis":      kpis,
        "diagramme": diagramme,
    }

    (OUTPUT_DIR / "vis-logic.json").write_text(
        json.dumps(vis_logic, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUTPUT_DIR / "vis-data.json").write_text(
        json.dumps(rows, ensure_ascii=False), encoding="utf-8"
    )
    (OUTPUT_DIR / "index.html").write_text(_HTML, encoding="utf-8")
