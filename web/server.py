#!/usr/bin/env python3
"""Web server that visualises the apartment thermostat and sensor readings.

The apartment is described by ``layout.txt``: the numbers ``1``-``9`` are the
radiator thermostats, the letters ``A``-``D`` are the temperature/humidity
sensors. This module reads the device measurements from PostgreSQL (configured
via ``DATABASE_URL`` or ``POSTGRES_*`` environment variables), with support for
SQLite or ``db.json`` fallback for local development.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus, urlparse

try:
    import psycopg
except ImportError:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]

_LOGGER = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
STATIC_DIR = BASE_DIR / "static"
DB_JSON_PATH = Path(os.environ.get("TEMPS_DB", ROOT_DIR / "db.json"))
HOST = os.environ.get("TEMPS_HOST", "0.0.0.0")
PORT = int(os.environ.get("TEMPS_PORT", "8000"))
MAX_SNAPSHOTS = int(os.environ.get("TEMPS_MAX_SNAPSHOTS", "288"))  # 24h at 5-min intervals

# Layout slot -> (device kind, human readable room, location label, MAC address).
SLOTS: dict[str, dict[str, str]] = {
    # Radiators (thermostats), numbers 1-9.
    "1": {"kind": "thermostat", "room": "Bad Groß", "location": "Bad Groß", "mac": "DC:62:79:90:73:AD"},
    "2": {"kind": "thermostat", "room": "Küche", "location": "Küche", "mac": "B0:19:21:1B:A7:40"},
    "3": {"kind": "thermostat", "room": "Wohnzimmer", "location": "Wohnzimmer Links", "mac": "3C:64:CF:62:BA:DF"},
    "4": {"kind": "thermostat", "room": "Wohnzimmer", "location": "Wohnzimmer Rechts", "mac": "B0:19:21:1B:A4:BC"},
    "5": {"kind": "thermostat", "room": "Schlafzimmer", "location": "Schlafzimmer", "mac": "3C:64:CF:62:96:B6"},
    "6": {"kind": "thermostat", "room": "Arbeitszimmer", "location": "Arbeitszimmer", "mac": "30:DE:4B:A9:88:6B"},
    # "Links"/"Rechts" are named from the point of view when entering from the
    # Flur, so the physically left device (slot 7) is the right-hand one.
    "7": {"kind": "thermostat", "room": "Gästezimmer", "location": "Gästezimmer Rechts", "mac": "DC:62:79:90:73:1B"},
    "8": {"kind": "thermostat", "room": "Gästezimmer", "location": "Gästezimmer Links", "mac": "DC:62:79:71:3B:CF"},
    "9": {"kind": "thermostat", "room": "Bad Klein", "location": "Bad Klein", "mac": "DC:62:79:90:75:F2"},
    # Temperature/humidity sensors, letters A-D.
    "A": {"kind": "sensor", "room": "Küche", "location": "Küche", "mac": "DC:62:79:54:B9:E2"},
    "B": {"kind": "sensor", "room": "Wohnzimmer", "location": "Wohnzimmer", "mac": "8C:90:2D:50:35:B4"},
    "C": {"kind": "sensor", "room": "Arbeitszimmer", "location": "Arbeitszimmer", "mac": "0C:EF:15:D9:6D:DD"},
    "D": {"kind": "sensor", "room": "Gästezimmer", "location": "Gästezimmer", "mac": "0C:EF:15:F7:A7:AE"},
}

# Lookup tables: MAC -> slot and (kind, location) -> slot.
MAC_LOOKUP = {meta["mac"].upper(): slot for slot, meta in SLOTS.items() if "mac" in meta}
LOOKUP = {(meta["kind"], meta["location"]): slot for slot, meta in SLOTS.items()}


def normalize_mac(mac: Any) -> str | None:
    if not mac or not isinstance(mac, str):
        return None
    clean = mac.replace(":", "").replace("-", "").strip().upper()
    if len(clean) == 12:
        return ":".join(clean[i : i + 2] for i in range(0, 12, 2))
    return mac.strip().upper()


def infer_kind(device_type: str | None, model: str | None, target_temp: Any, humidity: Any) -> str:
    dt = (device_type or "").lower()
    mdl = (model or "").upper()
    if "thermostat" in dt or mdl.startswith("KE"):
        return "thermostat"
    if "sensor" in dt or mdl.startswith("T31") or humidity is not None:
        return "sensor"
    if target_temp is not None:
        return "thermostat"
    return "sensor"


def resolve_slot(reading: dict[str, Any]) -> str | None:
    mac = normalize_mac(reading.get("mac"))
    if mac and mac in MAC_LOOKUP:
        return MAC_LOOKUP[mac]
    return LOOKUP.get((reading.get("kind"), reading.get("location")))


def resolve_db_dsn() -> str | None:
    """Return the configured PostgreSQL DSN or SQLite path, if any."""
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    pg_host = os.environ.get("POSTGRES_HOST")
    # Treat any POSTGRES_* setting as intent to use PostgreSQL. This lets a
    # local .env that only defines credentials connect to localhost instead of
    # silently falling back to db.json.
    pg_configured = any(
        os.environ.get(key)
        for key in ("POSTGRES_HOST", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB")
    )
    if pg_host or pg_configured:
        user = quote_plus(os.environ.get("POSTGRES_USER", "temps"))
        password = quote_plus(os.environ.get("POSTGRES_PASSWORD", "temps"))
        port = os.environ.get("POSTGRES_PORT", "5432")
        dbname = os.environ.get("POSTGRES_DB", "temps")
        host = pg_host or "localhost"
        return f"postgresql://{user}:{password}@{host}:{port}/{dbname}"
    temps_db = os.environ.get("TEMPS_DB", "")
    if temps_db.startswith(("postgres://", "postgresql://")) or temps_db.endswith((".db", ".sqlite", ".sqlite3")):
        return temps_db
    return None


def mask_dsn(dsn: str) -> str:
    try:
        parsed = urlparse(dsn)
        if parsed.scheme.startswith("postgres") and parsed.hostname:
            user = f"{parsed.username}@" if parsed.username else ""
            port = f":{parsed.port}" if parsed.port else ""
            return f"{parsed.scheme}://{user}{parsed.hostname}{port}{parsed.path}"
    except Exception:  # noqa: BLE001
        pass
    return dsn


def iter_snapshots(text: str):
    """Yield snapshots (each a list of device readings) from raw file text."""
    text = text.strip()
    if not text:
        return
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        for line in text.splitlines():
            line = line.strip()
            if line:
                yield json.loads(line)
        return

    if isinstance(data, list) and data and all(isinstance(row, list) for row in data):
        yield from data
    elif isinstance(data, list):
        yield data


def _rows_to_snapshots(rows: list[tuple[Any, ...]]) -> tuple[list[list[dict[str, Any]]], list[str], float | None]:
    """Group joined (devices, readings) rows by collected_at into snapshots."""
    by_timestamp: dict[str, list[dict[str, Any]]] = {}
    latest_epoch: float | None = None

    for (
        device_id,
        alias,
        model,
        mac,
        device_type,
        room_location,
        parent_device_id,
        collected_at,
        is_on,
        mode,
        current_temp,
        target_temp,
        humidity,
        battery,
        rssi,
        data_json,
    ) in rows:
        if isinstance(collected_at, datetime):
            ts_str = collected_at.isoformat()
            epoch = collected_at.timestamp()
        else:
            ts_str = str(collected_at)
            try:
                epoch = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).timestamp()
            except ValueError:
                epoch = None

        if epoch is not None and (latest_epoch is None or epoch > latest_epoch):
            latest_epoch = epoch

        norm_mac = normalize_mac(mac)
        slot = MAC_LOOKUP.get(norm_mac) if norm_mac else None
        kind = SLOTS[slot]["kind"] if slot else infer_kind(device_type, model, target_temp, humidity)
        location = (
            room_location
            or (SLOTS[slot]["location"] if slot else None)
            or alias
        )

        # Fallback: extract location or parent from data_json if stored there
        extra: dict[str, Any] = {}
        if isinstance(data_json, dict):
            extra = data_json
        elif isinstance(data_json, str) and data_json:
            try:
                extra = json.loads(data_json)
            except json.JSONDecodeError:
                extra = {}

        if not location and isinstance(extra.get("location"), str):
            location = extra["location"]
        parent_label = extra.get("parent_alias") or extra.get("parent") or parent_device_id

        reading = {
            "kind": kind,
            "name": alias or extra.get("name"),
            "model": model or extra.get("model"),
            "device_id": device_id,
            "location": location,
            "mac": norm_mac,
            "parent": parent_label,
            "on": None if is_on is None else bool(is_on),
            "mode": mode,
            "temperature": float(current_temp) if current_temp is not None else None,
            "target_temperature": float(target_temp) if target_temp is not None else None,
            "humidity": float(humidity) if humidity is not None else None,
            "battery": int(battery) if battery is not None else None,
            "rssi": int(rssi) if rssi is not None else None,
            "collected_at": ts_str,
        }
        by_timestamp.setdefault(ts_str, []).append(reading)

    timestamps = list(by_timestamp.keys())
    if MAX_SNAPSHOTS > 0 and len(timestamps) > MAX_SNAPSHOTS:
        timestamps = timestamps[-MAX_SNAPSHOTS:]
    snapshots = [by_timestamp[ts] for ts in timestamps]
    return snapshots, timestamps, latest_epoch


def load_from_postgres(dsn: str) -> tuple[list[list[dict[str, Any]]], list[str], float | None]:
    if psycopg is None:
        raise RuntimeError("psycopg is not installed")

    query = """
        SELECT
            d.device_id,
            d.alias,
            d.model,
            d.mac,
            d.device_type,
            d.room_location,
            d.parent_device_id,
            r.collected_at,
            r.is_on,
            r.mode,
            r.current_temp,
            r.target_temp,
            r.humidity,
            r.battery,
            r.rssi,
            r.data_json
        FROM readings r
        JOIN devices d ON d.device_id = r.device_id
        WHERE r.collected_at IN (
            SELECT DISTINCT collected_at
            FROM readings
            ORDER BY collected_at DESC
            LIMIT %s
        )
        ORDER BY r.collected_at ASC, r.id ASC
    """
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS devices (
                    device_id        TEXT PRIMARY KEY,
                    alias            TEXT,
                    model            TEXT,
                    mac              TEXT,
                    device_type      TEXT,
                    room_location    TEXT,
                    parent_device_id TEXT,
                    first_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_seen        TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                ALTER TABLE devices ADD COLUMN IF NOT EXISTS room_location TEXT;
                CREATE TABLE IF NOT EXISTS readings (
                    id              BIGSERIAL PRIMARY KEY,
                    device_id       TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
                    collected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    is_on           BOOLEAN,
                    mode            TEXT,
                    current_temp    DOUBLE PRECISION,
                    target_temp     DOUBLE PRECISION,
                    humidity        DOUBLE PRECISION,
                    battery         INTEGER,
                    rssi            INTEGER,
                    current_power_w DOUBLE PRECISION,
                    location_lat    DOUBLE PRECISION,
                    location_lon    DOUBLE PRECISION,
                    data_json       JSONB
                );
                """
            )
            conn.commit()
            cur.execute(query, (MAX_SNAPSHOTS,))
            rows = cur.fetchall()
    return _rows_to_snapshots(rows)


