from flask import Flask, render_template, request, jsonify, send_from_directory
import pandas as pd
import sqlite3
import json
import numpy as np
import csv
from datetime import datetime
import sys
import os
import shutil
from io import BytesIO
from werkzeug.utils import secure_filename
from PIL import Image

app = Flask(__name__)

# Pick up template changes without restarting the container.
# Can be disabled via AGFF_TEMPLATE_AUTO_RELOAD=0.
_template_auto_reload = os.getenv('AGFF_TEMPLATE_AUTO_RELOAD', '1').strip().lower() not in ('0', 'false', 'no')
app.config['TEMPLATES_AUTO_RELOAD'] = _template_auto_reload
app.jinja_env.auto_reload = _template_auto_reload

# --- KONFIGURATION ---
CSV_PATH = 'data/futterwerte.csv'
MACHINE_CSV_PATH = 'data/Rohdaten_Maschinen_Cleaned.csv'
DB_PATH = 'data/database.db'
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD')
PB_NEL = 3.14
PB_PROTEIN = 50
PHOTO_UPLOAD_DIR = 'data/probe_photos'
LAB_UPLOAD_DIR = 'data/labor_files'
ARCHIVE_ROOT_DIR = 'data/archive'
ARCHIVE_PHOTO_DIR = os.path.join(ARCHIVE_ROOT_DIR, 'probe_photos')
ARCHIVE_LAB_DIR = os.path.join(ARCHIVE_ROOT_DIR, 'labor_files')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}
MAX_UPLOAD_SIZE = 5 * 1024 * 1024
FIRST_CAPTURE_FIELDS = [
    'probe_lieferant', 'postleitzahl', 'hoehe_ueber_meer',
    'futterart',
    'aufwuchs_nr',
    'sorte',
    'gps_kultur', 'gps_leguminosenanteil',
    'silomais_kolbenanteil', 'silomais_powermais', 'silomais_schnitthoehe_50',
    'schnittdatum', 'chargenbeschreibung', 'geplante_verwertung',
    'probe_photo_datei', 'field_photo_datei', 'laboranalyse_datei', 'laboranalyse_dateien', 'laboranalyse_vorliegend'
]

os.makedirs(PHOTO_UPLOAD_DIR, exist_ok=True)
os.makedirs(LAB_UPLOAD_DIR, exist_ok=True)
os.makedirs(ARCHIVE_PHOTO_DIR, exist_ok=True)
os.makedirs(ARCHIVE_LAB_DIR, exist_ok=True)

# --- DATENBANK HELPER ---
def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _to_text_or_none(value):
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped else None
    return str(value)

def _load_first_capture_for_probe(cursor, probe_nr):
    cursor.execute("SELECT * FROM proben_ersterfassung WHERE probe_nr = ?", (probe_nr,))
    row = cursor.fetchone()
    if not row:
        return None
    data = {
        'probe_lieferant': row[1],
        'postleitzahl': row[2],
        'hoehe_ueber_meer': row[3],
        'futterart': row[15] if len(row) > 15 else None,
        'aufwuchs_nr': row[14] if len(row) > 14 else None,
        'sorte': row[16] if len(row) > 16 else None,
        'gps_kultur': row[17] if len(row) > 17 else None,
        'gps_leguminosenanteil': row[18] if len(row) > 18 else None,
        'silomais_kolbenanteil': row[19] if len(row) > 19 else None,
        'silomais_powermais': row[20] if len(row) > 20 else None,
        'silomais_schnitthoehe_50': row[21] if len(row) > 21 else None,
        'schnittdatum': row[4],
        'chargenbeschreibung': row[5],
        'geplante_verwertung': row[6],
        'probe_photo_datei': row[7],
        'field_photo_datei': row[22] if len(row) > 22 else None,
        'laboranalyse_datei': row[8],
        'laboranalyse_dateien': [],
        'laboranalyse_vorliegend': row[10],
        'erfasser_name': row[13] if len(row) > 13 else None
    }
    try:
        data['laboranalyse_dateien'] = json.loads(row[9]) if row[9] else []
    except:
        data['laboranalyse_dateien'] = []
    return data

def _upsert_first_capture(cursor, probe_nr, eingaben, erfasser_name):
    labor_dateien = eingaben.get('laboranalyse_dateien')
    if not isinstance(labor_dateien, list):
        labor_dateien = []

    normalized_erfasser = _to_text_or_none(erfasser_name)

    cursor.execute("SELECT erfasser_name FROM proben_ersterfassung WHERE probe_nr = ?", (probe_nr,))
    owner_row = cursor.fetchone()
    existing_owner = _to_text_or_none(owner_row[0]) if owner_row and len(owner_row) > 0 else None

    if existing_owner and normalized_erfasser and existing_owner != normalized_erfasser:
        return False, existing_owner

    payload = {
        'probe_lieferant': _to_text_or_none(eingaben.get('probe_lieferant')),
        'postleitzahl': _to_text_or_none(eingaben.get('postleitzahl')),
        'hoehe_ueber_meer': _to_text_or_none(eingaben.get('hoehe_ueber_meer')),
        'futterart': _to_text_or_none(eingaben.get('futterart')),
        'aufwuchs_nr': _to_text_or_none(eingaben.get('aufwuchs_nr')),
        'sorte': _to_text_or_none(eingaben.get('sorte')),
        'gps_kultur': _to_text_or_none(eingaben.get('gps_kultur')),
        'gps_leguminosenanteil': _to_text_or_none(eingaben.get('gps_leguminosenanteil')),
        'silomais_kolbenanteil': _to_text_or_none(eingaben.get('silomais_kolbenanteil')),
        'silomais_powermais': _to_text_or_none(eingaben.get('silomais_powermais')),
        'silomais_schnitthoehe_50': _to_text_or_none(eingaben.get('silomais_schnitthoehe_50')),
        'schnittdatum': _to_text_or_none(eingaben.get('schnittdatum')),
        'chargenbeschreibung': _to_text_or_none(eingaben.get('chargenbeschreibung')),
        'geplante_verwertung': _to_text_or_none(eingaben.get('geplante_verwertung')),
        'probe_photo_datei': _to_text_or_none(eingaben.get('probe_photo_datei')),
        'field_photo_datei': _to_text_or_none(eingaben.get('field_photo_datei')),
        'laboranalyse_datei': _to_text_or_none(eingaben.get('laboranalyse_datei')),
        'laboranalyse_dateien': json.dumps(labor_dateien),
        'laboranalyse_vorliegend': _to_text_or_none(eingaben.get('laboranalyse_vorliegend')),
    }

    has_any_value = any([
        payload['probe_lieferant'], payload['postleitzahl'], payload['hoehe_ueber_meer'],
        payload['futterart'],
        payload['aufwuchs_nr'],
        payload['sorte'],
        payload['gps_kultur'], payload['gps_leguminosenanteil'],
        payload['silomais_kolbenanteil'], payload['silomais_powermais'], payload['silomais_schnitthoehe_50'],
        payload['schnittdatum'], payload['chargenbeschreibung'], payload['geplante_verwertung'],
        payload['probe_photo_datei'], payload['field_photo_datei'], payload['laboranalyse_datei'], payload['laboranalyse_vorliegend'],
        bool(labor_dateien)
    ])
    if not has_any_value:
        return

    now = datetime.now().isoformat()
    owner_to_store = existing_owner or normalized_erfasser
    cursor.execute(
        '''INSERT INTO proben_ersterfassung (
            probe_nr, probe_lieferant, postleitzahl, hoehe_ueber_meer,
            schnittdatum, chargenbeschreibung, geplante_verwertung,
            probe_photo_datei, laboranalyse_datei, laboranalyse_dateien,
            laboranalyse_vorliegend, created_at, updated_at, erfasser_name, aufwuchs_nr,
            futterart, sorte, gps_kultur, gps_leguminosenanteil,
            silomais_kolbenanteil, silomais_powermais, silomais_schnitthoehe_50, field_photo_datei
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(probe_nr) DO UPDATE SET
            probe_lieferant = excluded.probe_lieferant,
            postleitzahl = excluded.postleitzahl,
            hoehe_ueber_meer = excluded.hoehe_ueber_meer,
            schnittdatum = excluded.schnittdatum,
            chargenbeschreibung = excluded.chargenbeschreibung,
            geplante_verwertung = excluded.geplante_verwertung,
            probe_photo_datei = excluded.probe_photo_datei,
            field_photo_datei = excluded.field_photo_datei,
            laboranalyse_datei = excluded.laboranalyse_datei,
            laboranalyse_dateien = excluded.laboranalyse_dateien,
            laboranalyse_vorliegend = excluded.laboranalyse_vorliegend,
            aufwuchs_nr = excluded.aufwuchs_nr,
            futterart = excluded.futterart,
            sorte = excluded.sorte,
            gps_kultur = excluded.gps_kultur,
            gps_leguminosenanteil = excluded.gps_leguminosenanteil,
            silomais_kolbenanteil = excluded.silomais_kolbenanteil,
            silomais_powermais = excluded.silomais_powermais,
            silomais_schnitthoehe_50 = excluded.silomais_schnitthoehe_50,
            updated_at = excluded.updated_at,
            erfasser_name = COALESCE(proben_ersterfassung.erfasser_name, excluded.erfasser_name)''',
        (
            probe_nr,
            payload['probe_lieferant'], payload['postleitzahl'], payload['hoehe_ueber_meer'],
            payload['schnittdatum'], payload['chargenbeschreibung'], payload['geplante_verwertung'],
            payload['probe_photo_datei'], payload['laboranalyse_datei'], payload['laboranalyse_dateien'],
            payload['laboranalyse_vorliegend'], now, now, owner_to_store, payload['aufwuchs_nr'],
            payload['futterart'], payload['sorte'], payload['gps_kultur'], payload['gps_leguminosenanteil'],
            payload['silomais_kolbenanteil'], payload['silomais_powermais'], payload['silomais_schnitthoehe_50'], payload['field_photo_datei']
        )
    )
    return True, owner_to_store

