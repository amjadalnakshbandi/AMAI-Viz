"""
main.py — AMAI Dash Backend
FastAPI-App + Routen. Logik liegt in agents.py / helpers.py / writer.py.
"""

import json
import traceback
from pathlib import Path

import ollama
import uvicorn
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.agents  import run_analyst, run_erklaerer, run_chat_agent
from backend.helpers import parse_csv, serialize_rows, get_db_rows, auto_field_definitions
from backend.writer  import write_output, OUTPUT_DIR

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

DEFAULT_MODEL = "mistral-large-3:675b-cloud"

BASE_DIR   = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="AMAI Dash")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")


# ---------------------------------------------------------------------------
# Startup check — warn early if Ollama is unreachable
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def check_ollama():
    try:
        ollama.list()
        print("✓ Ollama erreichbar")
    except Exception as exc:
        print(f"⚠  Ollama nicht erreichbar: {exc}")
        print("   Starten Sie Ollama und laden Sie ein Modell, bevor Sie analysieren.")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return FileResponse(str(STATIC_DIR / "index.html"))


@app.get("/models")
async def list_models():
    try:
        result = ollama.list()
        names = [m.model for m in result.models]
        return JSONResponse({"models": names})
    except Exception as exc:
        return JSONResponse({"models": [DEFAULT_MODEL], "error": str(exc)})


# ── CSV preview ────────────────────────────────────────────────────

@app.post("/preview")
async def preview_csv(
    csv_file:    UploadFile = File(...),
    separator:   str        = Form(","),
    skip_header: bool       = Form(True),
    encoding:    str        = Form("utf-8"),
):
    try:
        content = await csv_file.read()
        rows    = parse_csv(content, separator, skip_header, encoding)
        preview = rows[:10]
        headers = list(preview[0].keys()) if preview else []
        return JSONResponse({"headers": headers, "rows": preview, "total": len(rows)})
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


# ── DB preview ────────────────────────────────────────────────────

@app.post("/preview-db")
async def preview_db(
    connection_string: str        = Form(None),
    db_file:           UploadFile = File(None),
    query:             str        = Form(...),
):
    try:
        rows    = serialize_rows(await get_db_rows(connection_string, db_file, query))
        preview = rows[:10]
        headers = list(preview[0].keys()) if preview else []
        return JSONResponse({"headers": headers, "rows": preview, "total": len(rows)})
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


# ── CSV analyse ───────────────────────────────────────────────────

@app.post("/analyze")
async def analyze(
    csv_file:          UploadFile = File(...),
    field_definitions: UploadFile = File(None),
    separator:         str        = Form(","),
    skip_header:       bool       = Form(True),
    encoding:          str        = Form("utf-8"),
    model:             str        = Form(DEFAULT_MODEL),
):
    try:
        rows = parse_csv(await csv_file.read(), separator, skip_header, encoding)
        if not rows:
            return JSONResponse({"error": "CSV-Datei ist leer."}, status_code=400)

        if field_definitions and getattr(field_definitions, "filename", None):
            fields = json.loads(await field_definitions.read())
        else:
            fields = auto_field_definitions(rows)

        plan         = run_analyst(fields, rows, model)
        erklaerungen = run_erklaerer(plan, fields, rows[:5], model)
        write_output(plan, erklaerungen, rows, len(rows))
        return JSONResponse({"plan": plan, "rows": rows, "row_count": len(rows), "erklaerungen": erklaerungen})

    except Exception as exc:
        return JSONResponse({"error": str(exc), "detail": traceback.format_exc()}, status_code=500)


# ── DB analyse ────────────────────────────────────────────────────

@app.post("/analyze-db")
async def analyze_db(
    connection_string: str        = Form(None),
    db_file:           UploadFile = File(None),
    query:             str        = Form(...),
    field_definitions: UploadFile = File(None),
    model:             str        = Form(DEFAULT_MODEL),
):
    try:
        rows = serialize_rows(await get_db_rows(connection_string, db_file, query))
        if not rows:
            return JSONResponse({"error": "Abfrage lieferte keine Daten."}, status_code=400)

        if field_definitions and getattr(field_definitions, "filename", None):
            fields = json.loads(await field_definitions.read())
        else:
            fields = auto_field_definitions(rows)

        plan         = run_analyst(fields, rows, model)
        erklaerungen = run_erklaerer(plan, fields, rows[:5], model)
        write_output(plan, erklaerungen, rows, len(rows))
        return JSONResponse({"plan": plan, "rows": rows, "row_count": len(rows), "erklaerungen": erklaerungen})

    except Exception as exc:
        return JSONResponse({"error": str(exc), "detail": traceback.format_exc()}, status_code=500)


# ── Chat ──────────────────────────────────────────────────────────

@app.post("/chat")
async def chat(request: dict):
    try:
        message     = request.get("message", "")
        plan        = request.get("plan", {})
        sample_rows = request.get("sample_rows", [])
        history     = request.get("history", [])
        model       = request.get("model", DEFAULT_MODEL)

        result = run_chat_agent(message, plan, sample_rows, history, model)

        if result.get("aktion") == "update_plan" and result.get("plan"):
            new_plan      = result["plan"]
            vis_data_path = OUTPUT_DIR / "vis-data.json"
            rows          = json.loads(vis_data_path.read_text(encoding="utf-8")) if vis_data_path.exists() else []
            erklaerungen  = {
                "kpis":      [{"titel": k.get("titel",""), "erklaerung": k.get("erklaerung","")} for k in new_plan.get("kpis",[])],
                "diagramme": [{"titel": d.get("titel",""), "erklaerung": d.get("erklaerung","")} for d in new_plan.get("diagramme",[])],
            }
            write_output(new_plan, erklaerungen, rows, len(rows))
            result["updated_plan"] = new_plan

        return JSONResponse(result)

    except Exception as exc:
        return JSONResponse({"error": str(exc), "detail": traceback.format_exc()}, status_code=500)


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
