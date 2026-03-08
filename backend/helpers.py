"""helpers.py — CSV/DB/JSON-Hilfsfunktionen für AMAI Dash"""

import csv
import datetime
import decimal
import io
import json
import os
import re
import tempfile
from pathlib import Path

try:
    from sqlalchemy import create_engine, text as sql_text
    HAS_SQLALCHEMY = True
except ImportError:
    HAS_SQLALCHEMY = False


# ---------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------

def parse_csv(content: bytes, separator: str, skip_header: bool, encoding: str) -> list[dict]:
    sep = "\t" if separator == "tab" else separator
    text = content.decode(encoding)
    if skip_header:
        reader = csv.DictReader(io.StringIO(text), delimiter=sep)
        return [dict(row) for row in reader]
    else:
        reader = csv.reader(io.StringIO(text), delimiter=sep)
        all_rows = list(reader)
        if not all_rows:
            return []
        headers = [f"spalte_{i + 1}" for i in range(len(all_rows[0]))]
        return [dict(zip(headers, row)) for row in all_rows]


# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------

def serialize_rows(rows: list[dict]) -> list[dict]:
    """Convert date/datetime/Decimal so they can be JSON-serialised."""
    result = []
    for row in rows:
        new_row = {}
        for k, v in row.items():
            if isinstance(v, (datetime.datetime, datetime.date)):
                new_row[k] = v.isoformat()
            elif isinstance(v, decimal.Decimal):
                new_row[k] = float(v)
            else:
                new_row[k] = v
        result.append(new_row)
    return result


async def get_db_rows(connection_string: str | None, db_file, query: str) -> list[dict]:
    """Execute a SQL query and return rows as list[dict]."""
    if not HAS_SQLALCHEMY:
        raise RuntimeError(
            "SQLAlchemy ist nicht installiert. Bitte 'pip install sqlalchemy' ausführen."
        )
    tmp_path = None
    engine = None
    try:
        if db_file and getattr(db_file, "filename", None):
            content = await db_file.read()
            suffix = Path(db_file.filename).suffix or ".db"
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
            tmp.write(content)
            tmp.close()
            tmp_path = tmp.name
            conn_str = f"sqlite:///{tmp_path}"
        elif connection_string:
            conn_str = connection_string
        else:
            raise ValueError("Weder Datenbankdatei noch Verbindungsstring angegeben.")

        engine = create_engine(conn_str)
        with engine.connect() as conn:
            result = conn.execute(sql_text(query))
            columns = list(result.keys())
            return [dict(zip(columns, row)) for row in result.fetchall()]
    finally:
        if engine is not None:
            engine.dispose()
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# JSON / LLM response parsing
# ---------------------------------------------------------------------------

def extract_json(text: str) -> dict:
    """Parse JSON from an LLM response, stripping markdown fences."""
    text = re.sub(r"```(?:json)?", "", text).strip("`").strip()
    try:
        return json.loads(text)
    except Exception:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except Exception:
                pass
        raise ValueError(f"Kein gültiges JSON in der Modellantwort gefunden:\n{text[:400]}")


# ---------------------------------------------------------------------------
# Field-definitions inference
# ---------------------------------------------------------------------------

def auto_field_definitions(rows: list[dict]) -> dict:
    """Infer field definitions from data when no JSON file is provided."""
    if not rows:
        return {"felder": []}
    id_pattern = re.compile(r"(^id$|_id$|^nr$|nummer|number)", re.IGNORECASE)
    felder = []
    for name, value in rows[0].items():
        val_str = str(value) if value is not None else ""
        if id_pattern.search(name):
            typ = "id"
        else:
            try:
                float(val_str.replace(",", "."))
                typ = "numerisch"
            except ValueError:
                if re.match(r"\d{4}-\d{2}-\d{2}", val_str):
                    typ = "datum"
                else:
                    typ = "kategorie"
        felder.append({
            "name": name,
            "typ": typ,
            "beschreibung": name.replace("_", " ").capitalize(),
        })
    return {"felder": felder}
