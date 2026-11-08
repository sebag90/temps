import { state, selectedStep, setSelectedStep, getEffectiveStep, isLiveView, playTimer, setPlayTimer, customRange, setCustomRange, showHeatmap, setShowHeatmap, showPlanDetails, setShowPlanDetails, getProjectedDevices, computeRoomStats } from "./state.js";
import { load, formatLastMeasurement } from "./api.js";
import { renderPlan, deviceIconSvg } from "./plan.js";
import { renderInspector } from "./inspector.js";
import { largeSparkline, attachSparklineInteractions } from "./charts.js";
import { fmt, tempColor, thermostatIsOff, modeInfo, isoToDatetimeLocal, datetimeLocalToIso } from "./helpers.js";

export function setStatus(cls, msg) {
  const badge = document.getElementById("status-dot");
  const text = document.getElementById("meta-text");
  if (!badge || !text) return;
  badge.className = `status-dot ${cls}`;
  text.textContent = msg;
}

export function updateStatusHeader() {
  const lastStr = formatLastMeasurement();
  if (lastStr) {
    setStatus("good", `Verbunden · Letzte Messung ${lastStr}`);
  } else if (state && state.status === "error") {
    setStatus("error", `Fehler: ${state.error || "Unbekannt"}`);
  } else {
    setStatus("good", "Verbunden · System aktiv");
  }
}

export function updateFooter() {
  const footer = document.getElementById("snapshot-info");
  const sourceCode = document.getElementById("source");
  if (!state) return;
  const count = state.snapshots || 0;
  const dbType = state.db_type || "sqlite";
  if (footer) footer.textContent = `${count} Snapshots im Speicher`;
  if (sourceCode) sourceCode.textContent = dbType === "postgres" ? "PostgreSQL" : "SQLite";
}

export function updateKPIs(devices) {
  const heatCount = devices.filter((d) => d.heating).length;
  const roomTemps = devices.map((d) => d.temperature).filter((v) => v != null);
  const avgTemp = roomTemps.length ? roomTemps.reduce((a, b) => a + b, 0) / roomTemps.length : null;

  const hums = devices.map((d) => d.humidity).filter((v) => v != null);
  const avgHum = hums.length ? hums.reduce((a, b) => a + b, 0) / hums.length : null;

  const kpiTemp = document.getElementById("kpi-avg-temp");
  const kpiHum = document.getElementById("kpi-avg-hum");
  const kpiHeat = document.getElementById("kpi-heating-status");
  const kpiTempSpread = document.getElementById("kpi-temp-spread");
  const kpiHealth = document.getElementById("kpi-health");
  const kpiHealthSub = document.getElementById("kpi-health-sub");

  if (kpiTemp) kpiTemp.textContent = avgTemp != null ? `${fmt(avgTemp)}°C` : "–";
  if (kpiHum) kpiHum.textContent = avgHum != null ? `${fmt(avgHum, 0)}%` : "–";
  if (kpiHeat) kpiHeat.textContent = heatCount > 0 ? `${heatCount} aktiv` : "Standby";
  if (kpiTempSpread && roomTemps.length) {
    const minT = Math.min(...roomTemps);
    const maxT = Math.max(...roomTemps);
    kpiTempSpread.textContent = `Min ${fmt(minT)}° · Max ${fmt(maxT)}°C`;
  }
  const bats = devices.map((d) => d.battery).filter((v) => v != null);
  const minBat = bats.length ? Math.min(...bats) : null;
  if (kpiHealth) kpiHealth.textContent = minBat != null ? `Min ${minBat}%` : "100%";
  if (kpiHealthSub) kpiHealthSub.textContent = `${devices.length} Geräte aktiv`;
}

