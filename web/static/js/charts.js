import { fmt, escapeAttr, chartTimeLabel, el } from "./helpers.js";

export function getTargetAt(history, targetKey, idx) {
  if (!targetKey) return null;
  if (history[idx] && history[idx][targetKey] != null) {
    const p = history[idx];
    if (p.on === false || p.mode === "off") return 0;
    return history[idx][targetKey];
  }
  for (let j = idx; j >= 0; j--) {
    if (history[j] && history[j][targetKey] != null) {
      const p = history[j];
      if (p.on === false || p.mode === "off") return 0;
      return history[j][targetKey];
    }
  }
  for (let j = idx; j < history.length; j++) {
    if (history[j] && history[j][targetKey] != null) {
      const p = history[j];
      if (p.on === false || p.mode === "off") return 0;
      return history[j][targetKey];
    }
  }
  return null;
}

export function sparkline(history, key, targetKey, activeStepIdx = null) {
  const w = 360;
  const h = 112;
  const pad = { top: 16, right: 14, bottom: 18, left: 34 };
  const values = (history || []).map((h) => h[key]).filter((v) => v != null);
  if (!values.length) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`;

  const targetPoints = targetKey
    ? (history || []).map((p) => {
        if (p.on === false || p.mode === "off") return 0;
        return p[targetKey];
      }).filter((v) => v != null)
    : [];

  const activeTargets = targetPoints.filter((t) => t > 0);
  let min = Math.min(...values, ...(activeTargets.length ? activeTargets : []));
  let max = Math.max(...values, ...(activeTargets.length ? activeTargets : []));
  if (key === "temperature") {
    min -= 2.5;
    max += 2.5;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min || 1;
  const n = Math.max(history.length - 1, 1);
  const x = (i) => pad.left + (i / n) * (w - pad.left - pad.right);
  const y = (v) => {
    if (v <= 0) return h - pad.bottom;
    const clampedV = Math.max(min, Math.min(max, v));
    return pad.top + (1 - (clampedV - min) / span) * (h - pad.top - pad.bottom);
  };

  const ptsArray = history
    .map((point, i) => {
      if (!point || point[key] == null) return null;
      let targetVal = null;
      if (targetKey) {
        if (point.on === false || point.mode === "off") {
          targetVal = 0;
        } else if (point[targetKey] != null) {
          targetVal = point[targetKey];
        } else {
          targetVal = getTargetAt(history, targetKey, i);
        }
      }
      return {
        i,
        x: Number(x(i).toFixed(1)),
        y: Number(y(point[key]).toFixed(1)),
        val: point[key],
        target: targetVal,
        label: chartTimeLabel(point.collected_at) || `#${i + 1}`,
      };
    })
    .filter(Boolean);

  const pts = ptsArray.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `${ptsArray[0].x},${h - pad.bottom} ${pts} ${ptsArray[ptsArray.length - 1].x},${h - pad.bottom}`;
  const unit = key === "humidity" ? "%" : "°";
  const strokeColor = key === "humidity" ? "#0d9488" : "#0284c7";
  const fillColor = key === "humidity" ? "rgba(13, 148, 136, 0.13)" : "rgba(2, 132, 199, 0.13)";
  const midVal = (min + max) / 2;
  const seriesData = escapeAttr(JSON.stringify(ptsArray.map(({ x, y, val, target, label }) => ({ x, y, val, target, label }))));

  const targetPtsArray = targetKey
    ? history
        .map((point, i) => {
          if (!point) return null;
          let val = null;
          if (point.on === false || point.mode === "off") {
            val = 0;
          } else if (point[targetKey] != null) {
            val = point[targetKey];
          } else {
            val = getTargetAt(history, targetKey, i);
          }
          if (val == null) return null;
          return {
            i,
            x: Number(x(i).toFixed(1)),
            y: Number(y(val).toFixed(1)),
            val,
          };
        })
        .filter(Boolean)
    : [];

  const targetPts = targetPtsArray.map((p) => `${p.x},${p.y}`).join(" ");
  const targetPolyline = targetPtsArray.length
    ? `<polyline points="${targetPts}" fill="none" stroke="#f97316" stroke-width="1.5"
               stroke-dasharray="4 3" stroke-linejoin="round" stroke-linecap="round" />`
    : "";

  const latestTarget = targetPtsArray.length ? targetPtsArray[targetPtsArray.length - 1].val : null;
  const lastTargetPt = targetPtsArray.length ? targetPtsArray[targetPtsArray.length - 1] : null;
  const targetLabelText = latestTarget != null ? (latestTarget <= 0 ? `Ziel 0${unit} (Aus)` : `Ziel ${fmt(latestTarget)}${unit}`) : "";
  const targetLabel = latestTarget != null && lastTargetPt
    ? `<text x="${w - pad.right}" y="${Math.max(pad.top + 8, Math.min(h - pad.bottom - 4, lastTargetPt.y - 4)).toFixed(1)}" fill="#f97316" font-family="JetBrains Mono, monospace" font-size="9.5" text-anchor="end">
         ${targetLabelText}</text>`
    : "";

  return `
    <svg class="spark" viewBox="0 0 ${w} ${h}"
         data-unit="${unit}" data-top="${pad.top}" data-bottom="${h - pad.bottom}"
         data-right="${w - pad.right}" data-points="${seriesData}">
      <line x1="${pad.left}" y1="${pad.top}" x2="${w - pad.right}" y2="${pad.top}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3" />
      <line x1="${pad.left}" y1="${y(midVal).toFixed(1)}" x2="${w - pad.right}" y2="${y(midVal).toFixed(1)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3" />
      <line x1="${pad.left}" y1="${h - pad.bottom}" x2="${w - pad.right}" y2="${h - pad.bottom}" stroke="var(--line)" stroke-width="1" />

      <polygon points="${area}" fill="${fillColor}" />
      <polyline points="${pts}" fill="none" stroke="${strokeColor}" stroke-width="2.2"
                stroke-linejoin="round" stroke-linecap="round" />
      ${targetPolyline}
      ${targetLabel}

      <text x="${pad.left - 5}" y="${pad.top + 3}" fill="var(--muted)" font-family="JetBrains Mono, monospace" font-size="9.5" text-anchor="end">${fmt(max, key === "humidity" ? 0 : 1)}${unit}</text>
      <text x="${pad.left - 5}" y="${y(midVal) + 3}" fill="var(--muted)" font-family="JetBrains Mono, monospace" font-size="9.5" text-anchor="end">${fmt(midVal, key === "humidity" ? 0 : 1)}${unit}</text>
      <text x="${pad.left - 5}" y="${h - pad.bottom + 3}" fill="var(--muted)" font-family="JetBrains Mono, monospace" font-size="9.5" text-anchor="end">${fmt(min, key === "humidity" ? 0 : 1)}${unit}</text>

      <rect class="spark-hit" x="${pad.left}" y="${pad.top}"
            width="${w - pad.left - pad.right}" height="${h - pad.top - pad.bottom}" />
    </svg>
  `;
}

