import { ROOMS } from "./constants.js";
import { isThermostatHeating } from "./helpers.js";

export let state = null;
export let activeSlot = null;
export let selectedStep = null;
export let showHeatmap = true;
export let showPlanDetails = true;
export let playTimer = null;
export let customRange = { start: null, end: null };

export function setState(newState) {
  state = newState;
}

export function setActiveSlot(slot) {
  activeSlot = slot;
}

export function setSelectedStep(step) {
  selectedStep = step;
}

export function setShowHeatmap(val) {
  showHeatmap = val;
}

export function setShowPlanDetails(val) {
  showPlanDetails = val;
}

export function setPlayTimer(timer) {
  playTimer = timer;
}

export function setCustomRange(range) {
  customRange = range;
}

export function getEffectiveStep() {
  if (!state || !state.snapshots) return 0;
  const maxStep = Math.max(0, state.snapshots - 1);
  if (selectedStep == null || selectedStep >= maxStep) return maxStep;
  return Math.max(0, selectedStep);
}

export function isLiveView() {
  if (!state || !state.snapshots) return true;
  return getEffectiveStep() >= state.snapshots - 1;
}

export function getProjectedDevices() {
  if (!state || !state.devices) return [];
  const step = getEffectiveStep();
  const projected = state.devices.map((d) => {
    const history = d.history || [];
    if (!history.length) return { ...d, prevTemp: null, deltaTemp: null };
    const idx = Math.min(step, history.length - 1);
    const snap = history[idx] || {};
    const prevSnap = idx > 0 ? history[idx - 1] : null;
    const temp = snap.temperature !== undefined ? snap.temperature : d.temperature;
    const prevTemp = prevSnap && prevSnap.temperature != null ? prevSnap.temperature : null;
    const deltaTemp = temp != null && prevTemp != null ? Number((temp - prevTemp).toFixed(1)) : null;

    const mode = snap.mode !== undefined ? snap.mode : d.mode;
    const on = snap.on !== undefined ? snap.on : d.on;
    const isOff = on === false || mode === "off";
    let target = snap.target_temperature !== undefined ? snap.target_temperature : d.target_temperature;
    if (d.kind === "thermostat" && isOff) {
      target = 0;
    }

    return {
      ...d,
      temperature: temp,
      target_temperature: target,
      humidity: snap.humidity !== undefined ? snap.humidity : d.humidity,
      battery: snap.battery !== undefined ? snap.battery : d.battery,
      mode,
      on,
      rssi: snap.rssi !== undefined ? snap.rssi : d.rssi,
      prevTemp,
      deltaTemp,
      activeStepIndex: idx,
    };
  });

  const sensorTemps = new Map();
  for (const d of projected) {
    if (d.kind === "sensor" && d.temperature != null) {
      sensorTemps.set(d.room, d.temperature);
    }
  }

  for (const d of projected) {
    const hasRoomSensor = d.kind === "thermostat" && sensorTemps.has(d.room);
    d.roomTemperature = hasRoomSensor ? sensorTemps.get(d.room) : d.temperature;
    d.roomTemperatureSource = d.kind === "sensor" || hasRoomSensor ? "sensor" : "thermostat";
    d.heating = isThermostatHeating(d);
  }

  return projected;
}

export function computeRoomStats(devices) {
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
    if (d.kind === "sensor" && d.humidity != null) entry.humidity = d.humidity;
    if (d.heating) entry.heating = true;
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
