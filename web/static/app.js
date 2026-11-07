"use strict";

/* ------------------------------------------------------------------ *
 * KLIMA // ARCHITECTURAL TELEMETRY FRONTEND
 * Floor plan geometry derived from layout.txt (53 x 28 character grid).
 * Numbers 1-9 are radiator thermostats, letters A-D are climate sensors.
 * ------------------------------------------------------------------ */

const GRID = { w: 53, h: 28 };
const SCALE = { x: 16.5, y: 27.5 };
const MARGIN = 32;
const VIEW_W = GRID.w * SCALE.x + MARGIN * 2;
const VIEW_H = GRID.h * SCALE.y + MARGIN * 2;

const px = (x) => MARGIN + x * SCALE.x;
const py = (y) => MARGIN + y * SCALE.y;

// Rooms as polygons in grid coordinates (x, y).
const ROOMS = [
  { name: "Bad Groß", points: [[0, 0], [13, 0], [13, 4], [0, 4]], label: [1.1, 1.35] },
  { name: "Küche", points: [[0, 4], [13, 4], [13, 8], [0, 8]], label: [1.1, 5.15] },
  { name: "Wohnzimmer", points: [[0, 8], [13, 8], [13, 14], [37, 14], [37, 18], [0, 18]], label: [1.1, 9.45] },
  { name: "Schlafzimmer", points: [[37, 14], [53, 14], [53, 18], [37, 18]], label: [38.2, 15.15] },
  { name: "Flur", points: [[0, 18], [53, 18], [53, 20], [0, 20]], label: [24.5, 19.25] },
  { name: "Arbeitszimmer", points: [[0, 20], [18, 20], [18, 28], [0, 28]], label: [1.1, 21.35] },
  { name: "Bad Klein", points: [[38, 20], [53, 20], [53, 24], [38, 24]], label: [39.2, 21.25] },
  { name: "Gästezimmer", points: [[18, 20], [38, 20], [38, 24], [53, 24], [53, 28], [18, 28]], label: [19.2, 21.35] },
];

// Outer apartment perimeter polygon for crisp architectural exterior wall rendering.
const APARTMENT_OUTLINE = [
  [0, 0], [13, 0], [13, 14], [53, 14], [53, 28], [0, 28],
];

// Device slot -> position in grid coordinates.
const SLOT_POS = {
  "1": [9.2, 2.55],
  A: [4.5, 6.1],
  "2": [10.4, 6.1],
  B: [4.2, 12.1],
  "3": [18.2, 16.25],
  "4": [28.2, 16.25],
  "5": [45.5, 16.25],
  "9": [46.2, 22.35],
  C: [14.8, 24.4],
  D: [22.2, 22.7],
  "6": [7.5, 25.9],
  "7": [28.5, 25.9],
  "8": [46.2, 25.9],
};

/* ------------------------------------------------------------------ *
 * Helpers & Color Scales
 * ------------------------------------------------------------------ */

const SVG_NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, v);
  }
  return node;
};

const fmt = (v, digits = 1) => (v == null || Number.isNaN(Number(v)) ? "–" : Number(v).toFixed(digits));