def load_from_sqlite(db_path: Path) -> tuple[list[list[dict[str, Any]]], list[str], float | None]:
    if not db_path.exists():
        return [], [], None
    conn = sqlite3.connect(db_path)
    try:
        try:
            conn.execute("ALTER TABLE devices ADD COLUMN room_location TEXT")
        except sqlite3.OperationalError:
            pass
        cur = conn.execute(
            """
            SELECT
                d.device_id,
                d.alias,
                d.model,
                d.mac,
                d.device_type,
                d.room_location,
                d.parent_device_id,
                r.collected_at,
                r.is_on,
                r.mode,
                r.current_temp,
                r.target_temp,
                r.humidity,
                r.battery,
                r.rssi,
                r.data_json
            FROM readings r
            JOIN devices d ON d.device_id = r.device_id
            WHERE r.collected_at IN (
                SELECT DISTINCT collected_at
                FROM readings
                ORDER BY collected_at DESC
                LIMIT ?
            )
            ORDER BY r.collected_at ASC, r.id ASC
            """,
            (MAX_SNAPSHOTS,),
        )
        rows = cur.fetchall()
    finally:
        conn.close()
    return _rows_to_snapshots(rows)


def load_snapshots() -> list[list[dict]]:
    """Load all snapshots from the configured database (or fallback file)."""
    snapshots, _, _ = load_snapshots_with_meta()[:3]
    return snapshots


