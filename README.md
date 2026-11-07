# kasa-home

A [uv](https://docs.astral.sh/uv/) project around
[python-kasa](https://github.com/python-kasa/python-kasa) that discovers
TP-Link Kasa/Tapo devices on the local network and collects a JSON snapshot
of their state into `data/snapshots.jsonl` (one JSON object per device per run).

Everything is driven by [`just`](https://github.com/casey/just):

```bash
just            # list recipes
```

## Setup

```bash
just setup
cp .env.example .env   # optional: credentials / fixed hosts
```

Some newer devices (Tapo, and recent Kasa firmware) require the TP-Link cloud
account credentials used in the app. Broadcast discovery may also need
`--target 192.168.1.255` when the machine has multiple network interfaces.

## Recipes

```bash
just collect              # discover, print summary, append to data/snapshots.jsonl
just show                 # print summary only, don't write a snapshot
just json                 # print the full JSON snapshot to stdout only
just deep                 # raw sys_info + daily/monthly energy stats + debug logs
just hosts 192.168.1.10 192.168.1.11   # query explicit devices
just recent               # latest snapshot per device
just db                   # collect all devices into SQLite (data/kasa.db)
just db-latest            # latest thermostat readings from the DB
just db-shell             # open the database with sqlite3
just dump                 # raw status of every device and child (incl. location)
just thermostats          # find thermostats (incl. hub children) and print on/off
just doctor               # compare discovery with `kasa discover`
just kasa discover        # debug with the python-kasa CLI
just clean                # delete collected snapshots
just check                # smoke-test imports and CLI
```

Options are forwarded directly to the script, e.g.
`just collect --stats --no-children` or `just collect -H 192.168.1.10`.

Output file: `data/snapshots.jsonl`, append-only. Analysis can then be done
with jq/duckdb/pandas, e.g.:

```bash
jq -c 'select(.energy != null) | {t: .collected_at, alias: .device.alias,
       w: .energy.current_consumption}' data/snapshots.jsonl
```

## 3-Container Podman Quadlet Stack & Web Dashboard

The deployment architecture consists of 3 Podman containers managed via systemd Quadlets (`quadlets/`):

1. **`temps-postgres`** (`quadlets/temps-postgres.container` + `quadlets/temps-postgres.volume`): PostgreSQL 17 database storing the `devices` and `readings` tables.
2. **`temps-collector`** (`quadlets/temps-collector.container`, built from `Containerfile.collector`): Runs `cron` every 5 minutes (`*/5 * * * *`) to execute `scripts/collect_db.py` and persist measurements into PostgreSQL.
3. **`temps-web`** (`quadlets/temps-web.container`, built from `Containerfile`): Hosts `web/server.py` and the floor-plan frontend (`web/static/`), querying PostgreSQL on `GET /api/state`.

```bash
# Build images and install Quadlet units into ~/.config/containers/systemd/
just quadlets-install

# Create ~/.config/temps/temps.env from quadlets/temps.env.example
# (KASA_USERNAME, KASA_PASSWORD, KASA_HOSTS; do not set POSTGRES_HOST there)
just quadlets-start
just quadlets-status

# Or run the 3 containers directly via podman without systemd:
just stack-up
just stack-down
```

### Container networking and device discovery

Kasa/Tapo broadcast discovery uses UDP port 9999, which does not cross a
container bridge network. The collector therefore has three options:

1. **Explicit hosts (recommended for bridge networking).** Set `KASA_HOSTS` to
   a comma-separated list of device/hub IPs. The collector queries them
   directly, so no host networking is needed. Include the hub IP for
   KE100/KE110 thermostat children.

   ```bash
   KASA_HOSTS=192.168.1.3
   ```

   Only the hub IP is needed; the collector discovers the hub's children
   itself. Use a static DHCP lease so the IP does not change.

2. **Host networking.** Keep `Network=host` in the Quadlet (or
   `podman run --network host`). Broadcast discovery works unchanged, but the
   container shares the host network namespace.

3. **macvlan/ipvlan network.** Give the container its own LAN IP so it can
   receive broadcasts. This works, but the container can no longer reach the
   PostgreSQL container on the bridge network unless you attach both networks
   or publish PostgreSQL on the LAN.

For most setups option 1 is the simplest: bridge networking for PostgreSQL and
outbound access to the devices, with no host network namespace.

### Quadlet environment file

Use `quadlets/temps.env.example` as the template for
`~/.config/temps/temps.env`. Keep `POSTGRES_HOST` out of that file: the
quadlets set it to `temps-postgres`, and `EnvironmentFile=` would override it
with `localhost` if present.

The quadlets use `EnvironmentFile=../../../temps/temps.env`, which is relative
to the unit file. This assumes the units are installed in
`~/.config/containers/systemd/temps/`. If you install them directly in
`~/.config/containers/systemd/`, change it to `../../temps/temps.env`.

### Published images

`.github/workflows/build-images.yml` builds multi-arch images for
`linux/amd64` and `linux/arm64` and publishes them to GHCR:

```text
ghcr.io/<owner>/temps-collector:latest
ghcr.io/<owner>/temps-web:latest
```

The collector base image (`astral/uv:python3.14-bookworm-slim`) only provides
`amd64` and `arm64`, so 32-bit `arm/v7` is not supported without changing the
collector base image. A 64-bit Raspberry Pi OS is required for the collector.

## Database Collection (`scripts/collect_db.py`)

`scripts/collect_db.py` discovers all devices and hub children and writes them to PostgreSQL (configured via `DATABASE_URL` or `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD`, with SQLite fallback when `--db path.db` is given):

```bash
just db                            # one collection run -> PostgreSQL
just db-seed                       # import historical snapshots from db.json into PostgreSQL
just db --interval 300             # keep collecting every 5 minutes
just db --raw                      # also store full raw status per reading
just db-latest                     # latest readings per device from PostgreSQL
./scripts/collect_db.py --help     # direct execution also works
```

Schema (`sql/init.sql`):

- `devices` — one row per device/child: `device_id`, `alias`, `model`, `mac`,
  `device_type`, `room_location`, `parent_device_id`, `first_seen`, `last_seen`
- `readings` — one row per device per run: `collected_at`, `is_on`, `mode`,
  `current_temp`, `target_temp`, `humidity`, `battery`, `rssi`,
  `current_power_w`, `location_lat`, `location_lon`, plus `data_json` (`JSONB`)

Example queries:

```sql
-- Latest state per thermostat
SELECT d.alias, r.collected_at, r.is_on, r.mode, r.current_temp, r.target_temp
FROM devices d
JOIN readings r ON r.device_id = d.device_id
WHERE d.device_type = 'Thermostat'
  AND r.id IN (SELECT MAX(id) FROM readings GROUP BY device_id);

-- Temperature history for one thermostat
SELECT collected_at, current_temp, target_temp, mode
FROM readings WHERE device_id = 'YOUR_DEVICE_ID'
ORDER BY collected_at DESC LIMIT 50;
```

## Raw status and location

`just dump` prints, for every discovered device and child:

- identity: alias, model, device ID, device type, MAC, RSSI
- parent hub (for KE100/sensors)
- `location` (latitude/longitude; children inherit the hub's location)
- supported modules
- the complete raw `internal_state` payload returned by the device, which
  contains every module response (`get_device_info`, energy, schedules, ...)

```bash
just dump                      # human-readable sections
just dump --json > raw.json    # one JSON array with all devices
just dump -H 192.168.1.3       # query the hub directly
just dump --no-children        # top-level devices only
just dump --features           # add parsed feature values
```

## Thermostats (KH100 hub + KE100/KE110 valves)

KE100/KE110 thermostats are children of a KH100/H100 hub and do not answer
discovery themselves, so they never appear as top-level devices:

```bash
just thermostats
just thermostats -H 192.168.1.50   # query a hub directly
just thermostats --json
```

The script discovers devices, updates them, walks into hub children, and
reports `ON`/`OFF` plus mode and target/current temperature. If no hub is
found it prints every inspected device and a hint; if a hub is found but has
no thermostat children it suggests checking pairing/credentials.

**TPAP:** current KH100 firmware advertises the `TPAP` encryption scheme, which
the released python-kasa 0.12 does not support (upstream issue #1590). This
project therefore pins the upstream TPAP implementation (PR #1592) in
`pyproject.toml`. With that build the hub is recognized; set the TP-Link
account credentials in `.env` so it can authenticate:

```bash
cp .env.example .env   # then fill in KASA_USERNAME / KASA_PASSWORD
just thermostats -vv
```

If authentication still fails, enable *Third-Party Compatibility* in the
Tapo/Kasa app for the hub if available; the hub then advertises KLAP instead
of TPAP and also works with a stock python-kasa release. Once TPAP support is
merged and released, replace the git dependency with a normal
`python-kasa>=...` requirement.

## Troubleshooting discovery

`just collect` honours the same environment variables as the `kasa` CLI:
`KASA_TARGET`, `KASA_DISCOVERY_TIMEOUT`, `KASA_TIMEOUT`, `KASA_USERNAME`,
`KASA_PASSWORD` (plus `KASA_HOSTS` for a comma-separated host list). The broadcast target is the most common difference on multi-homed
machines:

```bash
just collect --target 192.168.1.255
# or
echo 'KASA_TARGET=192.168.1.255' >> .env
```

Discovery waits 10 s by default, matching the `kasa` CLI. Devices that answer
but are not supported, or that fail authentication, are now reported on
stderr instead of being silently dropped. Use `just doctor` to run this tool
and `kasa discover` side by side.

## What can we collect?

Everything below is best-effort: python-kasa exposes only what each model /
firmware supports. `dev.modules` and `--raw` are the ground truth for a device.

### Identity, network & firmware
- alias/name, model, device ID, device type
- host/IP and port, MAC address, Wi-Fi RSSI (signal strength), SSID (feature/raw)
- hardware version, current firmware, available firmware update, region
- device time, timezone, location (latitude/longitude), `on_since`
- raw `sys_info` payload (`--raw`) and the complete module list

### State & generic features
Every feature is captured with id, name, value, type, category and unit. This
includes, depending on the device:
- power state (on/off), brightness, color temperature, HSV/RGB color, light
  effects and presets, smooth transitions
- fan speed, thermostat target/current temperature, temperature/humidity
  sensors, battery level and low-battery flag
- motion, contact, water-leak and frost sensors, overheat protection, child
  lock, auto-off, LED state, alarms, schedules, report mode, firmware updates

### Energy & usage
For plugs, strips, wall switches and some bulbs with metering support:
- current power draw (W), voltage (V), current (A)
- consumption today / this month / total
- per-day and per-month statistics (`just deep`, if supported)
- legacy usage module: minutes on today/this month/total

### Multi-outlet devices
Power strips and hubs are recursed into (`--no-children` disables this), so
each child outlet gets its own state and energy record.

## Project layout

```
justfile                    # all commands
src/kasa_home/collector.py  # snapshot collection (usable as a library)
src/kasa_home/cli.py        # argparse CLI, discovery, JSONL writer
layout.txt                  # ASCII floor plan (rooms, radiators, sensors)
db.json                     # collected snapshots (one JSON array per line)
Containerfile               # image for the web dashboard
web/server.py               # standard-library backend (serves /api/state)
web/static/                 # floor-plan frontend (HTML/CSS/JS)
```