function tempColor(t) {
  if (t == null) return "#8b94a3";
  const min = 20;
  const max = 25;
  const ratio = Math.max(0, Math.min(1, (t - min) / (max - min)));
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  // Curated architectural palette: cobalt blue -> sage teal -> warm ochre -> vermilion
  const hue = Math.round(202 - ratio * 186);
  const sat = isDark ? Math.round(78 + ratio * 10) : Math.round(74 + ratio * 12);
  const light = isDark ? Math.round(52 + Math.sin(ratio * Math.PI) * 4) : Math.round(42 + Math.sin(ratio * Math.PI) * 3);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function roomThermalFill(t, showHeatmap) {
  if (!showHeatmap || t == null) return "rgba(3, 105, 161, 0.03)";
  const min = 20;
  const max = 25;
  const ratio = Math.max(0, Math.min(1, (t - min) / (max - min)));
  const hue = Math.round(202 - ratio * 186);
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const alpha = isDark ? 0.11 : 0.15;
  return `hsla(${hue}, 78%, 48%, ${alpha})`;
}

const slotSort = (slot) =>
  /^[0-9]+$/.test(slot) ? Number(slot) : 100 + slot.charCodeAt(0);

function rssiQuality(rssi) {
  if (rssi == null) return { label: "–", pct: 0, color: "var(--muted)" };
  if (rssi >= -55) return { label: "Exzellent", pct: 100, color: "var(--good)" };
  if (rssi >= -68) return { label: "Gut", pct: 75, color: "var(--good)" };
  if (rssi >= -78) return { label: "Mittel", pct: 50, color: "var(--warm)" };
  return { label: "Schwach", pct: 25, color: "var(--heating)" };
}

function modeInfo(device) {
  const off = device.on === false || device.mode === "off";
  if (device.kind === "sensor") {
    return { label: "Aktiv · Klima", cls: "ready", short: "Aktiv" };
  }
  if (off) {
    return { label: "Ausgeschaltet", cls: "off", short: "Aus" };
  }
  if (device.mode === "heating") {
    return { label: "Heizt aktiv", cls: "heating", short: "Heizt" };
  }
  if (device.target_temperature != null && device.target_temperature <= 6.0) {
    return { label: "Frostschutz (5°)", cls: "frost", short: "Frostschutz" };
  }
  return { label: "Bereit (Idle)", cls: "ready", short: "Bereit" };
}

/* ------------------------------------------------------------------ *
 * Application State
 * ------------------------------------------------------------------ */

let state = null;
let activeSlot = null; // null = Apartment Overview
let selectedStep = null; // null = latest step (live)
let showHeatmap = true;
let showPlanDetails = true;
let playTimer = null;

function getEffectiveStep() {
  if (!state || !state.snapshots) return 0;
  const maxStep = Math.max(0, state.snapshots - 1);
  if (selectedStep == null || selectedStep >= maxStep) return maxStep;
  return Math.max(0, selectedStep);
}

function isLiveView() {
  if (!state || !state.snapshots) return true;
  return getEffectiveStep() >= state.snapshots - 1;
}

/**
 * Returns the list of devices projected at the currently selected snapshot step,
 * along with temperature delta relative to the immediately preceding step.
 */
function getProjectedDevices() {
  if (!state || !state.devices) return [];
  const step = getEffectiveStep();
  return state.devices.map((d) => {
    const history = d.history || [];
    if (!history.length) return { ...d, prevTemp: null, deltaTemp: null };
    const idx = Math.min(step, history.length - 1);
    const snap = history[idx] || {};
    const prevSnap = idx > 0 ? history[idx - 1] : null;
    const temp = snap.temperature !== undefined ? snap.temperature : d.temperature;
    const prevTemp = prevSnap && prevSnap.temperature != null ? prevSnap.temperature : null;
    const deltaTemp = temp != null && prevTemp != null ? Number((temp - prevTemp).toFixed(1)) : null;

    return {
      ...d,
      temperature: temp,
      target_temperature: snap.target_temperature !== undefined ? snap.target_temperature : d.target_temperature,
      humidity: snap.humidity !== undefined ? snap.humidity : d.humidity,
      battery: snap.battery !== undefined ? snap.battery : d.battery,
      mode: snap.mode !== undefined ? snap.mode : d.mode,
      on: snap.on !== undefined ? snap.on : d.on,
      rssi: snap.rssi !== undefined ? snap.rssi : d.rssi,
      prevTemp,
      deltaTemp,
      activeStepIndex: idx,
    };
  });
}

function computeRoomStats(devices) {
  const byRoom = new Map();
  for (const r of ROOMS) {
    byRoom.set(r.name, {
      name: r.name,
      devices: [],
      temps: [],
      sensorTemp: null,
      humidity: null,
      heating: false,
      maxTarget: null,
    });
  }

  for (const d of devices) {
    const entry = byRoom.get(d.room);
    if (!entry) continue;
    entry.devices.push(d);
    if (d.temperature != null) entry.temps.push(d.temperature);
    if (d.kind === "sensor" && d.temperature != null) entry.sensorTemp = d.temperature;
    if (d.humidity != null) entry.humidity = d.humidity;
    if (d.mode === "heating") entry.heating = true;
    if (d.kind === "thermostat" && d.target_temperature != null) {
      if (entry.maxTarget == null || d.target_temperature > entry.maxTarget) {
        entry.maxTarget = d.target_temperature;
      }
    }
  }

  for (const entry of byRoom.values()) {
    entry.avgTemp =
      entry.sensorTemp != null
        ? entry.sensorTemp
        : entry.temps.length
        ? entry.temps.reduce((a, b) => a + b, 0) / entry.temps.length
        : null;
  }
  return byRoom;
}

/* ------------------------------------------------------------------ *
 * API & Lifecycle
 * ------------------------------------------------------------------ */

async function load(manual = false) {
  const refreshBtn = document.getElementById("btn-refresh");
  if (manual && refreshBtn) {
    refreshBtn.classList.add("spinning");
    setTimeout(() => refreshBtn.classList.remove("spinning"), 650);
  }

  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const wasAtLatest = isLiveView();
    state = await res.json();
    if (wasAtLatest || selectedStep == null) {
      selectedStep = Math.max(0, (state.snapshots || 1) - 1);
    }
    renderAll();
  } catch (err) {
    setStatus("error", `Fehler beim Laden: ${err.message}`);
  }
}

function renderAll() {
  if (!state) return;
  const devices = getProjectedDevices();
  const roomStats = computeRoomStats(devices);

  updateStatusHeader(devices);
  updateScrubberUI();
  updateKPIs(devices, roomStats);
  updateFooter();
  renderPlan(devices, roomStats);
  renderInspector(devices, roomStats);
}

function setStatus(kind, text) {
  const dot = document.getElementById("status-dot");
  const metaText = document.getElementById("meta-text");
  if (dot) dot.className = `status-dot ${kind}`;
  if (metaText) metaText.textContent = text;
}

function formatLastMeasurement() {
  if (!state) return null;
  const raw =
    state.timestamps && state.timestamps.length
      ? state.timestamps[state.timestamps.length - 1]
      : state.updated_at
      ? new Date(state.updated_at * 1000).toISOString()
      : null;
  if (!raw) return null;

  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return null;

  const diffMin = Math.max(0, Math.round((Date.now() - when.getTime()) / 60000));
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} Min.`;

  const time = when.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const sameDay = when.toDateString() === new Date().toDateString();
  if (sameDay) return `${time} Uhr`;
  return `${when.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} · ${time}`;
}

function updateStatusHeader(devices) {
  if (isLiveView()) {
    const last = formatLastMeasurement();
    setStatus(
      "live",
      `${devices.length} Geräte · ${state.snapshots} Messungen${last ? ` · Letzte Messung ${last}` : ""}`
    );
  } else {
    setStatus(
      "historical",
      `Messung #${getEffectiveStep() + 1}/${state.snapshots} · Historische Ansicht`
    );
  }
}

function updateFooter() {
  if (!state) return;
  const when = state.updated_at
    ? new Date(state.updated_at * 1000).toLocaleString("de-DE")
    : "–";
  const snapInfo = document.getElementById("snapshot-info");
  const sourceEl = document.getElementById("source");
  if (snapInfo) {
    snapInfo.textContent = `${state.snapshots} Messungen · Stand: ${when}`;
  }
  if (sourceEl) {
    sourceEl.textContent = state.source || "PostgreSQL";
  }
}

