#!/usr/bin/env -S uv run python
"""Collect thermostat and temperature/humidity sensor readings into PostgreSQL.

Reads the current state of all Kasa/Tapo devices and writes one snapshot into the
normalized ``devices`` + ``readings`` schema (see ``sql/init.sql``), which is the
same schema the web dashboard (``web/server.py``) reads from.

Device identity is stored once in ``devices`` (upserted on every run, so renames
and re-locations propagate) and each run appends one row per device to
``readings``. All rows from a single run share the same ``collected_at`` so the
dashboard groups them into one snapshot.
"""

import asyncio
import os
from datetime import datetime, timezone

from kasa import Module
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Text,
    create_engine,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship

from discovery import credentials_from_env, discover_devices

MAPPING = {
    "3C:64:CF:62:96:B6": "Schlafzimmer",
    "DC:62:79:90:73:AD": "Bad Groß",
    "30:DE:4B:A9:88:6B": "Arbeitszimmer",
    "DC:62:79:90:75:F2": "Bad Klein",
    "B0:19:21:1B:A7:40": "Küche",
    "3C:64:CF:62:BA:DF": "Wohnzimmer Links",
    "DC:62:79:71:3B:CF": "Gästezimmer Links",
    "B0:19:21:1B:A4:BC": "Wohnzimmer Rechts",
    "DC:62:79:90:73:1B": "Gästezimmer Rechts",
    "DC:62:79:54:B9:E2": "Küche",
    "8C:90:2D:50:35:B4": "Wohnzimmer",
    "0C:EF:15:F7:A7:AE": "Gästezimmer",
    "0C:EF:15:D9:6D:DD": "Arbeitszimmer",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Device(Base):
    """One row per discovered device/child (identity, not time series)."""

    __tablename__ = "devices"

    device_id: Mapped[str] = mapped_column(Text, primary_key=True)
    alias: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(Text)
    mac: Mapped[str | None] = mapped_column(Text)
    device_type: Mapped[str | None] = mapped_column(Text)
    room_location: Mapped[str | None] = mapped_column(Text)
    parent_device_id: Mapped[str | None] = mapped_column(Text)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    readings: Mapped[list["Reading"]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )


class Reading(Base):
    """One measurement row per device per collection run."""

    __tablename__ = "readings"
    __table_args__ = (
        Index("idx_readings_device_time", "device_id", "collected_at"),
        Index("idx_readings_collected_at", "collected_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    device_id: Mapped[str] = mapped_column(
        ForeignKey("devices.device_id", ondelete="CASCADE")
    )
    collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    is_on: Mapped[bool | None] = mapped_column(Boolean)
    mode: Mapped[str | None] = mapped_column(Text)
    current_temp: Mapped[float | None] = mapped_column(Float)
    target_temp: Mapped[float | None] = mapped_column(Float)
    humidity: Mapped[float | None] = mapped_column(Float)
    battery: Mapped[int | None] = mapped_column(Integer)
    rssi: Mapped[int | None] = mapped_column(Integer)
    current_power_w: Mapped[float | None] = mapped_column(Float)
    location_lat: Mapped[float | None] = mapped_column(Float)
    location_lon: Mapped[float | None] = mapped_column(Float)
    data_json: Mapped[dict | None] = mapped_column(JSONB)

    device: Mapped[Device] = relationship(back_populates="readings")


def walk(dev, parent=None):
    yield dev, parent
    for child in dev.children:
        yield from walk(child, parent or dev)


def get(obj, name, default=None):
    try:
        return getattr(obj, name)
    except Exception:
        return default


def normalize_mac(mac) -> str:
    mac = mac or ""
    clean = mac.replace(":", "").replace("-", "").upper()
    if len(clean) == 12:
        return ":".join(clean[i : i + 2] for i in range(0, 12, 2))
    return mac


def describe(dev, parent, collected_at: datetime) -> dict | None:
    thermostat = dev.modules.get(Module.Thermostat)
    temp_sensor = dev.modules.get(Module.TemperatureSensor)
    humidity_sensor = dev.modules.get(Module.HumiditySensor)
    battery_sensor = dev.modules.get(Module.BatterySensor)

    if thermostat is None and temp_sensor is None:
        return None

    mac = normalize_mac(get(dev, "mac"))
    location = MAPPING.get(mac, "Unknown")
    kind = "thermostat" if thermostat else "sensor"

    device_type = get(dev, "device_type")
    device_type = getattr(device_type, "value", device_type) or kind

    mode = get(thermostat, "mode")
    mode = getattr(mode, "value", mode)

    temperature = (
        get(thermostat, "temperature") if thermostat else get(temp_sensor, "temperature")
    )

    return {
        "device_id": dev.device_id,
        "alias": dev.alias,
        "model": get(dev, "model"),
        "mac": mac,
        "device_type": device_type,
        "room_location": location,
        "parent_device_id": parent.device_id if parent else None,
        "collected_at": collected_at,
        "is_on": get(thermostat, "state"),
        "mode": mode,
        "current_temp": temperature,
        "target_temp": get(thermostat, "target_temperature"),
        "humidity": get(humidity_sensor, "humidity"),
        "battery": get(battery_sensor, "battery"),
        "rssi": get(dev, "rssi"),
        "data_json": {
            "name": dev.alias,
            "model": get(dev, "model"),
            "location": location,
            "parent_alias": parent.alias if parent else None,
            "kind": kind,
        },
    }


def persist(engine, samples: list[dict]) -> None:
    """Upsert devices and append one reading per sample in a single transaction."""
    with Session(engine) as session:
        for s in samples:
            device = session.get(Device, s["device_id"])
            if device is None:
                device = Device(device_id=s["device_id"], first_seen=s["collected_at"])
                session.add(device)
            device.alias = s["alias"]
            device.model = s["model"]
            device.mac = s["mac"]
            device.device_type = s["device_type"]
            device.room_location = s["room_location"]
            device.parent_device_id = s["parent_device_id"]
            device.last_seen = s["collected_at"]

        # Make sure device rows exist before the FK-referencing readings.
        session.flush()

        for s in samples:
            session.add(
                Reading(
                    device_id=s["device_id"],
                    collected_at=s["collected_at"],
                    is_on=s["is_on"],
                    mode=s["mode"],
                    current_temp=s["current_temp"],
                    target_temp=s["target_temp"],
                    humidity=s["humidity"],
                    battery=s["battery"],
                    rssi=s["rssi"],
                    data_json=s["data_json"],
                )
            )

        session.commit()


async def main():
    creds = credentials_from_env()

    print("Discovering devices...")
    devices = await discover_devices(creds)

    # A single timestamp per run so the dashboard groups all devices into one snapshot.
    collected_at = utcnow()

    samples = []
    for top in devices:
        await top.update()
        for dev, parent in walk(top):
            entry = describe(dev, parent, collected_at)
            if entry:
                samples.append(entry)
        await top.disconnect()

    if not samples:
        print("No readings found. Exiting.")
        return

    db_user = os.getenv("POSTGRES_USER", "postgres")
    db_pass = os.getenv("POSTGRES_PASSWORD", "postgres")
    db_name = os.getenv("POSTGRES_DB", "postgres")
    db_host = os.getenv("POSTGRES_HOST", "localhost")
    db_port = os.getenv("POSTGRES_PORT", "5432")

    conn_str = f"postgresql+psycopg://{db_user}:{db_pass}@{db_host}:{db_port}/{db_name}"
    engine = create_engine(conn_str)

    # Create the tables automatically if they don't exist yet.
    Base.metadata.create_all(engine)

    print(f"Writing {len(samples)} readings (collected_at={collected_at.isoformat()})...")
    persist(engine, samples)
    print("Successfully written to devices + readings.")


if __name__ == "__main__":
    asyncio.run(main())