export function updateScrubberUI() {
  const scrubber = document.getElementById("scrub-range");
  const badge = document.getElementById("scrub-badge");
  const label = document.getElementById("scrub-label");

  if (!state || !state.snapshots || state.snapshots <= 1) {
    if (scrubber) {
      scrubber.disabled = true;
      scrubber.max = 0;
      scrubber.value = 0;
    }
    if (badge) {
      badge.textContent = "AKTUELL";
      badge.className = "scrub-badge live";
    }
    if (label) label.textContent = "Messung 1 / 1";
    return;
  }

  const max = state.snapshots - 1;
  const step = getEffectiveStep();
  if (scrubber) {
    scrubber.disabled = false;
    scrubber.max = max;
    scrubber.value = step;
  }

  if (badge && label) {
    const timestamps = state.timestamps || [];
    const ts = timestamps[step];
    const timeStr = ts
      ? new Date(ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : `#${step + 1}`;

    if (isLiveView()) {
      badge.textContent = "AKTUELL";
      badge.className = "scrub-badge live";
      label.textContent = `Live · ${timeStr}`;
    } else {
      badge.textContent = "VERLAUF";
      badge.className = "scrub-badge history";
      label.textContent = timeStr;
    }
  }
}

export function setStep(newStep) {
  if (!state || !state.snapshots) return;
  const max = state.snapshots - 1;
  setSelectedStep(Math.max(0, Math.min(max, newStep)));
  renderAll();
}

export function togglePlayback() {
  if (playTimer) {
    clearInterval(playTimer);
    setPlayTimer(null);
    const playIcon = document.getElementById("scrub-play-icon");
    if (playIcon) {
      playIcon.innerHTML = `<path d="M4.5 3.2a.7.7 0 0 1 1.06-.6l7.2 4.8a.7.7 0 0 1 0 1.2l-7.2 4.8a.7.7 0 0 1-1.06-.6V3.2Z" />`;
    }
    return;
  }

  if (!state || !state.snapshots || state.snapshots <= 1) return;
  if (isLiveView()) {
    setSelectedStep(0);
  }

  const playIcon = document.getElementById("scrub-play-icon");
  if (playIcon) {
    playIcon.innerHTML = `<path d="M5 3h2v10H5V3Zm6 0h2v10h-2V3Z" />`;
  }

  const timer = setInterval(() => {
    if (!state || !state.snapshots) {
      clearInterval(timer);
      setPlayTimer(null);
      if (playIcon) playIcon.innerHTML = `<path d="M4.5 3.2a.7.7 0 0 1 1.06-.6l7.2 4.8a.7.7 0 0 1 0 1.2l-7.2 4.8a.7.7 0 0 1-1.06-.6V3.2Z" />`;
      return;
    }
    const current = getEffectiveStep();
    if (current >= state.snapshots - 1) {
      clearInterval(timer);
      setPlayTimer(null);
      if (playIcon) playIcon.innerHTML = `<path d="M4.5 3.2a.7.7 0 0 1 1.06-.6l7.2 4.8a.7.7 0 0 1 0 1.2l-7.2 4.8a.7.7 0 0 1-1.06-.6V3.2Z" />`;
    } else {
      setStep(current + 1);
    }
  }, 900);
  setPlayTimer(timer);
}

export function renderAll() {
  const devices = getProjectedDevices();
  const roomStats = computeRoomStats(devices);
  renderPlan(devices, roomStats);
  renderInspector(devices, roomStats);
  updateStatusHeader();
  updateFooter();
  updateKPIs(devices);
  updateScrubberUI();
}

export function initControls() {
  document.getElementById("btn-refresh")?.addEventListener("click", () => load(true));

  const scrubber = document.getElementById("scrub-range");
  scrubber?.addEventListener("input", (e) => {
    if (playTimer) {
      clearInterval(playTimer);
      setPlayTimer(null);
      const playIcon = document.getElementById("scrub-play-icon");
      if (playIcon) playIcon.innerHTML = `<path d="M4.5 3.2a.7.7 0 0 1 1.06-.6l7.2 4.8a.7.7 0 0 1 0 1.2l-7.2 4.8a.7.7 0 0 1-1.06-.6V3.2Z" />`;
    }
    setStep(Number(e.target.value));
  });

  document.getElementById("scrub-play")?.addEventListener("click", togglePlayback);
  document.getElementById("scrub-prev")?.addEventListener("click", () => setStep(getEffectiveStep() - 1));
  document.getElementById("scrub-next")?.addEventListener("click", () => setStep(getEffectiveStep() + 1));
  document.getElementById("scrub-live")?.addEventListener("click", () => {
    if (state && state.snapshots) setStep(state.snapshots - 1);
  });

  document.querySelectorAll(".theme-btn, .theme-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("theme", next);
      renderAll();
    });
  });

  const savedTheme = localStorage.getItem("theme");
  if (savedTheme) {
    document.documentElement.setAttribute("data-theme", savedTheme);
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    document.documentElement.setAttribute("data-theme", "dark");
  }

  initModalControls();
}