/* ------------------------------------------------------------------ *
 * KPI Strip
 * ------------------------------------------------------------------ */

function updateKPIs(devices, roomStats) {
  const temps = devices.map((d) => d.temperature).filter((v) => v != null);
  const avgTemp = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const minTemp = temps.length ? Math.min(...temps) : null;
  const maxTemp = temps.length ? Math.max(...temps) : null;

  const avgTempEl = document.getElementById("kpi-avg-temp");
  const tempSpreadEl = document.getElementById("kpi-temp-spread");
  if (avgTempEl) {
    avgTempEl.innerHTML = `${fmt(avgTemp)}°C <span class="kpi-badge">${fmt(minTemp)}° – ${fmt(maxTemp)}°</span>`;
  }
  if (tempSpreadEl) {
    const roomsWithTemp = [...roomStats.values()].filter((r) => r.avgTemp != null);
    roomsWithTemp.sort((a, b) => a.avgTemp - b.avgTemp);
    if (roomsWithTemp.length >= 2) {
      const coolest = roomsWithTemp[0];
      const warmest = roomsWithTemp[roomsWithTemp.length - 1];
      tempSpreadEl.innerHTML = `<span>Kühl: ${coolest.name} (${fmt(coolest.avgTemp)}°)</span><span>Warm: ${warmest.name} (${fmt(warmest.avgTemp)}°)</span>`;
    } else {
      tempSpreadEl.textContent = `${temps.length} aktive Temperaturmesspunkte`;
    }
  }

  // Humidity KPI
  const hums = devices.map((d) => d.humidity).filter((v) => v != null);
  const avgHum = hums.length ? hums.reduce((a, b) => a + b, 0) / hums.length : null;
  const minHum = hums.length ? Math.min(...hums) : null;
  const maxHum = hums.length ? Math.max(...hums) : null;
  const avgHumEl = document.getElementById("kpi-avg-hum");
  const humSpreadEl = document.getElementById("kpi-hum-spread");
  if (avgHumEl) {
    const optimal = avgHum != null && avgHum >= 40 && avgHum <= 60;
    avgHumEl.innerHTML = `${fmt(avgHum, 0)}% <span class="kpi-badge ${optimal ? "good" : ""}">${optimal ? "OPTIMAL" : "KLIMA"}</span>`;
  }
  if (humSpreadEl) {
    humSpreadEl.innerHTML = `<span>Spanne: ${fmt(minHum, 0)}% – ${fmt(maxHum, 0)}% rF</span><span>${hums.length} Sensoren</span>`;
  }

  // Heating Status KPI
  const thermostats = devices.filter((d) => d.kind === "thermostat");
  const heatingCount = thermostats.filter((d) => d.mode === "heating").length;
  const offCount = thermostats.filter((d) => d.on === false || d.mode === "off").length;
  const frostCount = thermostats.filter(
    (d) => d.on !== false && d.mode !== "off" && d.mode !== "heating" && d.target_temperature != null && d.target_temperature <= 6.0
  ).length;
  const readyCount = thermostats.length - heatingCount - offCount - frostCount;

  const heatStatusEl = document.getElementById("kpi-heating-status");
  const heatSubEl = document.getElementById("kpi-heating-sub");
  if (heatStatusEl) {
    if (heatingCount > 0) {
      heatStatusEl.innerHTML = `${heatingCount} Heizt <span class="kpi-badge warm">AKTIV</span>`;
    } else {
      heatStatusEl.innerHTML = `0 Heizt <span class="kpi-badge good">STANDBY</span>`;
    }
  }
  if (heatSubEl) {
    heatSubEl.innerHTML = `<span>${readyCount} Bereit · ${frostCount} Frostschutz</span><span>${offCount} Aus</span>`;
  }

  // Health & RF KPI
  const batteries = devices.map((d) => d.battery).filter((v) => v != null);
  const minBat = batteries.length ? Math.min(...batteries) : null;
  const rssis = devices.map((d) => d.rssi).filter((v) => v != null);
  const avgRssi = rssis.length ? Math.round(rssis.reduce((a, b) => a + b, 0) / rssis.length) : null;

  const healthEl = document.getElementById("kpi-health");
  const healthSubEl = document.getElementById("kpi-health-sub");
  if (healthEl) {
    healthEl.innerHTML = `≥ ${fmt(minBat, 0)}% <span class="kpi-badge ${minBat >= 50 ? "good" : "warm"}">BATTERIE</span>`;
  }
  if (healthSubEl) {
    healthSubEl.innerHTML = `<span>Ø Funk: ${avgRssi != null ? `${avgRssi} dBm` : "–"}</span><span>Smart Hub OK</span>`;
  }
}

/* ------------------------------------------------------------------ *
 * Timeline Scrubber
 * ------------------------------------------------------------------ */

function updateScrubberUI() {
  const total = state ? state.snapshots || 1 : 1;
  const step = getEffectiveStep();
  const live = isLiveView();

  const range = document.getElementById("scrub-range");
  const badge = document.getElementById("scrub-badge");
  const label = document.getElementById("scrub-label");
  const liveBtn = document.getElementById("scrub-live");

  if (range) {
    range.max = String(Math.max(0, total - 1));
    range.value = String(step);
  }
  if (badge) {
    badge.className = `scrub-badge ${live ? "live" : "history"}`;
    badge.textContent = live ? "AKTUELL" : "HISTORIE";
  }
  if (label) {
    const rawTs = state && state.timestamps ? state.timestamps[step] : null;
    const tsFormatted = rawTs
      ? ` · ${new Date(rawTs).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`
      : "";
    label.textContent = `Messung ${state && state.snapshots ? step + 1 : 0} / ${state ? state.snapshots : 0}${tsFormatted}`;
  }
  if (liveBtn) {
    liveBtn.classList.toggle("is-live", live);
  }
}