def _try_parse_json(value, fallback):
    if value in (None, ''):
        return fallback
    try:
        return json.loads(value)
    except:
        return fallback

def _sanitize_relative_upload_path(path_value):
    raw = (path_value or '').strip().replace('\\', '/')
    if not raw:
        return ''

    normalized = os.path.normpath(raw).replace('\\', '/')
    if normalized in ('', '.', '..'):
        return ''
    if normalized.startswith('../') or normalized.startswith('/'):
        return ''

    safe_parts = []
    for part in normalized.split('/'):
        if part in ('', '.', '..'):
            continue
        safe_part = secure_filename(part)
        if not safe_part:
            return ''
        safe_parts.append(safe_part)

    return '/'.join(safe_parts)

def _resolve_probe_subdir(probe_nr, fallback='probe'):
    probe = secure_filename((probe_nr or '').strip())
    return probe or secure_filename(fallback) or 'probe'

def _make_relative_upload_name(subdir, filename):
    clean_subdir = _sanitize_relative_upload_path(subdir)
    safe_filename = secure_filename(filename)
    if not safe_filename:
        return ''
    if clean_subdir:
        return f"{clean_subdir}/{safe_filename}"
    return safe_filename

def _collect_related_upload_files(cursor, probe_nr):
    photo_files = set()
    labor_files = set()

    # Upload references from first-capture table
    cursor.execute(
        "SELECT probe_photo_datei, laboranalyse_datei, laboranalyse_dateien FROM proben_ersterfassung WHERE probe_nr = ?",
        (probe_nr,)
    )
    row = cursor.fetchone()
    if row:
        probe_photo = (row[0] or '').strip()
        labor_single = (row[1] or '').strip()
        labor_multi = _try_parse_json(row[2], [])

        if probe_photo:
            photo_files.add(probe_photo)
        if labor_single:
            labor_files.add(labor_single)
        if isinstance(labor_multi, list):
            for entry in labor_multi:
                value = (entry or '').strip() if isinstance(entry, str) else str(entry).strip()
                if value:
                    labor_files.add(value)

    # Upload references from historical entries in main table
    cursor.execute("SELECT eingaben FROM proben WHERE probe_nr = ?", (probe_nr,))
    rows = cursor.fetchall()
    for row in rows:
        eingaben = _try_parse_json(row[0], {})
        if not isinstance(eingaben, dict):
            continue

        probe_photo = (eingaben.get('probe_photo_datei') or '').strip() if isinstance(eingaben.get('probe_photo_datei'), str) else ''
        field_photo = (eingaben.get('field_photo_datei') or '').strip() if isinstance(eingaben.get('field_photo_datei'), str) else ''
        labor_single = (eingaben.get('laboranalyse_datei') or '').strip() if isinstance(eingaben.get('laboranalyse_datei'), str) else ''
        labor_multi = eingaben.get('laboranalyse_dateien')

        if probe_photo:
            photo_files.add(probe_photo)
        if field_photo:
            photo_files.add(field_photo)
        if labor_single:
            labor_files.add(labor_single)

        if isinstance(labor_multi, list):
            for entry in labor_multi:
                value = (entry or '').strip() if isinstance(entry, str) else str(entry).strip()
                if value:
                    labor_files.add(value)

    return sorted(photo_files), sorted(labor_files)

