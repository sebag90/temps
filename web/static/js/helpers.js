import { SCALE, MARGIN } from "./constants.js";

export const SVG_NS = "http://www.w3.org/2000/svg";

export const px = (x) => MARGIN + x * SCALE.x;
export const py = (y) => MARGIN + y * SCALE.y;

export const el = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, v);
  }
  return node;
};

export const fmt = (v, digits = 1) => (v == null || Number.isNaN(Number(v)) ? "–" : Number(v).toFixed(digits));

export function tempColor(t) {
  if (t == null) return "#8b94a3";
  const min = 20;
  const max = 25;
  const ratio = Math.max(0, Math.min(1, (t - min) / (max - min)));
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const hue = Math.round(202 - ratio * 186);
  const sat = isDark ? Math.round(78 + ratio * 10) : Math.round(74 + ratio * 12);
  const light = isDark ? Math.round(52 + Math.sin(ratio * Math.PI) * 4) : Math.round(42 + Math.sin(ratio * Math.PI) * 3);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export function roomThermalFill(t, showHeatmap) {
  if (!showHeatmap || t == null) return "rgba(3, 105, 161, 0.03)";
  const min = 20;
  const max = 25;
  const ratio = Math.max(0, Math.min(1, (t - min) / (max - min)));
  const hue = Math.round(202 - ratio * 186);
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const alpha = isDark ? 0.11 : 0.15;
  return `hsla(${hue}, 78%, 48%, ${alpha})`;
}

export const slotSort = (slot) =>
  /^[0-9]+$/.test(slot) ? Number(slot) : 100 + slot.charCodeAt(0);

export function rssiQuality(rssi) {
  if (rssi == null) return { label: "–", pct: 0, color: "var(--muted)" };
  if (rssi >= -55) return { label: "Exzellent", pct: 100, color: "var(--good)" };
  if (rssi >= -68) return { label: "Gut", pct: 75, color: "var(--good)" };
  if (rssi >= -78) return { label: "Mittel", pct: 50, color: "var(--warm)" };
  return { label: "Schwach", pct: 25, color: "var(--heating)" };
}

export function thermostatIsOff(device) {
  return device.on === false || device.mode === "off";
}

export function isThermostatHeating(device) {
  if (device.kind !== "thermostat" || thermostatIsOff(device)) return false;
  const roomTemp = device.roomTemperature;
  const target = device.target_temperature;
  if (roomTemp == null || target == null) return device.mode === "heating";
  return roomTemp < target;
}

export function modeInfo(device) {
  if (device.kind === "sensor") {
    return { label: "Aktiv · Klima", cls: "ready", short: "Aktiv" };
  }
  if (thermostatIsOff(device)) {
    return { label: "Ausgeschaltet", cls: "off", short: "Aus" };
  }
  if (device.heating) {
    return { label: "Heizt aktiv", cls: "heating", short: "Heizt" };
  }
  if (device.target_temperature != null && device.target_temperature <= 6.0) {
    return { label: "Frostschutz (5°)", cls: "frost", short: "Frostschutz" };
  }
  return { label: "Bereit (Idle)", cls: "ready", short: "Bereit" };
}

export const escapeAttr = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export function chartTimeLabel(raw) {
  if (!raw) return "";
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return "";
  const time = when.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const sameDay = when.toDateString() === new Date().toDateString();
  return sameDay
    ? time
    : `${when.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${time}`;
}

export function isoToDatetimeLocal(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function datetimeLocalToIso(localStr) {
  if (!localStr) return null;
  const d = new Date(localStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