function setStep(newStep) {
  if (!state) return;
  const maxStep = Math.max(0, (state.snapshots || 1) - 1);
  selectedStep = Math.max(0, Math.min(maxStep, newStep));
  renderAll();
}

function togglePlayback() {
  const icon = document.getElementById("scrub-play-icon");
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
    if (icon) {
      icon.innerHTML = `<path d="M4.5 3.2a.7.7 0 0 1 1.06-.6l7.2 4.8a.7.7 0 0 1 0 1.2l-7.2 4.8a.7.7 0 0 1-1.06-.6V3.2Z" />`;
    }
    return;
  }

  if (!state || (state.snapshots || 0) <= 1) return;
  if (isLiveView()) selectedStep = 0;

  if (icon) {
    icon.innerHTML = `<path d="M4.5 3h2.8v10H4.5V3Zm5.2 0h2.8v10H9.7V3Z" />`;
  }
  renderAll();

  playTimer = setInterval(() => {
    const maxStep = Math.max(0, (state.snapshots || 1) - 1);
    if (getEffectiveStep() >= maxStep) {
      togglePlayback();
      return;
    }
    setStep(getEffectiveStep() + 1);
  }, 900);
}

/* ------------------------------------------------------------------ *
 * Render: Architectural Floor Plan SVG
 * ------------------------------------------------------------------ */

function renderPlan(devices, roomStats) {
  const svg = document.getElementById("plan");
  if (!svg) return;
  svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.replaceChildren();

  // 1. Subtle Blueprint Grid & Coordinate Ticks
  const gridGroup = el("g", { class: "blueprint-layer" });
  for (let gx = 0; gx <= GRID.w; gx += 5) {
    gridGroup.appendChild(
      el("line", {
        x1: px(gx),
        y1: py(0) - 8,
        x2: px(gx),
        y2: py(GRID.h) + 8,
        class: "blueprint-grid",
      })
    );
  }
  for (let gy = 0; gy <= GRID.h; gy += 4) {
    gridGroup.appendChild(
      el("line", {
        x1: px(0) - 8,
        y1: py(gy),
        x2: px(GRID.w) + 8,
        y2: py(gy),
        class: "blueprint-grid",
      })
    );
  }
  svg.appendChild(gridGroup);

  // Determine which room is currently active (if a slot is selected)
  const activeDevice = devices.find((d) => d.slot === activeSlot);
  const activeRoomName = activeDevice ? activeDevice.room : null;

  // 2. Rooms Layer
  for (const room of ROOMS) {
    const rStat = roomStats.get(room.name);
    const avgTemp = rStat ? rStat.avgTemp : null;
    const pts = room.points.map(([x, y]) => `${px(x)},${py(y)}`).join(" ");

    const rGroup = el("g", {
      class: `room-group${activeRoomName === room.name ? " selected" : ""}`,
      "data-room": room.name,
    });

    const poly = el("polygon", {
      points: pts,
      class: "room",
      style: `fill: ${roomThermalFill(avgTemp, showHeatmap)}`,
    });
    rGroup.appendChild(poly);

    // Room Title Label
    const lx = px(room.label[0]);
    const ly = py(room.label[1]);
    const labelEl = el("text", { x: lx, y: ly, class: "room-label" });
    labelEl.textContent = room.name;
    rGroup.appendChild(labelEl);

    // Room Summary Sub-label (Average Temp + Humidity if available)
    if (showPlanDetails && avgTemp != null && room.name !== "Flur") {
      const subParts = [`Ø ${fmt(avgTemp)}°C`];
      if (rStat && rStat.humidity != null) {
        subParts.push(`${fmt(rStat.humidity, 0)}% rF`);
      }
      const subEl = el("text", { x: lx, y: ly + 15, class: "room-sublabel" });
      subEl.textContent = subParts.join(" · ");
      rGroup.appendChild(subEl);
    }

    rGroup.addEventListener("click", (e) => {
      e.stopPropagation();
      if (rStat && rStat.devices.length) {
        // Select sensor first if present, else first thermostat in that room
        const preferred =
          rStat.devices.find((d) => d.kind === "sensor") || rStat.devices[0];
        selectSlot(preferred.slot);
      }
    });

    svg.appendChild(rGroup);
  }

  // 3. Crisp Exterior Wall Outline
  const outlinePts = APARTMENT_OUTLINE.map(([x, y]) => `${px(x)},${py(y)}`).join(" ");
  svg.appendChild(el("polygon", { points: outlinePts, class: "apartment-outline" }));

  // 4. Devices Layer (Thermostats 1-9 & Sensors A-D)
  for (const device of devices) {
    svg.appendChild(renderDevice(device));
  }
}

// White "type" glyph drawn inside a device marker: a radiator for thermostats
// (slots 1-9) and a thermometer for climate sensors (slots A-D). Individual
// devices are told apart by their position on the floor plan, not by a label.
function deviceIcon(isSensor, cx, cy) {
  const g = el("g", { class: "device-icon", transform: `translate(${cx},${cy})` });
  if (isSensor) {
    // Thermometer (24x24 Material glyph), centred and scaled to fit the marker.
    g.appendChild(
      el("path", {
        transform: "scale(0.78) translate(-12,-12)",
        d: "M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4z",
      })
    );
  } else {
    // Radiator: body with vertical fins and two feet.
    g.appendChild(el("rect", { x: -9, y: -7.5, width: 18, height: 12, rx: 2.5 }));
    for (const x of [-4.5, 0, 4.5]) {
      g.appendChild(el("line", { x1: x, y1: -7.5, x2: x, y2: 4.5 }));
    }
    g.appendChild(el("line", { x1: -6.5, y1: 4.5, x2: -6.5, y2: 7.5 }));
    g.appendChild(el("line", { x1: 6.5, y1: 4.5, x2: 6.5, y2: 7.5 }));
  }
  return g;
}

