"""Shared Kasa/Tapo device discovery helpers.

Broadcast discovery (UDP 9999) does not cross a container's bridge network, so
containers normally need ``--network host``. As an alternative, set
``KASA_HOSTS`` to a comma-separated list of device/hub IPs: the collector then
queries those hosts directly and works fine on a normal bridge network.
"""

from __future__ import annotations

import os
import sys

from kasa import Credentials, Device, Discover


def credentials_from_env() -> Credentials | None:
    username, password = os.getenv("KASA_USERNAME"), os.getenv("KASA_PASSWORD")
    return Credentials(username, password) if username and password else None


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


async def discover_devices(creds: Credentials | None = None) -> list[Device]:
    """Return top-level devices, either from KASA_HOSTS or via broadcast."""
    creds = creds or credentials_from_env()
    timeout = _env_int("KASA_DISCOVERY_TIMEOUT", 10)

    hosts = [host.strip() for host in os.getenv("KASA_HOSTS", "").split(",") if host.strip()]
    if hosts:
        devices: list[Device] = []
        for host in hosts:
            try:
                device = await Discover.discover_single(
                    host,
                    credentials=creds,
                    discovery_timeout=timeout,
                )
            except Exception as exc:  # noqa: BLE001 - keep collecting other hosts
                print(f"Warning: could not reach {host}: {exc}", file=sys.stderr)
                continue
            if device is not None:
                devices.append(device)
        return devices

    target = os.getenv("KASA_TARGET", "255.255.255.255")
    found = await Discover.discover(
        target=target,
        credentials=creds,
        discovery_timeout=timeout,
    )
    return list(found.values())