def _move_file_to_archive(filename, source_dir, archive_dir, probe_nr):
    relative_name = _sanitize_relative_upload_path(filename)
    if not relative_name:
        return None

    source_path = os.path.join(source_dir, *relative_name.split('/'))
    if not os.path.exists(source_path):
        return None

    os.makedirs(archive_dir, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    source_basename = os.path.basename(relative_name)
    source_subdir = os.path.dirname(relative_name).replace('/', '_')
    base, ext = os.path.splitext(source_basename)
    probe_tag = secure_filename((probe_nr or '').strip()) or 'probe'
    subdir_tag = f"_{source_subdir}" if source_subdir else ''
    target_name = f"{probe_tag}_{timestamp}{subdir_tag}_{base}{ext}"
    target_path = os.path.join(archive_dir, target_name)

    shutil.move(source_path, target_path)
    return target_name

def _archive_uploads_for_probe(cursor, probe_nr):
    photo_files, labor_files = _collect_related_upload_files(cursor, probe_nr)
    moved = {'probe_photos': [], 'labor_files': []}

    for filename in photo_files:
        archived_name = _move_file_to_archive(filename, PHOTO_UPLOAD_DIR, ARCHIVE_PHOTO_DIR, probe_nr)
        if archived_name:
            moved['probe_photos'].append(archived_name)

    for filename in labor_files:
        archived_name = _move_file_to_archive(filename, LAB_UPLOAD_DIR, ARCHIVE_LAB_DIR, probe_nr)
        if archived_name:
            moved['labor_files'].append(archived_name)

    return moved

def _purge_probe_and_related_data(cursor, probe_nr):
    moved_files = _archive_uploads_for_probe(cursor, probe_nr)

    cursor.execute("DELETE FROM proben WHERE probe_nr = ?", (probe_nr,))
    deleted_proben = cursor.rowcount

    cursor.execute("DELETE FROM proben_ersterfassung WHERE probe_nr = ?", (probe_nr,))
    deleted_first_capture = cursor.rowcount

    cursor.execute("DELETE FROM probensammlungen WHERE probe_bezeichnung = ?", (probe_nr,))
    deleted_collections = cursor.rowcount

    return {
        'deleted_proben': deleted_proben,
        'deleted_proben_ersterfassung': deleted_first_capture,
        'deleted_probensammlungen': deleted_collections,
        'archived_probe_photos': len(moved_files['probe_photos']),
        'archived_labor_files': len(moved_files['labor_files'])
    }

def init_and_migrate_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # 1. Tabelle erstellen falls nicht da
    c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='proben'")
    if not c.fetchone():
        c.execute('''CREATE TABLE proben (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            probe_nr TEXT NOT NULL,
            beurteiler TEXT, datum TEXT, datum_tag TEXT, eingaben TEXT, ergebnisse TEXT, is_active INTEGER DEFAULT 1
        )''')
    else:
        # 2. Migration prüfen (falls altes Schema)
        c.execute("PRAGMA table_info(proben)")
        cols = [i[1] for i in c.fetchall()]
        if 'is_active' not in cols:
            print("DB Migration: Schema Update...", file=sys.stderr)
            try:
                c.execute("ALTER TABLE proben RENAME TO proben_old")
                c.execute('''CREATE TABLE proben (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    probe_nr TEXT NOT NULL,
                    beurteiler TEXT, datum TEXT, datum_tag TEXT, eingaben TEXT, ergebnisse TEXT, is_active INTEGER DEFAULT 1
                )''')
                c.execute("INSERT INTO proben (probe_nr, beurteiler, datum, datum_tag, eingaben, ergebnisse, is_active) SELECT probe_nr, beurteiler, datum, substr(datum, 1, 10), eingaben, ergebnisse, 1 FROM proben_old")
                c.execute("DROP TABLE proben_old")
                conn.commit()
            except Exception as e:
                print(f"DB Migration Error: {e}", file=sys.stderr)
                conn.rollback()
        c.execute("PRAGMA table_info(proben)")
        cols = [i[1] for i in c.fetchall()]
        if 'datum_tag' not in cols:
            c.execute("ALTER TABLE proben ADD COLUMN datum_tag TEXT")
        c.execute("UPDATE proben SET datum_tag = COALESCE(datum_tag, substr(datum, 1, 10)) WHERE datum_tag IS NULL OR datum_tag = ''")
    
    # Neue Tabelle für Probensammlungen erstellen
    c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='probensammlungen'")
    if not c.fetchone():
        c.execute('''CREATE TABLE probensammlungen (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            probe_bezeichnung TEXT NOT NULL,
            beurteiler_name TEXT NOT NULL,
            eigene_probe INTEGER NOT NULL,
            schnitt_nr INTEGER,
            schnittdatum TEXT,
            lagerort TEXT,
            menge_dt REAL,
            postleitzahl TEXT,
            hoehe_ueber_meer REAL,
            laboranalyse_vorliegend INTEGER,
            geplante_verwertung TEXT NOT NULL,
            erstellt_am TEXT NOT NULL,
            aktualisiert_am TEXT NOT NULL
        )''')
    else:
        c.execute("PRAGMA table_info(probensammlungen)")
        cols = [i[1] for i in c.fetchall()]
        if 'postleitzahl' not in cols:
            c.execute("ALTER TABLE probensammlungen ADD COLUMN postleitzahl TEXT")
        if 'hoehe_ueber_meer' not in cols:
            c.execute("ALTER TABLE probensammlungen ADD COLUMN hoehe_ueber_meer REAL")
        if 'laboranalyse_vorliegend' not in cols:
            c.execute("ALTER TABLE probensammlungen ADD COLUMN laboranalyse_vorliegend INTEGER")

    c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='proben_ersterfassung'")
    if not c.fetchone():
        c.execute('''CREATE TABLE proben_ersterfassung (
            probe_nr TEXT PRIMARY KEY,
            probe_lieferant TEXT,
            postleitzahl TEXT,
            hoehe_ueber_meer TEXT,
            schnittdatum TEXT,
            chargenbeschreibung TEXT,
            geplante_verwertung TEXT,
            probe_photo_datei TEXT,
            laboranalyse_datei TEXT,
            laboranalyse_dateien TEXT,
            laboranalyse_vorliegend TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            erfasser_name TEXT,
            aufwuchs_nr TEXT,
            futterart TEXT,
            sorte TEXT,
            gps_kultur TEXT,
            gps_leguminosenanteil TEXT,
            silomais_kolbenanteil TEXT,
            silomais_powermais TEXT,
            silomais_schnitthoehe_50 TEXT,
            field_photo_datei TEXT
        )''')
    else:
        c.execute("PRAGMA table_info(proben_ersterfassung)")
        cols = [i[1] for i in c.fetchall()]
        if 'erfasser_name' not in cols:
            c.execute("ALTER TABLE proben_ersterfassung ADD COLUMN erfasser_name TEXT")
        if 'aufwuchs_nr' not in cols:
            c.execute("ALTER TABLE proben_ersterfassung ADD COLUMN aufwuchs_nr TEXT")
        if 'futterart' not in cols:
            c.execute("ALTER TABLE proben_ersterfassung ADD COLUMN futterart TEXT")
        if 'sorte' not in cols:
            c.execute("ALTER TABLE proben_ersterfassung ADD COLUMN sorte TEXT")
        if 'gps_kultur' not in cols:
            c.execute("ALTER TABLE proben_ersterfassung ADD COLUMN gps_kultur TEXT")
        if 'gps_leguminosenanteil' not in cols:
            c.execute("ALTER TABLE proben_ersterfassung ADD COLUMN gps_leguminosenanteil TEXT")
        if 'silomais_kolbenanteil' not in cols:
            c.execute("ALTER TABLE proben_ersterfassung ADD COLUMN silomais_kolbenanteil TEXT")
        if 'silomais_powermais' not in cols:
            c.execute("ALTER TABLE proben_ersterfassung ADD COLUMN silomais_powermais TEXT")
        if 'silomais_schnitthoehe_50' not in cols:
            c.execute("ALTER TABLE proben_ersterfassung ADD COLUMN silomais_schnitthoehe_50 TEXT")
        if 'field_photo_datei' not in cols:
            c.execute("ALTER TABLE proben_ersterfassung ADD COLUMN field_photo_datei TEXT")
    conn.commit()
    conn.close()

# --- CSV LADEN (ROBUST) ---
df = pd.DataFrame()

def load_data():
    global df
    print(f"--- SERVER START: LADE CSV {CSV_PATH} ---", file=sys.stderr)
    try:
        # 1. Laden
        try:
            df = pd.read_csv(CSV_PATH, sep=';', decimal=',', encoding='utf-8-sig', dtype=str)
            if len(df.columns) < 2: raise ValueError
        except:
            print("Warnung: Semikolon fehlgeschlagen, versuche Komma...", file=sys.stderr)
            df = pd.read_csv(CSV_PATH, sep=',', decimal='.', encoding='utf-8-sig', dtype=str)

        # 2. Spalten bereinigen
        df.columns = [str(c).strip().lower() for c in df.columns]
        
        # 3. Rename Map
        rename_map = {}
        for col in df.columns:
            metric_key = str(col).split('[')[0].strip().lower()
            if metric_key == 'nel': rename_map[col] = 'nel'
            elif metric_key == 'nev': rename_map[col] = 'nev'
            elif metric_key == 'apde': rename_map[col] = 'apde'
            elif metric_key == 'apdn': rename_map[col] = 'apdn'
            elif ('tsv' in metric_key and 'mb3' in metric_key) or metric_key == 'tsv_mb3_extrahiert': rename_map[col] = 'tsv_mb3_extrahiert'
            elif metric_key in ('rp', 'rohprotein'): rename_map[col] = 'rp'
            elif metric_key in ('rf', 'rohfaser'): rename_map[col] = 'rf'
            elif metric_key == 'ndf': rename_map[col] = 'ndf'
            elif metric_key == 'adf': rename_map[col] = 'adf'
            elif metric_key == 'zucker': rename_map[col] = 'zucker'
            elif metric_key == 'vos': rename_map[col] = 'vos'
            elif metric_key in ('rohasche', 'ra'): rename_map[col] = 'ra'
            elif metric_key == 'ca': rename_map[col] = 'ca'
            elif metric_key == 'p': rename_map[col] = 'p'
            elif metric_key == 'mg': rename_map[col] = 'mg'
            elif metric_key == 'k': rename_map[col] = 'k'
            elif metric_key == 'na': rename_map[col] = 'na'
            elif metric_key == 'cl': rename_map[col] = 'cl'
            elif metric_key == 's': rename_map[col] = 's'
            elif metric_key == 'cu': rename_map[col] = 'cu'
            elif metric_key == 'fe': rename_map[col] = 'fe'
            elif metric_key == 'mn': rename_map[col] = 'mn'
            elif metric_key == 'zn': rename_map[col] = 'zn'
            elif metric_key == 'co': rename_map[col] = 'co'
            elif metric_key == 'se': rename_map[col] = 'se'
            # Keys
            elif 'aufwuchs' in col: rename_map[col] = 'aufwuchs'
            elif 'bestand' in col: rename_map[col] = 'bestand'
            elif 'stadium' in col: rename_map[col] = 'stadium'
            elif 'futterart' in col or 'konservierung' in col: rename_map[col] = 'futterart'

        df = df.rename(columns=rename_map)

        # --- FIX: DUPLIKATE ENTFERNEN ---
        df = df.loc[:, ~df.columns.duplicated()]

        # 4. SAFETY: Fehlende Spalten
        required_cols = ['nel', 'apde', 'apdn', 'nev', 'aufwuchs', 'bestand', 'stadium', 'futterart']
        for rc in required_cols:
            if rc not in df.columns:
                print(f"WARNUNG: Spalte '{rc}' fehlt! Erstelle leere Spalte.", file=sys.stderr)
                df[rc] = "0"

        # 5. Zahlen erzwingen
        num_cols = [
            'nel', 'nev', 'apde', 'apdn', 'tsv_mb3_extrahiert',
            'rp', 'rf', 'ndf', 'adf', 'zucker', 'vos', 'ra',
            'ca', 'p', 'mg', 'k', 'na', 'cl', 's',
            'cu', 'fe', 'mn', 'zn', 'co', 'se'
        ]
        for c in num_cols:
            if c in df.columns:
                df[c] = pd.to_numeric(df[c].astype(str).str.replace(',', '.', regex=False), errors='coerce').fillna(0.0)

        # 6. Keys generieren
        def map_aufwuchs(val):
            s = str(val).lower()
            return 'erster' if 'erster' in s or '1' in s else ('folge' if 'folge' in s else 'unknown')
        def map_konservierung(val):
            s = str(val).lower()
            if 'grün' in s: return 'greenfeed'
            if 'silage' in s: return 'silage'
            if 'dürr' in s or 'heu' in s: return 'hay'
            return 'unknown'

        df['key_aufwuchs'] = df['aufwuchs'].apply(map_aufwuchs)
        df['key_konservierung'] = df['futterart'].apply(map_konservierung)
        df['key_bestand'] = df['bestand'].astype(str).str.strip().str.upper()
        df['key_stadium'] = df['stadium'].astype(str).str.replace(r'\.0$', '', regex=True).str.strip()

        print(f"--- ERFOLG: {len(df)} Zeilen geladen. ---", file=sys.stderr)

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"CRITICAL CSV ERROR: {e}", file=sys.stderr)
        df = pd.DataFrame(columns=['key_aufwuchs', 'key_bestand', 'key_stadium', 'key_konservierung', 'nel'])