export function initModalControls() {
  const modal = document.getElementById("timerange-modal");
  const btnOpens = document.querySelectorAll("#btn-timerange, #btn-timerange-plan");
  const btnClose = document.getElementById("modal-close-btn");
  const applyBtn = document.getElementById("modal-apply-btn");
  const backBtn = document.getElementById("modal-back-btn");
  const modalCard = document.getElementById("modal-card");
  const startInput = document.getElementById("modal-start");
  const endInput = document.getElementById("modal-end");
  const checkboxesContainer = document.getElementById("modal-device-checkboxes");
  const selectAllBtn = document.getElementById("select-all-devices");
  const selectThermostatsBtn = document.getElementById("select-thermostats-devices");
  const selectSensorsBtn = document.getElementById("select-sensors-devices");
  const selectNoneBtn = document.getElementById("deselect-all-devices");
  const stepForm = document.getElementById("modal-step-form");
  const stepGraph = document.getElementById("modal-step-graph");
  const graphsContainer = document.getElementById("modal-graphs-container");
  const boundsInfo = document.getElementById("modal-bounds-info");
  const rangeBadge = document.getElementById("modal-range-badge");
  const countBadge = document.getElementById("modal-devices-count-badge");
  const filterPills = document.getElementById("modal-filter-pills");

  if (!modal) return;

  const populateCheckboxes = () => {
    if (!checkboxesContainer) return;
    const devices = state && state.devices ? state.devices : [];
    checkboxesContainer.innerHTML = devices
      .map(
        (d) => `
          <label class="device-checkbox-item modal-checkbox-item" data-kind="${d.kind}">
            <input type="checkbox" name="device-select" value="${d.slot}" data-kind="${d.kind}" checked />
            <span style="display:inline-flex;align-items:center;gap:6px;">
              ${deviceIconSvg(d.kind === "sensor", 14)}
              <strong>${d.room}</strong> (${d.location || d.kind})
            </span>
          </label>
        `
      )
      .join("");
  };

  const openModal = async () => {
    if (!state) {
      await load(false);
    }
    if (state) {
      if (startInput) startInput.value = isoToDatetimeLocal(state.start_timestamp);
      if (endInput) endInput.value = isoToDatetimeLocal(state.end_timestamp);
      if (boundsInfo) {
        const earliest = state.earliest_timestamp
          ? new Date(state.earliest_timestamp).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })
          : "–";
        boundsInfo.textContent = `Frühester Eintrag in der Datenbank: ${earliest}`;
      }
    }
    populateCheckboxes();
    modal.style.display = "flex";
  };

  const closeModal = () => {
    modal.style.display = "none";
    if (modalCard) modalCard.classList.remove("is-expanded");
    if (stepForm) stepForm.style.display = "block";
    if (stepGraph) stepGraph.style.display = "none";
    if (graphsContainer) graphsContainer.innerHTML = "";
  };

  btnOpens.forEach((b) => b.addEventListener("click", openModal));
  btnClose?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  selectAllBtn?.addEventListener("click", () => {
    checkboxesContainer?.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = true));
  });

  selectThermostatsBtn?.addEventListener("click", () => {
    checkboxesContainer?.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.checked = cb.dataset.kind === "thermostat";
    });
  });

  selectSensorsBtn?.addEventListener("click", () => {
    checkboxesContainer?.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.checked = cb.dataset.kind === "sensor";
    });
  });

  selectNoneBtn?.addEventListener("click", () => {
    checkboxesContainer?.querySelectorAll("input[type=checkbox]").forEach((cb) => (cb.checked = false));
  });

  document.querySelectorAll(".preset-btn[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      const now = new Date();
      let start = new Date(now);
      if (preset === "24h") start.setHours(start.getHours() - 24);
      else if (preset === "48h") start.setHours(start.getHours() - 48);
      else if (preset === "7d") start.setDate(start.getDate() - 7);
      else if (preset === "all" && state && state.earliest_timestamp) {
        start = new Date(state.earliest_timestamp);
      } else {
        start.setHours(start.getHours() - 24);
      }
      if (startInput) startInput.value = isoToDatetimeLocal(start.toISOString());
      if (endInput) endInput.value = isoToDatetimeLocal(now.toISOString());
    });
  });

  backBtn?.addEventListener("click", () => {
    if (modalCard) modalCard.classList.remove("is-expanded");
    if (stepForm) stepForm.style.display = "block";
    if (stepGraph) stepGraph.style.display = "none";
  });

  // Filter Pills (All / Thermostats / Sensors)
  filterPills?.querySelectorAll(".filter-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      filterPills.querySelectorAll(".filter-pill").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      const filter = pill.dataset.filter;
      let visibleCount = 0;
      graphsContainer?.querySelectorAll(".modal-chart-box").forEach((box) => {
        const match = filter === "all" || box.dataset.kind === filter;
        box.style.display = match ? "" : "none";
        if (match) visibleCount++;
      });
      if (countBadge) {
        countBadge.textContent = `${visibleCount} Geräte`;
      }
    });
  });

  applyBtn?.addEventListener("click", async () => {
    const startVal = startInput ? datetimeLocalToIso(startInput.value) : null;
    const endVal = endInput ? datetimeLocalToIso(endInput.value) : null;

    setCustomRange({ start: startVal, end: endVal });
    await load(false);

    if (modalCard) modalCard.classList.add("is-expanded");
    if (stepForm) stepForm.style.display = "none";
    if (stepGraph) stepGraph.style.display = "flex";

    const selectedSlots = Array.from(
      checkboxesContainer?.querySelectorAll("input[type=checkbox]:checked") || []
    ).map((cb) => cb.value);

    const allDevs = state && state.devices ? state.devices : [];
    const activeDevices = allDevs.filter((d) => selectedSlots.includes(String(d.slot)));

    if (rangeBadge) {
      const sStr = state.start_timestamp ? new Date(state.start_timestamp).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "";
      const eStr = state.end_timestamp ? new Date(state.end_timestamp).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "";
      rangeBadge.textContent = sStr && eStr ? `${sStr} – ${eStr}` : "Benutzerdefinierter Zeitraum";
    }

    if (countBadge) {
      countBadge.textContent = `${activeDevices.length} von ${allDevs.length} Geräten`;
    }

    // Reset filter pill to 'all'
    filterPills?.querySelectorAll(".filter-pill").forEach((p) => {
      p.classList.toggle("active", p.dataset.filter === "all");
    });

    if (graphsContainer) {
      graphsContainer.innerHTML = activeDevices
        .map((d) => {
          const isSensor = d.kind === "sensor";
          const off = thermostatIsOff(d);
          const mInfo = modeInfo(d);
          const color = tempColor(d.temperature);

          const temps = (d.history || []).map((h) => h.temperature).filter((t) => t != null);
          const minT = temps.length ? Math.min(...temps) : null;
          const maxT = temps.length ? Math.max(...temps) : null;
          const avgT = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
          const curT = temps.length ? temps[temps.length - 1] : null;

          const hums = isSensor
            ? (d.history || []).map((h) => h.humidity).filter((h) => h != null)
            : [];
          const minH = hums.length ? Math.min(...hums) : null;
          const maxH = hums.length ? Math.max(...hums) : null;
          const curH = hums.length ? hums[hums.length - 1] : null;

          const batStr = d.battery != null ? `${fmt(d.battery, 0)}%` : "–";
          const rssiStr = d.rssi != null ? `${d.rssi} dBm` : "–";

          const metricItems = [
            `
              <div class="modal-device-m">
                <span class="m-label">Ist-Temperatur</span>
                <span class="m-val" style="color:${color}">${fmt(curT)}°C</span>
                <span class="m-sub">Min ${fmt(minT)}° · Max ${fmt(maxT)}° · Ø ${fmt(avgT)}°</span>
              </div>
            `,
            !isSensor
              ? `
                <div class="modal-device-m">
                  <span class="m-label">Zieltemperatur</span>
                  <span class="m-val">${off ? "0°C (Aus)" : `${fmt(d.target_temperature)}°C`}</span>
                  <span class="m-sub">${mInfo.label}</span>
                </div>
              `
              : `
                <div class="modal-device-m">
                  <span class="m-label">Luftfeuchtigkeit</span>
                  <span class="m-val" style="color:var(--good)">${fmt(curH, 0)}% rF</span>
                  <span class="m-sub">Min ${fmt(minH, 0)}% · Max ${fmt(maxH, 0)}%</span>
                </div>
              `,
            `
              <div class="modal-device-m">
                <span class="m-label">Batterie</span>
                <span class="m-val">${batStr}</span>
                <span class="m-sub">${d.battery != null && d.battery < 40 ? "Niedrig" : "OK"}</span>
              </div>
            `,
            `
              <div class="modal-device-m">
                <span class="m-label">Funk-Signal</span>
                <span class="m-val">${rssiStr}</span>
                <span class="m-sub">Telemetrie</span>
              </div>
            `,
          ].join("");

          const tempGraphHtml = `
            <div class="modal-subgraph-label">
              <span>Temperaturverlauf (°C)</span>
            </div>
            ${largeSparkline(d.history, "temperature", !isSensor ? "target_temperature" : null)}
          `;

          const humGraphHtml = isSensor && hums.length
            ? `
              <div class="modal-subgraph-label" style="margin-top:14px;">
                <span>Luftfeuchteverlauf (% rF)</span>
                <span style="font-weight:400;color:var(--muted);font-size:0.72rem;">Aktuell ${fmt(curH, 0)}%</span>
              </div>
              ${largeSparkline(d.history, "humidity", null)}
            `
            : "";

          return `
            <div class="chart-box modal-chart-box" data-kind="${d.kind}">
              <div class="modal-chart-header">
                <span class="modal-chart-title">
                  ${deviceIconSvg(isSensor, 18)}
                  <span><strong>${d.slot}:</strong> ${d.room} — ${d.location || (isSensor ? "Klima-Sensor" : "Radiator-Thermostat")}</span>
                </span>
                <span class="state-pill ${mInfo.cls}">${mInfo.short}</span>
              </div>
              <div class="modal-device-metrics-bar">
                ${metricItems}
              </div>
              ${tempGraphHtml}
              ${humGraphHtml}
            </div>
          `;
        })
        .join("");

      attachSparklineInteractions(graphsContainer);
    }
  });
}