// Inline SVG markup for HTML contexts (inspector badges, navigation chips).
function deviceIconSvg(isSensor, size = 24) {
  if (isSensor) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7.5 6v12M12 6v12M16.5 6v12M7 18v3M17 18v3"/></svg>`;
}

function renderDevice(device) {
  const [gx, gy] = SLOT_POS[device.slot] || [26, 14];
  const cx = px(gx);
  const cy = py(gy);
  const color = tempColor(device.temperature);
  const heating = device.mode === "heating";
  const off = device.on === false || device.mode === "off";
  const isSensor = device.kind === "sensor";
  const isActive = device.slot === activeSlot;

  const group = el("g", {
    class: `device ${device.kind}${heating ? " heating" : ""}${off ? " off" : ""}${isActive ? " active" : ""}`,
    "data-slot": device.slot,
  });

  // Subtle radiator fins behind thermostats
  if (!isSensor) {
    for (let dx = -12; dx <= 12; dx += 6) {
      group.appendChild(
        el("line", {
          x1: cx + dx,
          y1: cy - 19,
          x2: cx + dx,
          y2: cy - 15,
          class: "radiator-fin",
        })
      );
    }
  }

  // Interactive Halo
  group.appendChild(el("circle", { cx, cy, r: 24, class: "halo" }));

  // Marker Shape: Circle for Thermostats (1-9), Rounded Square for Sensors (A-D)
  if (isSensor) {
    const size = 27;
    group.appendChild(
      el("rect", {
        x: cx - size / 2,
        y: cy - size / 2,
        width: size,
        height: size,
        rx: 7,
        class: "marker",
        fill: color,
      })
    );
  } else {
    group.appendChild(
      el("circle", {
        cx,
        cy,
        r: 14,
        class: "marker",
        fill: color,
      })
    );
  }

  // Type icon inside the marker: radiator for thermostats, thermometer for sensors.
  group.appendChild(deviceIcon(isSensor, cx, cy));

  // Readout Pill Tag underneath Marker
  let pillLabel = `${fmt(device.temperature)}°`;
  if (showPlanDetails) {
    if (isSensor && device.humidity != null) {
      pillLabel = `${fmt(device.temperature)}° · ${fmt(device.humidity, 0)}%`;
    } else if (!isSensor && !off && device.target_temperature != null && device.target_temperature > 5.5) {
      pillLabel = `${fmt(device.temperature)}° → ${fmt(device.target_temperature, 0)}°`;
    } else if (off) {
      pillLabel = `${fmt(device.temperature)}° · AUS`;
    }
  }

  const pillW = Math.max(46, pillLabel.length * 6.8 + 12);
  const pillH = 18;
  const pillY = cy + 25;

  group.appendChild(
    el("rect", {
      x: cx - pillW / 2,
      y: pillY - pillH / 2,
      width: pillW,
      height: pillH,
      rx: 5,
      class: "readout-pill",
    })
  );

  const tempText = el("text", { x: cx, y: pillY, class: "temp-text" });
  tempText.textContent = pillLabel;
  group.appendChild(tempText);

  group.addEventListener("click", (e) => {
    e.stopPropagation();
    selectSlot(device.slot);
  });
  return group;
}

function updateActiveHighlight() {
  document.querySelectorAll(".device").forEach((node) => {
    node.classList.toggle("active", node.dataset.slot === activeSlot);
  });
  const overviewBtn = document.getElementById("btn-overview");
  if (overviewBtn) {
    overviewBtn.classList.toggle("active", activeSlot === null);
  }
}

/* ------------------------------------------------------------------ *
 * Render: Right-Hand Inspector Panel (#details)
 * ------------------------------------------------------------------ */

function selectSlot(slot) {
  activeSlot = slot;
  updateActiveHighlight();
  if (!state) return;
  const devices = getProjectedDevices();
  const roomStats = computeRoomStats(devices);
  renderPlan(devices, roomStats);
  renderInspector(devices, roomStats);
}

function renderInspector(devices, roomStats) {
  const panel = document.getElementById("details");
  if (!panel) return;

  if (activeSlot == null) {
    renderOverviewInspector(panel, devices, roomStats);
    return;
  }

  const device = devices.find((d) => d.slot === activeSlot);
  if (!device) {
    renderOverviewInspector(panel, devices, roomStats);
    return;
  }
  renderDetails(device, devices);
}

