"""agents.py — LLM-Agenten für AMAI Dash (Analyst, Erklärer, Chat)"""

import json
import time

from ollama import generate

from .helpers import extract_json


# ---------------------------------------------------------------------------
# Resilient LLM call — retries once on transient failures
# ---------------------------------------------------------------------------

def _llm(model: str, prompt: str, retries: int = 1) -> str:
    """Call Ollama generate(); retry up to `retries` times on error."""
    last_err = None
    for attempt in range(retries + 1):
        try:
            response = generate(model, prompt)
            return response["response"]
        except Exception as exc:
            last_err = exc
            if attempt < retries:
                time.sleep(2)
    raise RuntimeError(
        f"Ollama-Anfrage fehlgeschlagen nach {retries + 1} Versuchen: {last_err}"
    )


# ---------------------------------------------------------------------------
# Analyst — decides which charts & KPIs fit the data
# ---------------------------------------------------------------------------

def run_analyst(fields: dict, sample_rows: list[dict], model: str) -> dict:
    prompt = f"""Du bist ein Datenvisualisierungs-Experte.
Analysiere die folgenden Felddefinitionen und Beispieldaten.
Entscheide, welche KPIs und Diagramme sinnvoll sind.

Felddefinitionen:
{json.dumps(fields, ensure_ascii=False, indent=2)}

Beispieldaten (erste Zeilen):
{json.dumps(sample_rows[:5], ensure_ascii=False, indent=2)}

Antworte NUR mit einem JSON-Objekt, kein anderer Text, kein Markdown.
Folge exakt diesem Schema:
{{
  "kpis": [
    {{
      "titel": "Gesamtumsatz",
      "feld": "umsatz",
      "berechnung": "summe",
      "einheit": "€"
    }}
  ],
  "diagramme": [
    {{
      "typ": "bar",
      "titel": "Umsatz nach Region",
      "x_feld": "region",
      "y_feld": "umsatz",
      "aggregation": "summe"
    }},
    {{
      "typ": "line",
      "titel": "Verlauf über Zeit",
      "x_feld": "datum",
      "y_feld": "umsatz",
      "aggregation": "summe"
    }},
    {{
      "typ": "pie",
      "titel": "Anteil nach Kategorie",
      "label_feld": "kategorie",
      "wert_feld": "anzahl",
      "aggregation": "summe"
    }}
  ]
}}

Erlaubte Diagramm-Typen: bar, line, pie, scatter, doughnut.
Erlaubte Berechnungen/Aggregationen: summe, durchschnitt, anzahl, max, min.
Nutze nur Felder, die in den Felddefinitionen vorhanden sind.
Wähle so viele Diagramme wie sinnvoll sind – mindestens 2, maximal 5.
"""
    return extract_json(_llm(model, prompt))


# ---------------------------------------------------------------------------
# Erklärer — explains each KPI and chart in plain language
# ---------------------------------------------------------------------------

def run_erklaerer(plan: dict, fields: dict, sample_rows: list[dict], model: str) -> dict:
    prompt = f"""Du bist ein Daten-Analytiker der Visualisierungen verständlich erklärt.

Für jeden KPI und jedes Diagramm im folgenden Plan, schreibe eine kurze, klare Erklärung:
- Welche Felder werden verwendet
- Wie wird der Wert berechnet (z.B. "Summe aller Werte in Spalte X")
- Was bedeutet das inhaltlich für den Nutzer

Visualisierungsplan:
{json.dumps(plan, ensure_ascii=False, indent=2)}

Felddefinitionen:
{json.dumps(fields, ensure_ascii=False, indent=2)}

Beispieldaten:
{json.dumps(sample_rows[:3], ensure_ascii=False, indent=2)}

Antworte NUR mit einem JSON-Objekt, kein anderer Text:
{{
  "kpis": [
    {{
      "titel": "Gesamtumsatz",
      "erklaerung": "Erkläre in 2-3 Sätzen wie dieser KPI berechnet wird und was er bedeutet"
    }}
  ],
  "diagramme": [
    {{
      "titel": "Umsatz nach Region",
      "erklaerung": "Erkläre in 2-3 Sätzen wie dieses Diagramm aufgebaut ist und was es zeigt"
    }}
  ]
}}
"""
    return extract_json(_llm(model, prompt))


# ---------------------------------------------------------------------------
# Chat agent — answers questions and optionally modifies the vis plan
# ---------------------------------------------------------------------------

def run_chat_agent(
    message: str,
    plan: dict,
    sample_rows: list[dict],
    history: list[dict],
    model: str,
) -> dict:
    history_text = ""
    for h in history[-6:]:
        rolle = "Nutzer" if h.get("rolle") == "nutzer" else "Assistent"
        history_text += f"{rolle}: {h.get('text', '')}\n"

    prompt = f"""Du bist ein KI-Assistent für Datenanalyse im AMAI Dash Dashboard.
Du kennst den aktuellen Visualisierungsplan und kannst:
1. KPIs und Diagramme erklären
2. Anpassungen am Plan vornehmen (Typ ändern, Felder tauschen, neue KPIs/Diagramme hinzufügen)

Aktueller Visualisierungsplan:
{json.dumps(plan, ensure_ascii=False, indent=2)}

Beispieldaten (erste Zeilen):
{json.dumps(sample_rows[:3], ensure_ascii=False, indent=2)}

Bisheriger Gesprächsverlauf:
{history_text}
Nutzer: {message}

Antworte NUR mit einem JSON-Objekt. Kein anderer Text, kein Markdown.
Falls der Nutzer nur eine Frage stellt oder eine Erklärung wünscht:
{{
  "antwort": "Deine Antwort in 2-4 Sätzen",
  "aktion": null
}}

Falls der Nutzer eine Anpassung am Plan wünscht (z.B. Diagrammtyp ändern, neuen KPI hinzufügen):
{{
  "antwort": "Kurze Bestätigung was du geändert hast",
  "aktion": "update_plan",
  "plan": {{
    "kpis": [...],
    "diagramme": [...]
  }}
}}

Wichtig:
- Bei "update_plan" muss "plan" den VOLLSTÄNDIGEN aktualisierten Plan enthalten (alle KPIs und Diagramme)
- Erlaubte Diagramm-Typen: bar, line, pie, doughnut, scatter
- Erlaubte Berechnungen: summe, durchschnitt, anzahl, max, min
- Nutze nur Felder die in den Beispieldaten vorhanden sind
"""
    return extract_json(_llm(model, prompt))
