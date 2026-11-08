import { ROOMS, APARTMENT_OUTLINE, SLOT_POS, VIEW_W, VIEW_H } from "./constants.js";
import { px, py, el, fmt, tempColor, roomThermalFill, thermostatIsOff } from "./helpers.js";
import { activeSlot, showHeatmap, showPlanDetails } from "./state.js";
import { selectSlot } from "./inspector.js";

export function renderPlan(devices, roomStats) {
  const svg = document.getElementById("plan");
  if (!svg) return;
  svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.replaceChildren();

  const gridGroup = el("g", { class: "blueprint-layer" });
  for (let gx = 0; gx <= 53; gx += 5) {
    gridGroup.appendChild(
      el("line", {
        x1: px(gx),
        y1: py(0) - 8,
        x2: px(gx),
        y2: py(28) + 8,
        class: "blueprint-grid",
      })
    );
  }
  for (let gy = 0; gy <= 28; gy += 4) {
    gridGroup.appendChild(
      el("line", {
        x1: px(0) - 8,
        y1: py(gy),
        x2: px(53) + 8,
        y2: py(gy),
        class: "blueprint-grid",
      })
    );
  }
  svg.appendChild(gridGroup);

  const activeDevice = devices.find((d) => d.slot === activeSlot);
  const activeRoomName = activeDevice ? activeDevice.room : null;

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

    const lx = px(room.label[0]);
    const ly = py(room.label[1]);
    const labelEl = el("text", { x: lx, y: ly, class: "room-label" });
    labelEl.textContent = room.name;
    rGroup.appendChild(labelEl);

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
        const preferred =
          rStat.devices.find((d) => d.kind === "sensor") || rStat.devices[0];
        selectSlot(preferred.slot);
      }
    });

    svg.appendChild(rGroup);
  }

  const outlinePts = APARTMENT_OUTLINE.map(([x, y]) => `${px(x)},${py(y)}`).join(" ");
  svg.appendChild(el("polygon", { points: outlinePts, class: "apartment-outline" }));

  for (const device of devices) {
    svg.appendChild(renderDevice(device));
  }
}

export function deviceIcon(isSensor, cx, cy) {
  const g = el("g", { class: "device-icon", transform: `translate(${cx},${cy})` });
  if (isSensor) {
    g.appendChild(
      el("path", {
        transform: "scale(0.78) translate(-12,-12)",
        d: "M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4z",
      })
    );
  } else {
    g.appendChild(el("rect", { x: -9, y: -7.5, width: 18, height: 12, rx: 2.5 }));
    for (const x of [-4.5, 0, 4.5]) {
      g.appendChild(el("line", { x1: x, y1: -7.5, x2: x, y2: 4.5 }));
    }
    g.appendChild(el("line", { x1: -6.5, y1: 4.5, x2: -6.5, y2: 7.5 }));
    g.appendChild(el("line", { x1: 6.5, y1: 4.5, x2: 6.5, y2: 7.5 }));
  }
  return g;
}

export function deviceIconSvg(isSensor, size = 24) {
  if (isSensor) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7.5 6v12M12 6v12M16.5 6v12M7 18v3M17 18v3"/></svg>`;
}

export function renderDevice(device) {
  const [gx, gy] = SLOT_POS[device.slot] || [26, 14];
  const cx = px(gx);
  const cy = py(gy);
  const color = tempColor(device.temperature);
  const heating = device.heating;
  const off = thermostatIsOff(device);
  const isSensor = device.kind === "sensor";
  const isActive = device.slot === activeSlot;

  const group = el("g", {
    class: `device ${device.kind}${heating ? " heating" : ""}${off ? " off" : ""}${isActive ? " active" : ""}`,
    "data-slot": device.slot,
  });

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

  group.appendChild(el("circle", { cx, cy, r: 24, class: "halo" }));

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

  group.appendChild(deviceIcon(isSensor, cx, cy));

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

  const pillW = Math.max(46, pillLabel.length * 6.6 + 12);
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

export function updateActiveHighlight() {
  document.querySelectorAll(".device").forEach((node) => {
    node.classList.toggle("active", node.dataset.slot === activeSlot);
  });
}