function renderOverviewInspector(panel, devices, roomStats) {
  const sortedRooms = [...roomStats.values()]
    .filter((r) => r.avgTemp != null)
    .sort((a, b) => b.avgTemp - a.avgTemp);

  const minR = sortedRooms.length ? Math.min(...sortedRooms.map((r) => r.avgTemp)) : 16;
  const maxR = sortedRooms.length ? Math.max(...sortedRooms.map((r) => r.avgTemp)) : 23;
  const span = Math.max(2, maxR - minR + 1.5);

  // Build apartment-wide average history per step
  const stepsCount = state.snapshots || 0;
  const aptHistory = [];
  for (let s = 0; s < stepsCount; s++) {
    const stepTemps = devices
      .map((d) => (d.history && d.history[s] ? d.history[s].temperature : null))
      .filter((v) => v != null);
    if (stepTemps.length) {
      const avg = stepTemps.reduce((a, b) => a + b, 0) / stepTemps.length;
      aptHistory.push({ step: s, temperature: Number(avg.toFixed(2)) });
    }
  }

  panel.innerHTML = `
    <div class="details-topbar">
      <span class="mono-tag" style="font-family:var(--font-mono);font-size:0.72rem;font-weight:700;color:var(--accent)">WOHNUNGS-INSPEKTOR</span>
      <span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--muted)">${sortedRooms.length} Räume aktiv</span>
    </div>

    <div class="details-head">
      <div>
        <div class="details-title">Raumklima-Spiegel</div>
        <div class="details-sub">Klicke auf einen Raum oder Slot für Einzel-Telemetrie</div>
      </div>
    </div>

    <div class="overview-list">
      ${sortedRooms
        .map((r) => {
          const pct = Math.max(12, Math.min(100, ((r.avgTemp - (minR - 0.8)) / span) * 100));
          const color = tempColor(r.avgTemp);
          const firstSlot = r.devices[0] ? r.devices[0].slot : "";
          return `
            <div class="room-rank-row" data-room-slot="${firstSlot}">
              <div class="room-rank-top">
                <span>${r.name}</span>
                <div class="room-rank-meta">
                  ${r.humidity != null ? `<span>${fmt(r.humidity, 0)}% rF</span>` : ""}
                  <strong style="color:${color}">${fmt(r.avgTemp)}°C</strong>
                </div>
              </div>
              <div class="room-rank-bar">
                <div class="room-rank-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>

    <div class="chart-box">
      <div class="spark-header">
        <span class="spark-title">Ø Wohnungstemperatur (${aptHistory.length} Messungen)</span>
      </div>
      ${sparkline(aptHistory, "temperature", null, getEffectiveStep())}
    </div>

    <div class="siblings-bar">
      <span class="siblings-label">Schnellwahl</span>
      <div class="siblings-list">
        ${devices
          .map(
            (d) =>
              `<button type="button" class="sibling-chip" data-jump-slot="${d.slot}" title="${d.location || d.room}">${deviceIconSvg(d.kind === "sensor", 13)} ${fmt(d.temperature)}°</button>`
          )
          .join("")}
      </div>
    </div>
  `;

  panel.querySelectorAll("[data-room-slot]").forEach((row) => {
    row.addEventListener("click", () => {
      if (row.dataset.roomSlot) selectSlot(row.dataset.roomSlot);
    });
  });

  panel.querySelectorAll("[data-jump-slot]").forEach((btn) => {
    btn.addEventListener("click", () => selectSlot(btn.dataset.jumpSlot));
  });
}

function renderDetails(device, allDevices) {
  const panel = document.getElementById("details");
  const color = tempColor(device.temperature);
  const off = device.on === false || device.mode === "off";
  const isSensor = device.kind === "sensor";
  const mInfo = modeInfo(device);
  const rf = rssiQuality(device.rssi);

  const sortedSlots = [...allDevices].sort((a, b) => slotSort(a.slot) - slotSort(b.slot));
  const curIdx = sortedSlots.findIndex((d) => d.slot === device.slot);
  const prevDevice = sortedSlots[(curIdx - 1 + sortedSlots.length) % sortedSlots.length];
  const nextDevice = sortedSlots[(curIdx + 1) % sortedSlots.length];
  const prevSlot = prevDevice.slot;
  const nextSlot = nextDevice.slot;

  const histTemps = (device.history || []).map((h) => h.temperature).filter((v) => v != null);
  const minHist = histTemps.length ? Math.min(...histTemps) : null;
  const maxHist = histTemps.length ? Math.max(...histTemps) : null;

  const deltaClass =
    device.deltaTemp > 0 ? "up" : device.deltaTemp < 0 ? "down" : "";
  const deltaText =
    device.deltaTemp == null
      ? "±0.0°C"
      : `${device.deltaTemp > 0 ? "+" : ""}${fmt(device.deltaTemp)}°C`;

  const secondaryHero = isSensor
    ? `
      <div class="hero-col">
        <div class="hero-k">Rel. Luftfeuchte</div>
        <div class="hero-v">${fmt(device.humidity, 0)}% <span class="hero-delta">${device.humidity >= 40 && device.humidity <= 60 ? "Optimal" : "Klima"}</span></div>
        <div class="hero-sub">Komfortzone: 40% – 60% rF</div>
      </div>
    `
    : `
      <div class="hero-col">
        <div class="hero-k">Zieltemperatur</div>
        <div class="hero-v">${fmt(device.target_temperature)}°C</div>
        <div class="hero-sub">${
          off
            ? "Thermostat ausgeschaltet"
            : device.target_temperature <= 6
            ? "Frostschutz-Modus aktiv"
            : `Differenz: ${fmt(device.temperature - device.target_temperature)}°C`
        }</div>
      </div>
    `;

  const metrics = [
    ["Betriebsmodus", mInfo.label],
    [
      isSensor ? "Sensortyp" : "Soll-Vorgabe",
      isSensor ? `${device.model || "T310"} Klima` : `${fmt(device.target_temperature)} °C`,
    ],
    [
      "Luftfeuchtigkeit",
      device.humidity != null ? `${fmt(device.humidity, 0)} % rF` : "– (nur Sensor)",
    ],
    [
      "Batteriestatus",
      device.battery != null
        ? `<span>${fmt(device.battery, 0)} %</span><span class="mini-bar"><i style="width:${device.battery}%;background:${device.battery >= 40 ? "var(--good)" : "var(--warm)"}"></i></span>`
        : "Netz / k.A.",
    ],
    [
      "Funk-Signal (RSSI)",
      device.rssi != null
        ? `<span>${device.rssi} dBm</span><span class="mini-bar"><i style="width:${rf.pct}%;background:${rf.color}"></i></span>`
        : "–",
    ],
    ["Hardware / MAC", `${device.model || "Kasa"}${device.mac ? ` · ${device.mac.slice(-8)}` : ""}`],
  ];

  const siblings = allDevices.filter((d) => d.room === device.room && d.slot !== device.slot);

  panel.innerHTML = `
    <div class="details-topbar">
      <button type="button" class="nav-mini-btn" id="btn-back-overview">← Wohnungs-Übersicht</button>
      <div class="details-nav-btns">
        <button type="button" class="nav-mini-btn" id="btn-prev-slot" title="Vorheriges Gerät: ${prevDevice.location || prevDevice.room}">‹ ${deviceIconSvg(prevDevice.kind === "sensor", 13)} ${prevDevice.location || prevDevice.room}</button>
        <button type="button" class="nav-mini-btn" id="btn-next-slot" title="Nächstes Gerät: ${nextDevice.location || nextDevice.room}">${deviceIconSvg(nextDevice.kind === "sensor", 13)} ${nextDevice.location || nextDevice.room} ›</button>
      </div>
    </div>

    <div class="details-head">
      <div class="details-head-left">
        <div class="details-badge ${isSensor ? "sensor" : ""}" style="background:${off ? "var(--off)" : color};color:#ffffff" title="${isSensor ? "Klima-Sensor" : "Radiator-Thermostat"}">${deviceIconSvg(isSensor, 26)}</div>
        <div>
          <div class="details-title">${device.room}</div>
          <div class="details-sub">
            ${isSensor ? "Klima-Sensor" : "Radiator-Thermostat"} · ${device.location || device.name || ""}
          </div>
        </div>
      </div>
      <span class="state-pill ${mInfo.cls}">${mInfo.short}</span>
    </div>

    <div class="hero-readout">
      <div class="hero-col">
        <div class="hero-k">Ist-Temperatur</div>
        <div class="hero-v">
          <span>${fmt(device.temperature)}°C</span>
          <span class="hero-delta ${deltaClass}">${deltaText}</span>
        </div>
        <div class="hero-sub">Spanne: ${fmt(minHist)}°C – ${fmt(maxHist)}°C</div>
      </div>
      ${secondaryHero}
    </div>

    <div class="chart-box">
      <div class="spark-header">
        <span class="spark-title">Temperaturverlauf (${device.history.length} Werte)</span>
        <span class="spark-stats">Min ${fmt(minHist)}° · Max ${fmt(maxHist)}°</span>
      </div>
      ${sparkline(
        device.history,
        "temperature",
        device.kind === "thermostat" ? "target_temperature" : null,
        device.activeStepIndex
      )}
    </div>

    ${
      device.humidity != null
        ? `
          <div class="chart-box">
            <div class="spark-header">
              <span class="spark-title">Luftfeuchteverlauf (%)</span>
              <span class="spark-stats">Aktuell ${fmt(device.humidity, 0)}% rF</span>
            </div>
            ${sparkline(device.history, "humidity", null, device.activeStepIndex)}
          </div>
        `
        : ""
    }

    <div class="metric-grid">
      ${metrics
        .map(
          ([k, v]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div></div>`
        )
        .join("")}
    </div>

    ${
      siblings.length
        ? `
          <div class="siblings-bar">
            <span class="siblings-label">Im selben Raum (${device.room})</span>
            <div class="siblings-list">
              ${siblings
                .map(
                  (s) =>
                    `<button type="button" class="sibling-chip" data-sibling-slot="${s.slot}" title="${s.location || s.room}">${deviceIconSvg(s.kind === "sensor", 13)} ${s.location || s.room} · ${fmt(s.temperature)}°</button>`
                )
                .join("")}
            </div>
          </div>
        `
        : ""
    }
  `;

  document.getElementById("btn-back-overview")?.addEventListener("click", () => {
    selectSlot(null);
  });
  document.getElementById("btn-prev-slot")?.addEventListener("click", () => {
    selectSlot(prevSlot);
  });
  document.getElementById("btn-next-slot")?.addEventListener("click", () => {
    selectSlot(nextSlot);
  });
  panel.querySelectorAll("[data-sibling-slot]").forEach((btn) => {
    btn.addEventListener("click", () => selectSlot(btn.dataset.siblingSlot));
  });
}

function sparkline(history, key, targetKey, activeStepIdx = null) {
  const w = 360;
  const h = 112;
  const pad = { top: 16, right: 14, bottom: 18, left: 34 };
  const values = (history || []).map((h) => h[key]).filter((v) => v != null);
  if (!values.length) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`;

  // Latest target (Soll) value for this series, if any. It is folded into the
  // Y domain below so the dashed target line is always drawn, even for
  // thermostats switched off/away where the target sits far from the room temp.
  const targetPoint = targetKey
    ? [...history].reverse().find((p) => p[targetKey] != null)
    : null;
  const target = targetPoint ? targetPoint[targetKey] : null;

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (target != null) {
    min = Math.min(min, target);
    max = Math.max(max, target);
  }
  // Widen the temperature axis by ±5 °C so the lines and target are not glued
  // to the chart edges. Humidity keeps a tight, percentage-only scale.
  if (key === "temperature") {
    min -= 5;
    max += 5;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min || 1;
  const n = Math.max(history.length - 1, 1);
  const x = (i) => pad.left + (i / n) * (w - pad.left - pad.right);
  const y = (v) => pad.top + (1 - (v - min) / span) * (h - pad.top - pad.bottom);

  const ptsArray = history
    .map((point, i) => (point[key] == null ? null : { i, x: x(i), y: y(point[key]), val: point[key] }))
    .filter(Boolean);

  const pts = ptsArray.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${ptsArray[0].x.toFixed(1)},${h - pad.bottom} ${pts} ${ptsArray[ptsArray.length - 1].x.toFixed(1)},${h - pad.bottom}`;
  const unit = key === "humidity" ? "%" : "°";
  const strokeColor = key === "humidity" ? "#0d9488" : "#0284c7";
  const fillColor = key === "humidity" ? "rgba(13, 148, 136, 0.13)" : "rgba(2, 132, 199, 0.13)";
  const midVal = (min + max) / 2;

  const targetLine = target != null
    ? (() => {
        const ty = y(target);
        return `<line x1="${pad.left}" y1="${ty.toFixed(1)}" x2="${w - pad.right}" y2="${ty.toFixed(1)}"
                 stroke="#f97316" stroke-dasharray="4 3" stroke-width="1.3" />
                <text x="${w - pad.right}" y="${(ty - 4).toFixed(1)}" fill="#f97316" font-family="JetBrains Mono, monospace" font-size="9.5" text-anchor="end">
                  Ziel ${fmt(target)}${unit}</text>`;
      })()
    : "";

  const dots = ptsArray
    .map((p) => {
      const isSelected = activeStepIdx != null && p.i === activeStepIdx;
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isSelected ? 4.2 : 2.3}"
                fill="${isSelected ? "#ffffff" : strokeColor}" stroke="${strokeColor}" stroke-width="${isSelected ? 2.2 : 1}">
                <title>Messung #${p.i + 1}: ${fmt(p.val, key === "humidity" ? 0 : 1)}${unit}</title>
              </circle>`;
    })
    .join("");

  return `
    <svg class="spark" viewBox="0 0 ${w} ${h}">
      <line x1="${pad.left}" y1="${pad.top}" x2="${w - pad.right}" y2="${pad.top}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3" />
      <line x1="${pad.left}" y1="${y(midVal).toFixed(1)}" x2="${w - pad.right}" y2="${y(midVal).toFixed(1)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3" />
      <line x1="${pad.left}" y1="${h - pad.bottom}" x2="${w - pad.right}" y2="${h - pad.bottom}" stroke="var(--line)" stroke-width="1" />

      <polygon points="${area}" fill="${fillColor}" />
      <polyline points="${pts}" fill="none" stroke="${strokeColor}" stroke-width="2.2"
                stroke-linejoin="round" stroke-linecap="round" />
      ${targetLine}
      ${dots}

      <text x="${pad.left - 5}" y="${pad.top + 3}" fill="var(--muted)" font-family="JetBrains Mono, monospace" font-size="9.5" text-anchor="end">${fmt(max, key === "humidity" ? 0 : 1)}${unit}</text>
      <text x="${pad.left - 5}" y="${y(midVal) + 3}" fill="var(--muted)" font-family="JetBrains Mono, monospace" font-size="9.5" text-anchor="end">${fmt(midVal, key === "humidity" ? 0 : 1)}${unit}</text>
      <text x="${pad.left - 5}" y="${h - pad.bottom + 3}" fill="var(--muted)" font-family="JetBrains Mono, monospace" font-size="9.5" text-anchor="end">${fmt(min, key === "humidity" ? 0 : 1)}${unit}</text>
    </svg>
  `;
}

/* ------------------------------------------------------------------ *
 * UI Controls & Event Bindings
 * ------------------------------------------------------------------ */

function initControls() {
  // Theme Persistence & Toggle (Light Mode Default)
  const savedTheme = localStorage.getItem("klima-theme-v2");
  if (savedTheme === "light" || savedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", savedTheme);
  } else {
    document.documentElement.setAttribute("data-theme", "light");
  }

  document.getElementById("btn-theme")?.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("klima-theme-v2", next);
    renderAll();
  });

  document.getElementById("btn-refresh")?.addEventListener("click", () => {
    load(true);
  });

  // Floorplan Toggles
  const btnHeatmap = document.getElementById("toggle-heatmap");
  btnHeatmap?.addEventListener("click", () => {
    showHeatmap = !showHeatmap;
    btnHeatmap.classList.toggle("active", showHeatmap);
    renderAll();
  });

  const btnTargets = document.getElementById("toggle-targets");
  btnTargets?.addEventListener("click", () => {
    showPlanDetails = !showPlanDetails;
    btnTargets.classList.toggle("active", showPlanDetails);
    renderAll();
  });

  document.getElementById("btn-overview")?.addEventListener("click", () => {
    selectSlot(null);
  });

  // Scrubber Controls
  document.getElementById("scrub-range")?.addEventListener("input", (e) => {
    setStep(Number(e.target.value));
  });
  document.getElementById("scrub-prev")?.addEventListener("click", () => {
    setStep(getEffectiveStep() - 1);
  });
  document.getElementById("scrub-next")?.addEventListener("click", () => {
    setStep(getEffectiveStep() + 1);
  });
  document.getElementById("scrub-live")?.addEventListener("click", () => {
    if (state) setStep((state.snapshots || 1) - 1);
  });
  document.getElementById("scrub-play")?.addEventListener("click", () => {
    togglePlayback();
  });

  // Keyboard Navigation
  window.addEventListener("keydown", (e) => {
    if (e.target && ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
    if (e.key === "Escape" && activeSlot !== null) {
      selectSlot(null);
    }
  });
}

/* ------------------------------ init ------------------------------ */

document.getElementById("source").textContent = "PostgreSQL";
initControls();
load();
setInterval(() => load(false), 60000);
