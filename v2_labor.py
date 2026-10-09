"""Futter v2 – Laborbericht lesen (Server-Texterkennung, nur nach Zustimmung).

Das hochgeladene PDF/Foto wird ausschliesslich im Arbeitsspeicher bzw. in einem temporären
Verzeichnis verarbeitet und sofort verworfen. Es wird nichts gespeichert und nichts protokolliert.
"""
import threading

from flask import jsonify, request

import labor_parser
from v2_api import v2, _rate_hit

OCR_CONSENT_VERSION = '2026-10-o1'
MAX_BYTES = 12 * 1024 * 1024
_gleichzeitig = threading.BoundedSemaphore(2)  # CPU schonen


@v2.route('/v2/api/labor/lesen', methods=['POST'])
def labor_lesen():
    _rate_hit('ocr', limit=30, window=3600)
    if request.headers.get('X-OCR-Consent') != OCR_CONSENT_VERSION:
        return jsonify({'error': 'CONSENT_REQUIRED', 'consentVersion': OCR_CONSENT_VERSION}), 400
    if (request.content_length or 0) > MAX_BYTES:
        return jsonify({'error': 'TOO_LARGE'}), 413
    daten = request.get_data(cache=False)
    if not daten or len(daten) > MAX_BYTES:
        return jsonify({'error': 'TOO_LARGE' if daten else 'LEER'}), 413 if daten else 400
    ist_pdf = daten[:5] == b'%PDF-'
    ist_bild = daten[:3] == b'\xff\xd8\xff' or daten[:8] == b'\x89PNG\r\n\x1a\n' or (daten[:4] == b'RIFF' and daten[8:12] == b'WEBP')
    if not (ist_pdf or ist_bild):
        return jsonify({'error': 'FORMAT'}), 415
    if not _gleichzeitig.acquire(timeout=60):
        return jsonify({'error': 'BESCHAEFTIGT'}), 503
    try:
        r = labor_parser.lesen(daten, 'x.pdf' if ist_pdf else 'x.img')
    except Exception:  # noqa: BLE001 – Inhalt nie protokollieren
        return jsonify({'error': 'NICHT_LESBAR'}), 422
    finally:
        _gleichzeitig.release()
        del daten
    resp = jsonify({'quelle': r['quelle'], 'werte': r['werte'], 'sicher': r.get('sicher', {}), 'zeilen': r.get('zeilen', {})})
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@v2.route('/v2/api/labor/config')
def labor_config():
    return jsonify({'consentVersion': OCR_CONSENT_VERSION})