load_data()
init_and_migrate_db()

def _parse_float_or_zero(value):
    if value is None:
        return 0.0
    text = str(value).strip().replace(',', '.')
    if not text:
        return 0.0
    try:
        return float(text)
    except:
        return 0.0

def load_machine_catalog_grouped():
    path = os.path.join(app.root_path, MACHINE_CSV_PATH)
    if not os.path.exists(path):
        return {'categories': [], 'machines': []}

    categories_by_code = {}
    machines = []

    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f, delimiter=';')
        for row in reader:
            raw_code = (row.get('Code') or '').strip()
            if not raw_code.isdigit():
                continue

            code = int(raw_code)
            bezeichnung = (row.get('Bezeichnung') or '').strip()
            group_code = (code // 100) * 100

            if code % 100 == 0:
                categories_by_code[group_code] = bezeichnung or f'Kategorie {group_code}'
                continue

            kost = _parse_float_or_zero(row.get('Kosten_CHF_h'))
            sprit = _parse_float_or_zero(row.get('Treibstoff_CHF_h'))
            leistung = _parse_float_or_zero(row.get('Flaechenleistung_ha_h'))
            leistung_einheit = (row.get('Leistung_Einheit') or '').strip()

            # Keep all usable machine rows; placeholders with no name are ignored.
            if not bezeichnung:
                continue

            machines.append({
                'code': code,
                'groupCode': group_code,
                'groupLabel': '',
                'name': bezeichnung,
                'leist': leistung if leistung > 0 else 1.0,
                'leistRaw': leistung,
                'leistEinheit': leistung_einheit,
                'kost': kost,
                'sprit': sprit,
                'farbe': 'bg-slate-700 text-white'
            })

    for machine in machines:
        machine['groupLabel'] = categories_by_code.get(machine['groupCode'], f"Kategorie {machine['groupCode']}")

    categories = []
    for code in sorted(set(m['groupCode'] for m in machines)):
        items = [m for m in machines if m['groupCode'] == code]
        categories.append({
            'groupCode': code,
            'label': categories_by_code.get(code, f'Kategorie {code}'),
            'count': len(items)
        })

    machines.sort(key=lambda m: (m['groupCode'], m['code']))
    return {'categories': categories, 'machines': machines}

# --- ROUTEN ---
@app.route('/')
def index(): return render_template('index.html')

@app.route('/dashboard')
def dashboard(): return render_template('dashboard.html')

@app.route('/results')
def results_view(): return render_template('results.html')

@app.route('/foddercost')
@app.route('/foddercost.html')
@app.route('/futter/foddercost')
@app.route('/futter/foddercost.html')
def foddercost_view(): return render_template('foddercost.html')

@app.route('/stadien-pdf')
@app.route('/futter/stadien-pdf')
def stadien_pdf():
    data_dir = os.path.join(app.root_path, 'data')
    return send_from_directory(data_dir, 'Stadien.pdf')


@app.route('/stadium-image/<path:filename>')
@app.route('/futter/stadium-image/<path:filename>')
def stadium_image(filename):
    image_dir = os.path.join(app.root_path, 'data', 'stadium_images')
    safe_name = os.path.basename((filename or '').strip())
    if not safe_name:
        return jsonify({'error': 'Dateiname fehlt'}), 400
    return send_from_directory(image_dir, safe_name)

@app.route('/api/diagnose')
def diagnose():
    if df.empty: return jsonify({"status": "error", "msg": "DataFrame leer"})
    row = df.iloc[0].to_dict()
    for k, v in row.items():
        if isinstance(v, (np.float64, np.int64)): row[k] = float(v)
    return jsonify({"status": "ok", "cols": df.columns.tolist(), "sample": row})

@app.route('/api/machines/catalog')
@app.route('/futter/api/machines/catalog')
def machine_catalog():
    try:
        return jsonify({'status': 'ok', **load_machine_catalog_grouped()})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e), 'categories': [], 'machines': []}), 500