def load_snapshots_with_meta() -> tuple[list[list[dict[str, Any]]], list[str], float | None, str]:
    """Load snapshots along with timestamps, updated_at epoch, and source label."""
    dsn = resolve_db_dsn()
    if dsn:
        if dsn.startswith(("postgres://", "postgresql://")):
            snapshots, timestamps, updated_at = load_from_postgres(dsn)
            return snapshots, timestamps, updated_at, mask_dsn(dsn)
        sq_path = Path(dsn)
        snapshots, timestamps, updated_at = load_from_sqlite(sq_path)
        return snapshots, timestamps, updated_at, str(sq_path)

    if not DB_JSON_PATH.exists():
        return [], [], None, str(DB_JSON_PATH)
    snapshots = list(iter_snapshots(DB_JSON_PATH.read_text(encoding="utf-8")))
    mtime = DB_JSON_PATH.stat().st_mtime
    return snapshots, [], mtime, str(DB_JSON_PATH)


def build_state() -> dict:
    """Combine every snapshot into the payload consumed by the frontend."""
    snapshots, timestamps, updated_at, source_label = load_snapshots_with_meta()

    devices: dict[str, dict] = {}
    for step, snapshot in enumerate(snapshots):
        step_ts = timestamps[step] if step < len(timestamps) else None
        for reading in snapshot:
            slot = resolve_slot(reading)
            if slot is None:
                continue
            entry = devices.setdefault(
                slot,
                {
                    "slot": slot,
                    "kind": SLOTS[slot]["kind"],
                    "room": SLOTS[slot]["room"],
                    "name": reading.get("name"),
                    "model": reading.get("model"),
                    "location": SLOTS[slot]["location"],
                    "mac": reading.get("mac") or SLOTS[slot].get("mac"),
                    "parent": reading.get("parent"),
                    "history": [],
                },
            )
            entry["name"] = reading.get("name") or entry["name"]
            entry["model"] = reading.get("model") or entry["model"]
            entry["mac"] = reading.get("mac") or entry["mac"]
            entry["history"].append(
                {
                    "step": step,
                    "collected_at": reading.get("collected_at") or step_ts,
                    "temperature": reading.get("temperature"),
                    "target_temperature": reading.get("target_temperature"),
                    "humidity": reading.get("humidity"),
                    "battery": reading.get("battery"),
                    "mode": reading.get("mode"),
                    "on": reading.get("on"),
                    "rssi": reading.get("rssi"),
                }
            )

    ordered = []
    for slot in SLOTS:
        entry = devices.get(slot)
        if not entry:
            continue
        latest = dict(entry["history"][-1]) if entry["history"] else {}
        latest.pop("step", None)
        ordered.append({**entry, **latest})

    return {
        "source": source_label,
        "snapshots": len(snapshots),
        "timestamps": timestamps,
        "updated_at": updated_at,
        "slots": SLOTS,
        "devices": ordered,
    }


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "TempsWeb/0.2"

    def log_message(self, fmt: str, *args) -> None:  # quieter logs
        print(f"{self.address_string()} - {fmt % args}")

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlparse(self.path).path

        if path == "/api/state":
            try:
                state_payload = build_state()
                payload = json.dumps(state_payload, ensure_ascii=False).encode("utf-8")
                self._send(200, payload, "application/json; charset=utf-8")
            except Exception as exc:  # noqa: BLE001
                _LOGGER.exception("Failed to build state from database")
                err = json.dumps({"error": str(exc)}, ensure_ascii=False).encode("utf-8")
                self._send(500, err, "application/json; charset=utf-8")
            return

        if path in ("/", ""):
            path = "/index.html"

        # Prevent path traversal and serve from the static directory.
        candidate = (STATIC_DIR / path.lstrip("/")).resolve()
        if STATIC_DIR not in candidate.parents and candidate != STATIC_DIR:
            self._send(403, b"Forbidden", "text/plain; charset=utf-8")
            return
        if not candidate.is_file():
            self._send(404, b"Not found", "text/plain; charset=utf-8")
            return

        content_type = CONTENT_TYPES.get(candidate.suffix, "application/octet-stream")
        self._send(200, candidate.read_bytes(), content_type)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    display_host = "localhost" if HOST in ("0.0.0.0", "::") else HOST
    dsn = resolve_db_dsn()
    source_desc = mask_dsn(dsn) if dsn else str(DB_JSON_PATH)
    print(f"Temperatures dashboard on http://{display_host}:{PORT}")
    print(f"Reading snapshots from {source_desc}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