export function largeSparkline(history, key, targetKey) {
  const w = 780;
  const h = 160;
  const pad = { top: 20, right: 20, bottom: 24, left: 44 };
  const values = (history || []).map((h) => h[key]).filter((v) => v != null);
  if (!values.length) return `<svg class="spark large-spark" viewBox="0 0 ${w} ${h}"></svg>`;

  const targetPoints = targetKey
    ? (history || []).map((p) => {
        if (p.on === false || p.mode === "off") return 0;
        return p[targetKey];
      }).filter((v) => v != null)
    : [];

  const activeTargets = targetPoints.filter((t) => t > 0);
  let min = Math.min(...values, ...(activeTargets.length ? activeTargets : []));
  let max = Math.max(...values, ...(activeTargets.length ? activeTargets : []));
  if (key === "temperature") {
    min -= 2.5;
    max += 2.5;
  }
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min || 1;
  const n = Math.max(history.length - 1, 1);
  const x = (i) => pad.left + (i / n) * (w - pad.left - pad.right);
  const y = (v) => {
    if (v <= 0) return h - pad.bottom;
    const clampedV = Math.max(min, Math.min(max, v));
    return pad.top + (1 - (clampedV - min) / span) * (h - pad.top - pad.bottom);
  };

  const ptsArray = history
    .map((point, i) => {
      if (!point || point[key] == null) return null;
      let targetVal = null;
      if (targetKey) {
        if (point.on === false || point.mode === "off") {
          targetVal = 0;
        } else if (point[targetKey] != null) {
          targetVal = point[targetKey];
        } else {
          targetVal = getTargetAt(history, targetKey, i);
        }
      }
      return {
        i,
        x: Number(x(i).toFixed(1)),
        y: Number(y(point[key]).toFixed(1)),
        val: point[key],
        target: targetVal,
        label: chartTimeLabel(point.collected_at) || `#${i + 1}`,
      };
    })
    .filter(Boolean);

  const pts = ptsArray.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `${ptsArray[0].x},${h - pad.bottom} ${pts} ${ptsArray[ptsArray.length - 1].x},${h - pad.bottom}`;
  const unit = key === "humidity" ? "%" : "°";
  const strokeColor = key === "humidity" ? "#0d9488" : "#0284c7";
  const fillColor = key === "humidity" ? "rgba(13, 148, 136, 0.13)" : "rgba(2, 132, 199, 0.13)";
  const midVal = (min + max) / 2;
  const seriesData = escapeAttr(JSON.stringify(ptsArray.map(({ x, y, val, target, label }) => ({ x, y, val, target, label }))));

  const targetPtsArray = targetKey
    ? history
        .map((point, i) => {
          if (!point) return null;
          let val = null;
          if (point.on === false || point.mode === "off") {
            val = 0;
          } else if (point[targetKey] != null) {
            val = point[targetKey];
          } else {
            val = getTargetAt(history, targetKey, i);
          }
          if (val == null) return null;
          return {
            i,
            x: Number(x(i).toFixed(1)),
            y: Number(y(val).toFixed(1)),
            val,
          };
        })
        .filter(Boolean)
    : [];

  const targetPts = targetPtsArray.map((p) => `${p.x},${p.y}`).join(" ");
  const targetPolyline = targetPtsArray.length
    ? `<polyline points="${targetPts}" fill="none" stroke="#f97316" stroke-width="2"
               stroke-dasharray="6 4" stroke-linejoin="round" stroke-linecap="round" />`
    : "";

  const latestTarget = targetPtsArray.length ? targetPtsArray[targetPtsArray.length - 1].val : null;
  const lastTargetPt = targetPtsArray.length ? targetPtsArray[targetPtsArray.length - 1] : null;
  const targetLabelText = latestTarget != null ? (latestTarget <= 0 ? `Ziel 0${unit} (Aus)` : `Ziel ${fmt(latestTarget)}${unit}`) : "";
  const targetLabel = latestTarget != null && lastTargetPt
    ? `<text x="${w - pad.right}" y="${Math.max(pad.top + 10, Math.min(h - pad.bottom - 6, lastTargetPt.y - 6)).toFixed(1)}" fill="#f97316" font-family="JetBrains Mono, monospace" font-size="11" font-weight="600" text-anchor="end">
         ${targetLabelText}</text>`
    : "";

  return `
    <svg class="spark large-spark" viewBox="0 0 ${w} ${h}"
         data-unit="${unit}" data-top="${pad.top}" data-bottom="${h - pad.bottom}"
         data-right="${w - pad.right}" data-points="${seriesData}">
      <line x1="${pad.left}" y1="${pad.top}" x2="${w - pad.right}" y2="${pad.top}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 3" />
      <line x1="${pad.left}" y1="${y(midVal).toFixed(1)}" x2="${w - pad.right}" y2="${y(midVal).toFixed(1)}" stroke="var(--line)" stroke-width="1" stroke-dasharray="3 3" />
      <line x1="${pad.left}" y1="${h - pad.bottom}" x2="${w - pad.right}" y2="${h - pad.bottom}" stroke="var(--line)" stroke-width="1.2" />

      <polygon points="${area}" fill="${fillColor}" />
      <polyline points="${pts}" fill="none" stroke="${strokeColor}" stroke-width="2.5"
                stroke-linejoin="round" stroke-linecap="round" />
      ${targetPolyline}
      ${targetLabel}

      <text x="${pad.left - 8}" y="${pad.top + 4}" fill="var(--muted)" font-family="JetBrains Mono, monospace" font-size="10" text-anchor="end">${fmt(max, key === "humidity" ? 0 : 1)}${unit}</text>
      <text x="${pad.left - 8}" y="${y(midVal) + 4}" fill="var(--muted)" font-family="JetBrains Mono, monospace" font-size="10" text-anchor="end">${fmt(midVal, key === "humidity" ? 0 : 1)}${unit}</text>
      <text x="${pad.left - 8}" y="${h - pad.bottom + 4}" fill="var(--muted)" font-family="JetBrains Mono, monospace" font-size="10" text-anchor="end">${fmt(min, key === "humidity" ? 0 : 1)}${unit}</text>

      <rect class="spark-hit" x="${pad.left}" y="${pad.top}"
            width="${w - pad.left - pad.right}" height="${h - pad.top - pad.bottom}" />
    </svg>
  `;
}

