import { state, activeSlot, setActiveSlot, getEffectiveStep, getProjectedDevices, computeRoomStats } from "./state.js";
import { tempColor, fmt, thermostatIsOff, modeInfo, rssiQuality, slotSort } from "./helpers.js";
import { deviceIconSvg, renderPlan, updateActiveHighlight } from "./plan.js";
import { sparkline, attachSparklineInteractions } from "./charts.js";

export function selectSlot(slot) {
  setActiveSlot(slot);
  updateActiveHighlight();
  if (!state) return;
  const devices = getProjectedDevices();
  const roomStats = computeRoomStats(devices);
  renderPlan(devices, roomStats);
  renderInspector(devices, roomStats);
}

export function renderInspector(devices, roomStats) {
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

export function renderOverviewInspector(panel, devices, roomStats) {
  const sortedRooms = [...roomStats.values()]
    .filter((r) => r.avgTemp != null)
    .sort((a, b) => b.avgTemp - a.avgTemp);

  const minR = sortedRooms.length ? Math.min(...sortedRooms.map((r) => r.avgTemp)) : 16;
  const maxR = sortedRooms.length ? Math.max(...sortedRooms.map((r) => r.avgTemp)) : 23;
  const span = Math.max(2, maxR - minR + 1.5);

  const stepsCount = state ? state.snapshots || 0 : 0;
  const aptHistory = [];
  for (let s = 0; s < stepsCount; s++) {
    const stepTemps = devices
      .map((d) => (d.history && d.history[s] ? d.history[s].temperature : null))
      .filter((v) => v != null);
    if (stepTemps.length) {
      const avg = stepTemps.reduce((a, b) => a + b, 0) / stepTemps.length;
      aptHistory.push({
        step: s,
        temperature: Number(avg.toFixed(2)),
        collected_at: state.timestamps ? state.timestamps[s] : null,
      });
    }
  }

  const sortedDevices = [...devices].sort((a, b) => slotSort(a.slot) - slotSort(b.slot));

  panel.innerHTML = `
    <div class="details-topbar">
      <span class="mono-tag" style="font-family:var(--font-mono);font-size:0.72rem;font-weight:700;color:var(--accent)">WOHNUNGS-INSPEKTOR</span>
      <span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--muted)">${sortedRooms.length} Räume · ${devices.length} Geräte</span>
    </div>

    <div class="details-head">
      <div>
        <div class="details-title">Raumklima-Spiegel</div>
        <div class="details-sub">Klicke auf einen Raum oder ein Gerät für Einzel-Telemetrie</div>
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

  attachSparklineInteractions(panel);
}

export function renderDetails(device, allDevices) {
  const panel = document.getElementById("details");
  const color = tempColor(device.temperature);
  const off = thermostatIsOff(device);
  const isSensor = device.kind === "sensor";
  const mInfo = modeInfo(device);
  const roomTemp = device.roomTemperature != null ? device.roomTemperature : device.temperature;
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
        <div class="hero-v">${off ? "0°C" : `${fmt(device.target_temperature)}°C`}</div>
        <div class="hero-sub">${
          off
            ? "Thermostat ausgeschaltet"
            : device.target_temperature <= 6
            ? "Frostschutz-Modus aktiv"
            : `Differenz: ${fmt(roomTemp - device.target_temperature)}°C${
                device.roomTemperatureSource === "sensor" ? " · Raum-Sensor" : ""
              }`
        }</div>
      </div>
    `;

  const metrics = [
    ["Betriebsmodus", mInfo.label],
    ...(isSensor
      ? []
      : [[
          "Raumtemperatur (Regelung)",
          `${fmt(roomTemp)} °C · ${device.roomTemperatureSource === "sensor" ? "Sensor" : "Thermostat"}`,
        ]]),
    [
      isSensor ? "Sensortyp" : "Soll-Vorgabe",
      isSensor ? `${device.model || "T310"} Klima` : (off ? "0.0 °C (Aus)" : `${fmt(device.target_temperature)} °C`),
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

  attachSparklineInteractions(panel);
}