@app.route('/api/calculate', methods=['POST'])
def calculate():
    try:
        data = request.json
        req_aufwuchs = data.get('aufwuchs')
        req_bestand = data.get('bestand')
        req_stadium = str(data.get('stadium'))
        req_konservierung = data.get('konservierung')

        if 'key_aufwuchs' not in df.columns:
            return jsonify({"error": "Server Fehler: Such-Spalten fehlen."}), 500

        mask = (
            (df['key_aufwuchs'] == req_aufwuchs) &
            (df['key_bestand'] == req_bestand) &
            (df['key_stadium'] == req_stadium) &
            (df['key_konservierung'] == req_konservierung)
        )
        results = df[mask]

        if results.empty:
            return jsonify({"error": "Keine Daten gefunden", "filter": f"{req_aufwuchs}|{req_bestand}|{req_stadium}|{req_konservierung}"}), 404

        row = results.iloc[0]

        def g(k): 
            val = row.get(k, 0.0)
            return float(val) if not np.isnan(val) else 0.0

        basis = {
            'nel': g('nel'), 'apde': g('apde'), 'apdn': g('apdn'), 'nev': g('nev'),
            'rp': g('rp'), 'rf': g('rf'), 'ndf': g('ndf'), 'adf': g('adf'),
            'zucker': g('zucker'), 'vos': g('vos'), 'ra': g('ra'),
            'ca': g('ca'), 'p': g('p'), 'mg': g('mg'), 'k': g('k'), 'na': g('na'),
            'cl': g('cl'), 's': g('s'), 'cu': g('cu'), 'fe': g('fe'), 'mn': g('mn'),
            'zn': g('zn'), 'co': g('co'), 'se': g('se')
        }

        # KORREKTUREN
        k = data.get('korrekturen', [])
        f = {'nel': 1.0, 'apde': 1.0, 'apdn': 1.0}
        tsv_delta = 0.0

        if 'ts_low' in k: f['nel'] -= 0.01; f['apde'] -= 0.06
        if 'ts_high' in k: f['nel'] -= 0.01; f['apde'] += 0.06; f['apdn'] += 0.05
        if 'gaer_bad' in k: f['nel'] -= 0.02; f['apde'] -= 0.06; f['apdn'] -= 0.05; tsv_delta -= 1.0
        if 'gaer_vbad' in k: f['nel'] -= 0.05; f['apde'] -= 0.15; f['apdn'] -= 0.12; tsv_delta -= 2.0
        if 'nachgaer' in k: f['nel'] -= 0.04; f['apde'] -= 0.15; f['apdn'] -= 0.03; tsv_delta -= 1.0
        if 'boden' in k: f['nel'] -= 0.04; f['apde'] -= 0.03
        if 'regen_1' in k: f['nel'] -= 0.05; f['apde'] -= 0.08; f['apdn'] -= 0.02
        if 'regen_2' in k: f['nel'] -= 0.08; f['apde'] -= 0.15; f['apdn'] -= 0.03
        # HIER WAR DER FEHLER:
        if 'ueber_leicht' in k: f['apde'] += 0.03
        if 'ueber_stark' in k: f['nel'] -= 0.05; f['apde'] -= 0.01; f['apdn'] -= 0.02
        
        if 'check_ration_silage' in k: tsv_delta -= 1.0
        if 'check_ration_hay' in k: tsv_delta += 0.5

        eff = {
            'nel': basis['nel'] * f['nel'],
            'apde': basis['apde'] * f['apde'],
            'apdn': basis['apdn'] * f['apdn'],
            'nev': basis['nev'] * f['nel']
        }

        freie_korrektur = data.get('freieKorrektur')
        try:
            freie_korrektur = float(freie_korrektur) if freie_korrektur not in [None, ""] else 0.0
        except:
            freie_korrektur = 0.0
        if freie_korrektur:
            faktor = 1.0 + (freie_korrektur / 100.0)
            eff['nel'] *= faktor
            eff['apde'] *= faktor
            eff['apdn'] *= faktor
            eff['nev'] *= faktor

        try: kg = float(data.get('kuhGewicht') or 650)
        except: kg = 650.0

        nel_diff = (eff['nel'] - 5.6) / 0.1
        tsv_energy = nel_diff * 0.3
        tsv_weight = (kg - 650) / 10 * 0.1
        auto_tsv = 16.0 + tsv_energy + tsv_weight + tsv_delta
        if basis['nel'] == 0: auto_tsv = 0 

        tsv_ov = data.get('tsvOverride')
        try: final_tsv = float(tsv_ov) if tsv_ov and float(tsv_ov) > 0 else auto_tsv
        except: final_tsv = auto_tsv

        eb_nel = (0.293 * (kg ** 0.75)) * 1.1
        eb_prot = (3.25 * (kg ** 0.75)) * 1.1
        mpp_nel = ((eff['nel'] * final_tsv) - eb_nel) / PB_NEL
        mpp_apde = ((eff['apde'] * final_tsv) - eb_prot) / PB_PROTEIN
        mpp_apdn = ((eff['apdn'] * final_tsv) - eb_prot) / PB_PROTEIN
        
        mpp = max(0, min(mpp_nel, mpp_apde, mpp_apdn))
        limit = "NEL"
        if mpp_apde < mpp_nel and mpp_apde < mpp_apdn: limit = "APDE"
        if mpp_apdn < mpp_nel and mpp_apdn < mpp_apde: limit = "APDN"
        if basis['nel'] == 0: limit = "-"

        return jsonify({
            "basis": basis,
            "effektiv": eff,
            "tsv": final_tsv,
            "auto_tsv": auto_tsv,
            "csv_tsv_mb3": g('tsv_mb3_extrahiert'),
            "mpp": mpp,
            "mpp_nel": mpp_nel,
            "mpp_apde": mpp_apde,
            "mpp_apdn": mpp_apdn,
            "limit": limit
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/save', methods=['POST'])
def save_probe():
    data = request.json
    probe_nr = data.get('probeNr')
    beurteiler = data.get('beurteiler', '').strip()
    force_overwrite = data.get('forceOverwrite', False)

    if not probe_nr: return jsonify({"error": "Fehlende Probenummer"}), 400
    if not beurteiler: return jsonify({"error": "Bitte Beurteiler angeben"}), 400

    try:
        with sqlite3.connect(DB_PATH) as conn:
            c = conn.cursor()
            incoming_eingaben = data.get('eingaben') if isinstance(data.get('eingaben'), dict) else {}

            stored_first_capture = _load_first_capture_for_probe(c, probe_nr) or {}
            for field in FIRST_CAPTURE_FIELDS:
                incoming_value = incoming_eingaben.get(field)
                if incoming_value in (None, '') or (field == 'laboranalyse_dateien' and not incoming_value):
                    previous_value = stored_first_capture.get(field)
                    if previous_value not in (None, '') and not (field == 'laboranalyse_dateien' and not previous_value):
                        incoming_eingaben[field] = previous_value

            upsert_ok, _ = _upsert_first_capture(c, probe_nr, incoming_eingaben, beurteiler)
            if not upsert_ok and stored_first_capture:
                for field in FIRST_CAPTURE_FIELDS:
                    previous_value = stored_first_capture.get(field)
                    if previous_value not in (None, '') and not (field == 'laboranalyse_dateien' and not previous_value):
                        incoming_eingaben[field] = previous_value

            # Prüfen ob (Probe + Beurteiler + Aktiv) schon existiert
            c.execute("SELECT id, eingaben FROM proben WHERE probe_nr = ? AND beurteiler = ? AND is_active = 1", (probe_nr, beurteiler))
            existing = c.fetchone()

            if existing:
                if not force_overwrite:
                    return jsonify({"error": "DUPLICATE_ENTRY"}), 409
                else:
                    existing_eingaben = {}
                    try:
                        existing_eingaben = json.loads(existing[1]) if existing[1] else {}
                    except:
                        existing_eingaben = {}

                    for field in FIRST_CAPTURE_FIELDS:
                        incoming_value = incoming_eingaben.get(field)
                        if incoming_value in (None, '') or (field == 'laboranalyse_dateien' and not incoming_value):
                            previous_value = existing_eingaben.get(field)
                            if previous_value not in (None, '') and not (field == 'laboranalyse_dateien' and not previous_value):
                                incoming_eingaben[field] = previous_value

                    c.execute("UPDATE proben SET is_active = 0 WHERE id = ?", (existing[0],))
            
            now_ts = datetime.now().isoformat()
            now_date = now_ts[:10]
            c.execute("INSERT INTO proben (probe_nr, beurteiler, datum, datum_tag, eingaben, ergebnisse, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)",
                      (probe_nr, beurteiler, now_ts, now_date, json.dumps(incoming_eingaben), json.dumps(data.get('ergebnisse'))))
            conn.commit()
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/first_capture/<path:probe_nr>', methods=['GET'])
def get_first_capture(probe_nr):
    normalized_probe_nr = (probe_nr or '').strip()
    if not normalized_probe_nr:
        return jsonify({'error': 'Fehlende Probenummer'}), 400

    try:
        with sqlite3.connect(DB_PATH) as conn:
            c = conn.cursor()
            row = _load_first_capture_for_probe(c, normalized_probe_nr)
            if not row:
                return jsonify({'status': 'not_found'}), 404
            return jsonify({'status': 'ok', 'probeNr': normalized_probe_nr, 'data': row})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/uploads/<string:bucket>/<path:filename>', methods=['GET'])
def get_uploaded_file(bucket, filename):
    bucket_map = {
        'probe_photos': PHOTO_UPLOAD_DIR,
        'labor_files': LAB_UPLOAD_DIR,
    }
    upload_dir = bucket_map.get(bucket)
    if not upload_dir:
        return jsonify({'error': 'Ungültiger Upload-Bereich'}), 404

    relative_path = _sanitize_relative_upload_path(filename)
    if not relative_path:
        return jsonify({'error': 'Fehlender Dateiname'}), 400

    abs_dir = os.path.join(app.root_path, upload_dir)
    requested_dir = os.path.dirname(relative_path)
    safe_name = os.path.basename(relative_path)
    base_dir = os.path.join(abs_dir, requested_dir) if requested_dir else abs_dir
    return send_from_directory(base_dir, safe_name)

@app.route('/api/proben', methods=['GET'])
def get_all_proben():
    try:
        conn = get_db_connection()
        rows = conn.execute('SELECT * FROM proben WHERE is_active = 1 ORDER BY id DESC').fetchall()
        conn.close()
        data = []
        def konservierung_label(value):
            return {'greenfeed': 'Grünfutter', 'silage': 'Silage', 'hay': 'Dürrfutter'}.get(value, value)

        def derive_futterart(eingaben):
            raw = (eingaben.get('futterart') or '').strip() if isinstance(eingaben.get('futterart'), str) else ''
            if raw:
                return raw
            konservierung = eingaben.get('konservierung')
            if konservierung in {'greenfeed', 'silage', 'hay'}:
                return 'Wiesenfutter'
            return 'Unbekannt'

        for row in rows:
            try:
                eing = json.loads(row['eingaben'])
                erg = json.loads(row['ergebnisse'])
            except: eing, erg = {}, {}
            futterart = derive_futterart(eing)
            item = {
                'id': row['id'], 'probeNr': row['probe_nr'], 'beurteiler': row['beurteiler'], 'erstelltAm': row['datum'],
                'erstelltDatum': row['datum_tag'],
                'aufwuchs': eing.get('aufwuchs'), 'bestand': eing.get('bestand'), 'konservierung': eing.get('konservierung'),
                'konservierungLabel': konservierung_label(eing.get('konservierung')),
                'futterart': futterart, 'futterartLabel': futterart,
                'mpp': erg.get('mpp'), 'effektiveWerte': erg.get('effektiv', {}), 'automatischTSV': erg.get('auto_tsv'),
                'eingaben': eing, 'ergebnisse': erg
            }
            data.append(item)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/results/summary', methods=['GET'])
def results_summary():
    try:
        futterart = request.args.get('futterart', 'alle')

        conn = get_db_connection()
        rows = conn.execute('SELECT * FROM proben WHERE is_active = 1 ORDER BY id DESC').fetchall()
        conn.close()

        groups = {}
        def derive_futterart(eingaben):
            raw = (eingaben.get('futterart') or '').strip() if isinstance(eingaben.get('futterart'), str) else ''
            if raw:
                return raw
            konservierung = eingaben.get('konservierung')
            if konservierung in {'greenfeed', 'silage', 'hay'}:
                return 'Wiesenfutter'
            return 'Unbekannt'

        for row in rows:
            try:
                eing = json.loads(row['eingaben'])
                erg = json.loads(row['ergebnisse'])
            except:
                continue

            probe_nr = row['probe_nr']
            beurteiler = row['beurteiler']
            futterart_value = derive_futterart(eing)
            if futterart != 'alle' and futterart_value != futterart:
                continue

            eff = erg.get('effektiv', {})
            mpp = erg.get('mpp')

            if probe_nr not in groups:
                groups[probe_nr] = {
                    'probeNr': probe_nr,
                    'futterart': futterart_value,
                    'details': [],
                    'sum': {'nel': 0.0, 'apde': 0.0, 'apdn': 0.0, 'mpp': 0.0},
                    'count': 0
                }

            g = groups[probe_nr]
            def f(v):
                try:
                    return float(v)
                except:
                    return 0.0

            nel = f(eff.get('nel'))
            apde = f(eff.get('apde'))
            apdn = f(eff.get('apdn'))
            mpp_v = f(mpp)

            g['sum']['nel'] += nel
            g['sum']['apde'] += apde
            g['sum']['apdn'] += apdn
            g['sum']['mpp'] += mpp_v
            g['count'] += 1

            g['details'].append({
                'beurteiler': beurteiler,
                'datum': (row['datum_tag'] or (row['datum'][:10] if row['datum'] else '')),
                'nel': nel,
                'apde': apde,
                'apdn': apdn,
                'mpp': mpp_v
            })

        def label(k):
            return k or '-'

        result = []
        for k, g in groups.items():
            c = max(1, g['count'])
            result.append({
                'probeNr': g['probeNr'],
                'futterart': g['futterart'],
                'futterartLabel': label(g['futterart']),
                'avg': {
                    'nel': g['sum']['nel'] / c,
                    'apde': g['sum']['apde'] / c,
                    'apdn': g['sum']['apdn'] / c,
                    'mpp': g['sum']['mpp'] / c
                },
                'count': g['count'],
                'details': g['details']
            })

        return jsonify(sorted(result, key=lambda x: x['probeNr']))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def check_auth(): return bool(ADMIN_PASSWORD) and request.headers.get('X-Admin-Pass') == ADMIN_PASSWORD

@app.route('/api/samples/save', methods=['POST'])
def save_sample():
    """Speichert eine neue Probensammlung"""
    try:
        data = request.json
        
        # Validierung: Pflichtfelder
        required_fields = ['beurteiler_name', 'eigene_probe']
        for field in required_fields:
            if not data.get(field):
                return jsonify({"error": f"Pflichtfeld '{field}' fehlt"}), 400
        
        probe_bez = data.get('probe_bezeichnung', '').strip()
        beurteiler = data.get('beurteiler_name', '').strip()
        eigene_probe = 1 if data.get('eigene_probe') == 'ja' else 0
        schnitt_nr = data.get('schnitt_nr')
        schnittdatum = data.get('schnittdatum', '')
        lagerort = data.get('lagerort', '').strip()
        menge_dt = data.get('menge_dt')
        verwertung = data.get('geplante_verwertung', '').strip()
        postleitzahl = data.get('postleitzahl', '').strip()
        hoehe_ueber_meer = data.get('hoehe_ueber_meer')
        laboranalyse_vorliegend = 1 if data.get('laboranalyse_vorliegend') == 'ja' else 0
        
        # Pflichtfelder nur bei eigener Probe
        if eigene_probe == 1:
            if not postleitzahl:
                return jsonify({"error": "Pflichtfeld 'postleitzahl' fehlt"}), 400
            if not data.get('hoehe_ueber_meer'):
                return jsonify({"error": "Pflichtfeld 'hoehe_ueber_meer' fehlt"}), 400
            if data.get('laboranalyse_vorliegend') not in ['ja', 'nein']:
                return jsonify({"error": "Pflichtfeld 'laboranalyse_vorliegend' fehlt"}), 400
            if not verwertung:
                return jsonify({"error": "Pflichtfeld 'geplante_verwertung' fehlt"}), 400

        # Typkonvertierung
        try:
            if schnitt_nr: schnitt_nr = int(schnitt_nr)
            if menge_dt: menge_dt = float(menge_dt)
            if hoehe_ueber_meer: hoehe_ueber_meer = float(hoehe_ueber_meer)
        except ValueError:
            return jsonify({"error": "Ungültige Zahlenformate"}), 400
        
        now = datetime.now().isoformat()
        
        with sqlite3.connect(DB_PATH) as conn:
            c = conn.cursor()
            c.execute('''INSERT INTO probensammlungen 
                (probe_bezeichnung, beurteiler_name, eigene_probe, schnitt_nr, 
                 schnittdatum, lagerort, menge_dt, postleitzahl, hoehe_ueber_meer, laboranalyse_vorliegend,
                 geplante_verwertung, erstellt_am, aktualisiert_am)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (probe_bez, beurteiler, eigene_probe, schnitt_nr, schnittdatum, 
                 lagerort, menge_dt, postleitzahl, hoehe_ueber_meer, laboranalyse_vorliegend,
                 verwertung, now, now))
            conn.commit()
            sample_id = c.lastrowid
        
        return jsonify({"status": "ok", "id": sample_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/samples', methods=['GET'])
def get_samples():
    """Holt alle Probensammlungen"""
    try:
        conn = get_db_connection()
        rows = conn.execute('SELECT * FROM probensammlungen ORDER BY id DESC').fetchall()
        conn.close()
        
        data = []
        for row in rows:
            data.append({
                'id': row['id'],
                'probe_bezeichnung': row['probe_bezeichnung'],
                'beurteiler_name': row['beurteiler_name'],
                'eigene_probe': 'ja' if row['eigene_probe'] else 'nein',
                'schnitt_nr': row['schnitt_nr'],
                'schnittdatum': row['schnittdatum'],
                'lagerort': row['lagerort'],
                'menge_dt': row['menge_dt'],
                'postleitzahl': row['postleitzahl'],
                'hoehe_ueber_meer': row['hoehe_ueber_meer'],
                'laboranalyse_vorliegend': 'ja' if row['laboranalyse_vorliegend'] else 'nein',
                'geplante_verwertung': row['geplante_verwertung'],
                'erstellt_am': row['erstellt_am']
            })
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/samples/export', methods=['GET'])
def export_samples():
    """Exportiert alle Probensammlungen als CSV"""
    try:
        conn = get_db_connection()
        rows = conn.execute('SELECT * FROM probensammlungen ORDER BY id DESC').fetchall()
        conn.close()
        
        # DataFrame erstellen
        import csv
        from io import StringIO
        
        output = StringIO()
        fieldnames = ['ID', 'Probe-Bezeichnung', 'Name Beurteiler', 'Eigene Probe', 
                  'Postleitzahl', 'Höhe über Meer', 'Schnittdatum', 'Laboranalyse vorliegend',
                  'Schnitt Nr.', 'Lagerort', 'Menge (dt)', 
                  'Geplante Verwertung', 'Erstellt am']
        writer = csv.DictWriter(output, fieldnames=fieldnames, delimiter=';')
        writer.writeheader()
        
        for row in rows:
            writer.writerow({
                'ID': row['id'],
                'Probe-Bezeichnung': row['probe_bezeichnung'],
                'Name Beurteiler': row['beurteiler_name'],
                'Eigene Probe': 'ja' if row['eigene_probe'] else 'nein',
                'Postleitzahl': row['postleitzahl'] or '',
                'Höhe über Meer': row['hoehe_ueber_meer'] or '',
                'Schnittdatum': row['schnittdatum'] or '',
                'Laboranalyse vorliegend': 'ja' if row['laboranalyse_vorliegend'] else 'nein',
                'Schnitt Nr.': row['schnitt_nr'] or '',
                'Lagerort': row['lagerort'] or '',
                'Menge (dt)': row['menge_dt'] or '',
                'Geplante Verwertung': row['geplante_verwertung'],
                'Erstellt am': row['erstellt_am']
            })
        
        from flask import make_response
        response = make_response(output.getvalue())
        response.headers['Content-Disposition'] = 'attachment; filename=probensammlungen.csv'
        response.headers['Content-Type'] = 'text/csv; charset=utf-8'
        return response
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/admin/verify', methods=['POST'])
def verify_admin():
    if not check_auth():
        return jsonify({"error": "Auth"}), 401
    return jsonify({"ok": True})

@app.route('/api/admin/delete', methods=['POST'])
def delete_p():
    if not check_auth():
        return jsonify({"error": "Auth"}), 401

    probe_nr = ((request.json or {}).get('probeNr') or '').strip()
    if not probe_nr:
        return jsonify({"error": "Fehlende Probenummer"}), 400

    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        result = _purge_probe_and_related_data(c, probe_nr)
        conn.commit()

    return jsonify({"status": "ok", "probeNr": probe_nr, **result})

@app.route('/api/admin/delete_by_id', methods=['POST'])
def delete_p_by_id():
    if not check_auth():
        return jsonify({"error": "Auth"}), 401
    row_id = (request.json or {}).get('id')
    if not row_id:
        return jsonify({"error": "Fehlende ID"}), 400

    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        c.execute("SELECT probe_nr FROM proben WHERE id = ?", (row_id,))
        row = c.fetchone()
        if not row:
            return jsonify({"error": "Datensatz nicht gefunden"}), 404

        probe_nr = (row[0] or '').strip()
        if not probe_nr:
            return jsonify({"error": "Ungültige Probenummer"}), 400

        result = _purge_probe_and_related_data(c, probe_nr)
        conn.commit()

    return jsonify({"status": "ok", "probeNr": probe_nr, **result})

@app.route('/api/admin/archive', methods=['POST'])
def archive_p():
    if not check_auth():
        return jsonify({"error": "Auth"}), 401
    row_id = (request.json or {}).get('id')
    if not row_id:
        return jsonify({"error": "Fehlende ID"}), 400
    with sqlite3.connect(DB_PATH) as c:
        c.execute("UPDATE proben SET is_active = 0 WHERE id = ?", (row_id,))
        c.commit()
    return jsonify({"status": "ok"})

@app.route('/api/admin/prefix', methods=['POST'])
def prefix_p():
    if not check_auth(): return jsonify({"error":"Auth"}), 401
    act = request.json.get('action'); pre = request.json.get('prefix')
    old_pre = request.json.get('oldPrefix')
    with sqlite3.connect(DB_PATH) as conn:
        c = conn.cursor()
        if act == 'add': c.execute("UPDATE proben SET probe_nr = ? || probe_nr WHERE probe_nr NOT LIKE ?", (pre, f"{pre}%"))
        elif act == 'remove':
            rows = c.execute("SELECT id, probe_nr FROM proben WHERE probe_nr LIKE ?", (f"{pre}%",)).fetchall()
            for r in rows: c.execute("UPDATE proben SET probe_nr = ? WHERE id = ?", (r['probe_nr'][len(pre):], r['id']))
        elif act == 'swap':
            rows = c.execute("SELECT id, probe_nr FROM proben WHERE probe_nr LIKE ?", (f"{old_pre}%",)).fetchall()
            for r in rows: c.execute("UPDATE proben SET probe_nr = ? WHERE id = ?", (pre + r['probe_nr'][len(old_pre):], r['id']))
        conn.commit()
    return jsonify({"status":"ok"})

@app.route('/api/admin/update', methods=['POST'])
def update_p():
    if not check_auth(): return jsonify({"error":"Auth"}), 401
    payload = request.json or {}
    row_id = payload.get('id')
    if not row_id:
        return jsonify({"error": "Fehlende ID"}), 400

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        row = c.execute("SELECT * FROM proben WHERE id = ?", (row_id,)).fetchone()
        if not row:
            return jsonify({"error": "Probe nicht gefunden"}), 404

        probe_nr = (payload.get('probeNr') or row['probe_nr']).strip()
        beurteiler = (payload.get('beurteiler') or row['beurteiler'] or '').strip()
        datum = (payload.get('datum') or row['datum'] or '').strip()
        datum_tag = (payload.get('datumTag') or row['datum_tag'] or '').strip()
        if not datum_tag and datum:
            datum_tag = datum[:10]

        eingaben = payload.get('eingaben')
        ergebnisse = payload.get('ergebnisse')
        try:
            if isinstance(eingaben, str):
                eingaben = json.loads(eingaben or '{}')
            if isinstance(ergebnisse, str):
                ergebnisse = json.loads(ergebnisse or '{}')
        except Exception:
            return jsonify({"error": "Ungültiges JSON"}), 400

        c.execute(
            "UPDATE proben SET probe_nr = ?, beurteiler = ?, datum = ?, datum_tag = ?, eingaben = ?, ergebnisse = ? WHERE id = ?",
            (probe_nr, beurteiler, datum, datum_tag, json.dumps(eingaben or {}), json.dumps(ergebnisse or {}), row_id)
        )

        # Keep first-capture table in sync with edited probe info fields.
        upsert_ok, existing_owner = _upsert_first_capture(c, probe_nr, eingaben or {}, beurteiler)
        if not upsert_ok and existing_owner:
            _upsert_first_capture(c, probe_nr, eingaben or {}, existing_owner)
        conn.commit()

    return jsonify({"status": "ok"})

@app.route('/api/admin/rename', methods=['POST'])
def rename_p():
    if not check_auth(): return jsonify({"error":"Auth"}), 401
    old_probe = (request.json.get('oldProbe') or '').strip()
    new_probe = (request.json.get('newProbe') or '').strip()
    if not old_probe or not new_probe:
        return jsonify({"error": "Fehlende Eingaben"}), 400
    if old_probe == new_probe:
        return jsonify({"error": "Alt und Neu sind identisch"}), 400
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        exists_old = c.execute("SELECT COUNT(1) AS cnt FROM proben WHERE probe_nr = ?", (old_probe,)).fetchone()
        if not exists_old or exists_old['cnt'] == 0:
            return jsonify({"error": "Alte Probe nicht gefunden"}), 404
        exists_new = c.execute("SELECT COUNT(1) AS cnt FROM proben WHERE probe_nr = ?", (new_probe,)).fetchone()
        if exists_new and exists_new['cnt'] > 0:
            return jsonify({"error": "Neue Probe existiert bereits"}), 409
        c.execute("UPDATE proben SET probe_nr = ? WHERE probe_nr = ?", (new_probe, old_probe))
        conn.commit()
    return jsonify({"status":"ok"})

def _allowed_file(filename, allow_pdf=False):
    if '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    allowed = set(ALLOWED_EXTENSIONS)
    if allow_pdf:
        allowed.add('pdf')
    return ext in allowed

def _save_uploaded_file(file, upload_dir, fallback_stem='upload', allow_pdf=False, image_to_pdf=False):
    if not file or file.filename == '':
        raise ValueError('Keine Datei ausgewählt')
    if not _allowed_file(file.filename, allow_pdf=allow_pdf):
        raise ValueError('Ungültiger Dateityp')

    file.seek(0, os.SEEK_END)
    size = file.tell()
    file.seek(0)
    if size > MAX_UPLOAD_SIZE:
        raise ValueError('Datei zu gross (max. 5MB)')

    safe_original = secure_filename(file.filename)
    ext = safe_original.rsplit('.', 1)[1].lower()
    probe_subdir = _resolve_probe_subdir(request.form.get('probeNr'), fallback=fallback_stem)
    stem = probe_subdir or secure_filename(fallback_stem) or 'upload'
    unique = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    target_dir = os.path.join(upload_dir, probe_subdir)
    os.makedirs(target_dir, exist_ok=True)

    if ext == 'pdf':
        final_name = f"{stem}_{unique}.pdf"
        final_path = os.path.join(target_dir, final_name)
        file.save(final_path)
        return _make_relative_upload_name(probe_subdir, final_name)

    temp_name = f"tmp_{stem}_{unique}.{ext}"
    temp_path = os.path.join(target_dir, temp_name)
    file.save(temp_path)

    final_extension = 'pdf' if image_to_pdf else 'webp'
    final_name = f"{stem}_{unique}.{final_extension}"
    final_path = os.path.join(target_dir, final_name)
    try:
        with Image.open(temp_path) as img:
            if image_to_pdf:
                if img.mode == 'RGBA':
                    bg = Image.new('RGB', img.size, (255, 255, 255))
                    bg.paste(img, mask=img.split()[-1])
                    img = bg
                elif img.mode != 'RGB':
                    img = img.convert('RGB')

                webp_buffer = BytesIO()
                img.save(webp_buffer, 'WEBP', quality=80)
                webp_buffer.seek(0)

                with Image.open(webp_buffer) as webp_img:
                    pdf_ready = webp_img.convert('RGB')
                    pdf_ready.save(final_path, 'PDF', resolution=150.0)
            else:
                if img.mode not in ('RGB', 'RGBA'):
                    img = img.convert('RGB')
                img.save(final_path, 'WEBP', quality=80)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    return _make_relative_upload_name(probe_subdir, final_name)

@app.route('/api/probe_photo_upload', methods=['POST'])
def upload_probe_photo():
    try:
        if 'probe_photo' not in request.files:
            return jsonify({'error': 'Dateifeld probe_photo fehlt'}), 400
        filename = _save_uploaded_file(
            file=request.files['probe_photo'],
            upload_dir=PHOTO_UPLOAD_DIR,
            fallback_stem='probe',
            allow_pdf=False
        )
        return jsonify({'status': 'ok', 'filename': filename})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/field_photo_upload', methods=['POST'])
def upload_field_photo():
    try:
        if 'field_photo' not in request.files:
            return jsonify({'error': 'Dateifeld field_photo fehlt'}), 400
        filename = _save_uploaded_file(
            file=request.files['field_photo'],
            upload_dir=PHOTO_UPLOAD_DIR,
            fallback_stem='feldfoto',
            allow_pdf=False
        )
        return jsonify({'status': 'ok', 'filename': filename})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/labor_file_upload', methods=['POST'])
def upload_labor_file():
    try:
        if 'laboranalyse_file' not in request.files:
            return jsonify({'error': 'Dateifeld laboranalyse_file fehlt'}), 400
        camera_capture = (request.form.get('camera_capture') or '').strip().lower() in ('1', 'true', 'yes', 'ja')
        filename = _save_uploaded_file(
            file=request.files['laboranalyse_file'],
            upload_dir=LAB_UPLOAD_DIR,
            fallback_stem='laboranalyse',
            allow_pdf=True,
            image_to_pdf=camera_capture
        )
        return jsonify({'status': 'ok', 'filename': filename})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# --- STATISTIKEN ---
STATS_FILE = 'data/stats.json'

def load_stats():
    """Lade oder erstelle Statistik-Datei"""
    if os.path.exists(STATS_FILE):
        try:
            with open(STATS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {'calculations': []}
    return {'calculations': []}

def save_stats(stats):
    """Speichere Statistiken"""
    os.makedirs(os.path.dirname(STATS_FILE), exist_ok=True)
    with open(STATS_FILE, 'w', encoding='utf-8') as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)

@app.route('/api/stats/record', methods=['POST'])
def record_calculation_stat():
    """Speichere eine Berechnung in den Statistiken"""
    try:
        data = request.get_json() or {}
        konservierung = data.get('konservierung', 'unknown')
        stats = load_stats()
        stats['calculations'].append({
            'timestamp': datetime.now().isoformat(),
            'konservierung': konservierung,
            'user_agent': request.headers.get('User-Agent', '')
        })
        save_stats(stats)
        return jsonify({'status': 'ok'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Gebe Statistiken zurück (mit Passwort-Schutz)"""
    password = request.args.get('pwd', '')
    if not ADMIN_PASSWORD or password != ADMIN_PASSWORD:
        return jsonify({'error': 'Unauthorized'}), 401
    
    stats = load_stats()
    calculations = stats.get('calculations', [])
    
    # Aggregation nach Konservierung
    by_type = {}
    by_date = {}
    
    for calc in calculations:
        konservierung = calc.get('konservierung', 'unknown')
        timestamp = calc.get('timestamp', '')
        date = timestamp.split('T')[0] if timestamp else 'unknown'
        
        by_type[konservierung] = by_type.get(konservierung, 0) + 1
        by_date[date] = by_date.get(date, 0) + 1
    
    return jsonify({
        'total': len(calculations),
        'by_type': by_type,
        'by_date': by_date,
        'recent': calculations[-20:] if calculations else []
    })

# --- DUPLICATE ROUTES FOR /futter/ PREFIX ---
@app.route('/futter/api/stats/record', methods=['POST'])
def futter_record_calculation_stat():
    return record_calculation_stat()

@app.route('/futter/api/stats', methods=['GET'])
def futter_get_stats():
    return get_stats()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