export function attachSparklineInteractions(root = document) {
  root.querySelectorAll(".spark").forEach((svg) => {
    if (svg.dataset.sparkReady === "1") return;
    const hit = svg.querySelector(".spark-hit");
    if (!hit) return;

    let points = [];
    try {
      points = JSON.parse(svg.getAttribute("data-points") || "[]");
    } catch {
      return;
    }
    if (!points.length) return;
    svg.dataset.sparkReady = "1";

    const unit = svg.getAttribute("data-unit") || "";
    const top = Number(svg.getAttribute("data-top")) || 16;
    const bottom = Number(svg.getAttribute("data-bottom")) || 94;
    const right = Number(svg.getAttribute("data-right")) || 346;
    const viewBox = (svg.getAttribute("viewBox") || "0 0 360 112").split(/\s+/).map(Number);
    const width = viewBox[2] || 360;

    const hasTarget = points.some((p) => p.target != null);
    const tipH = hasTarget ? 42 : 28;

    const cursor = el("g", { class: "spark-cursor" });
    cursor.style.display = "none";
    const vline = el("line", { class: "spark-cursor-line", y1: top, y2: bottom });
    const dot = el("circle", { class: "spark-cursor-dot", r: 3.4 });
    const tipBg = el("rect", { class: "spark-cursor-bg", rx: 4, height: tipH });
    const tipValue = el("text", { class: "spark-cursor-value" });
    const tipTarget = hasTarget ? el("text", { class: "spark-cursor-target" }) : null;
    const tipTime = el("text", { class: "spark-cursor-time" });
    if (tipTarget) {
      cursor.append(vline, dot, tipBg, tipValue, tipTarget, tipTime);
    } else {
      cursor.append(vline, dot, tipBg, tipValue, tipTime);
    }
    svg.appendChild(cursor);

    const nearestPoint = (pointerX) => {
      let lo = 0;
      let hi = points.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (points[mid].x < pointerX) lo = mid + 1;
        else hi = mid;
      }
      const after = points[lo];
      const before = points[Math.max(0, lo - 1)];
      return Math.abs(before.x - pointerX) <= Math.abs(after.x - pointerX) ? before : after;
    };

    const move = (event) => {
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const svgPoint = svg.createSVGPoint();
      svgPoint.x = event.clientX;
      svgPoint.y = event.clientY;
      const pointerX = svgPoint.matrixTransform(ctm.inverse()).x;

      if (pointerX < points[0].x - 8 || pointerX > points[points.length - 1].x + 8) {
        cursor.style.display = "none";
        return;
      }

      const p = nearestPoint(pointerX);
      const valueText = `${fmt(p.val)}${unit}`;
      tipValue.textContent = valueText;
      tipTime.textContent = p.label;
      const targetStr = tipTarget && p.target != null
        ? (p.target <= 0 ? `Ziel: 0${unit} (Aus)` : `Ziel: ${fmt(p.target)}${unit}`)
        : "";
      if (tipTarget) {
        tipTarget.textContent = targetStr;
      }
      const longestText = Math.max(valueText.length, p.label.length, targetStr.length);
      const tipW = Math.max(56, longestText * 5.8 + 12);
      let tipX = p.x + 8;
      if (tipX + tipW > right + 8) tipX = p.x - 8 - tipW;
      tipX = Math.max(2, Math.min(width - tipW - 2, tipX));
      const tipY = Math.max(top, Math.min(bottom - tipH, p.y - tipH / 2));

      vline.setAttribute("x1", p.x);
      vline.setAttribute("x2", p.x);
      dot.setAttribute("cx", p.x);
      dot.setAttribute("cy", p.y);
      tipBg.setAttribute("x", tipX.toFixed(1));
      tipBg.setAttribute("y", tipY.toFixed(1));
      tipBg.setAttribute("width", tipW.toFixed(1));
      tipValue.setAttribute("x", (tipX + 6).toFixed(1));
      tipValue.setAttribute("y", (tipY + 11).toFixed(1));
      if (tipTarget) {
        tipTarget.setAttribute("x", (tipX + 6).toFixed(1));
        tipTarget.setAttribute("y", (tipY + 25).toFixed(1));
        tipTime.setAttribute("x", (tipX + 6).toFixed(1));
        tipTime.setAttribute("y", (tipY + 37).toFixed(1));
      } else {
        tipTime.setAttribute("x", (tipX + 6).toFixed(1));
        tipTime.setAttribute("y", (tipY + 22).toFixed(1));
      }
      cursor.style.display = "";
    };

    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => {
      cursor.style.display = "none";
    });
  });
}
