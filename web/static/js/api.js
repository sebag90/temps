import { state, setState, customRange, isLiveView, selectedStep, setSelectedStep } from "./state.js";
import { renderAll, setStatus } from "./controls.js";

export function formatLastMeasurement() {
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

export async function load(manual = false) {
  const refreshBtn = document.getElementById("btn-refresh");
  if (manual && refreshBtn) {
    refreshBtn.classList.add("spinning");
    setTimeout(() => refreshBtn.classList.remove("spinning"), 650);
  }

  try {
    let url = "/api/state";
    const params = new URLSearchParams();
    if (customRange.start) params.set("start", customRange.start);
    if (customRange.end) params.set("end", customRange.end);
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const wasAtLatest = isLiveView();
    const newState = await res.json();
    setState(newState);
    if (wasAtLatest) {
      setSelectedStep(Math.max(0, (newState.snapshots || 1) - 1));
    } else {
      setSelectedStep(Math.min(selectedStep, Math.max(0, (newState.snapshots || 1) - 1)));
    }
    renderAll();
  } catch (err) {
    setStatus("error", `Fehler beim Laden: ${err.message}`);
  }
}
