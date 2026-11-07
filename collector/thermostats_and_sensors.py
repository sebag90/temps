#!/usr/bin/env -S uv run python
"""Print JSON for every thermostat and temperature/humidity sensor."""

import asyncio
import json

from kasa import Module

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


def walk(dev, parent=None):
    yield dev, parent
    for child in dev.children:
        yield from walk(child, parent or dev)


def get(obj, name, default=None):
    try:
        return getattr(obj, name)
    except Exception:
        return default


def describe(dev, parent):
    thermostat = dev.modules.get(Module.Thermostat)
    temp_sensor = dev.modules.get(Module.TemperatureSensor)
    humidity_sensor = dev.modules.get(Module.HumiditySensor)
    battery_sensor = dev.modules.get(Module.BatterySensor)

    if thermostat is None and temp_sensor is None:
        return None

    mac = get(dev, "mac") or ""
    clean = mac.replace(":", "").replace("-", "").upper()
    if len(clean) == 12:
        mac = ":".join(clean[i : i + 2] for i in range(0, 12, 2))

    mode = get(thermostat, "mode")
    return {
        "kind": "thermostat" if thermostat else "sensor",
        "name": dev.alias,
        "model": dev.model,
        "device_id": dev.device_id,
        "location": MAPPING[mac],
        "mac": mac,
        "parent": parent.alias if parent else None,
        "on": get(thermostat, "state"),
        "mode": getattr(mode, "value", mode),
        "temperature": get(thermostat, "temperature")
        if thermostat
        else get(temp_sensor, "temperature"),
        "target_temperature": get(thermostat, "target_temperature"),
        "humidity": get(humidity_sensor, "humidity"),
        "battery": get(battery_sensor, "battery"),
        "rssi": get(dev, "rssi"),
    }


async def main():
    creds = credentials_from_env()
    devices = await discover_devices(creds)

    result = []
    for top in devices:
        await top.update()
        for dev, parent in walk(top):
            entry = describe(dev, parent)
            if entry:
                result.append(entry)
        await top.disconnect()

    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
