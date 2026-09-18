/**
 * SVG chart primitives.
 *
 * Every chart: hairline grid, thin marks, a hover layer that also answers to the
 * keyboard, and colours read from CSS custom properties so a theme switch is a
 * re-render rather than a second palette.
 */
(function (global) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var Fmt = global.Fmt;

  function el(tag, attrs, parent) {
    var node = document.createElementNS(NS, tag);
    for (var key in attrs) {
      if (attrs[key] != null) node.setAttribute(key, attrs[key]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function cssVar(node, name) {
    return getComputedStyle(node).getPropertyValue(name).trim();
  }

  /** Rough text width — enough to decide whether a label fits inside a mark. */
  function textWidth(text, size) {
    return String(text).length * size * 0.56;
  }

  /** Shortens a label to fit `maxWidth`, keeping the full text for the tooltip. */
  function truncate(text, maxWidth, size) {
    text = String(text);
    if (textWidth(text, size) <= maxWidth) return text;
    var chars = Math.max(3, Math.floor(maxWidth / (size * 0.56)) - 1);
    return text.slice(0, chars).replace(/[\s,–-]+$/, "") + "…";
  }

  function niceTicks(max, count) {
    if (!max) return [0];
    var raw = max / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    var ticks = [];
    for (var v = 0; v <= max + step * 0.0001; v += step) ticks.push(v);
    return ticks;
  }

  /** Rectangle with rounded corners on the data end only. */
  function barPath(x, y, w, h, r, horizontal) {
    r = Math.max(0, Math.min(r, horizontal ? Math.min(w, h / 2) : Math.min(h, w / 2)));
    if (horizontal) {
      return "M" + x + "," + y +
        "H" + (x + w - r) + "A" + r + "," + r + " 0 0 1 " + (x + w) + "," + (y + r) +
        "V" + (y + h - r) + "A" + r + "," + r + " 0 0 1 " + (x + w - r) + "," + (y + h) +
        "H" + x + "Z";
    }
    return "M" + x + "," + (y + h) +
      "V" + (y + r) + "A" + r + "," + r + " 0 0 1 " + (x + r) + "," + y +
      "H" + (x + w - r) + "A" + r + "," + r + " 0 0 1 " + (x + w) + "," + (y + r) +
      "V" + (y + h) + "Z";
  }

  /* --------------------------------------------------------------- tooltip */

  var tip = {
    node: null,
    show: function (html, x, y) {
      if (!this.node) this.node = document.getElementById("tooltip");
      var node = this.node;
      node.innerHTML = "";
      html.forEach(function (row) {
        var line = document.createElement("div");
        line.className = "tip-row" + (row.strong ? " tip-strong" : "") + (row.head ? " tip-head" : "");
        if (row.color) {
          var key = document.createElement("span");
          key.className = "tip-key";
          key.style.background = row.color;
          line.appendChild(key);
        }
        if (row.value != null) {
          var value = document.createElement("span");
          value.className = "tip-value";
          value.textContent = row.value;           // labels are untrusted data
          line.appendChild(value);
        }
        var label = document.createElement("span");
        label.className = "tip-label";
        label.textContent = row.label;
        line.appendChild(label);
        node.appendChild(line);
      });
      node.hidden = false;

      var box = node.getBoundingClientRect();
      var left = Math.min(x + 14, window.innerWidth - box.width - 8);
      var top = y - box.height - 14;
      if (top < 8) top = y + 18;
      node.style.left = Math.max(8, left) + "px";
      node.style.top = top + "px";
    },
    hide: function () {
      if (!this.node) this.node = document.getElementById("tooltip");
      this.node.hidden = true;
    }
  };

  /* ------------------------------------------------------------ line chart */

  /**
   * Trend over time. The current period is the subject; the comparison period is
   * context, so it is drawn in the de-emphasis grey rather than a second hue.
   */
  function line(container, opts) {
    container.innerHTML = "";
    var width = container.clientWidth || 640;
    var height = opts.height || 260;
    var pad = { top: 18, right: 64, bottom: 30, left: 62 };

    var svg = el("svg", {
      class: "chart", viewBox: "0 0 " + width + " " + height,
      width: width, height: height, tabindex: "0",
      role: "img", "aria-label": opts.ariaLabel || "Revenue trend"
    }, container);

    var accent = cssVar(container, "--series-1");
    var muted = cssVar(container, "--deemphasis");
    var grid = cssVar(container, "--grid");
    var ink = cssVar(container, "--text-muted");
    var surface = cssVar(container, "--surface");

    var points = opts.current;
    var compare = opts.compare || [];
    var maxValue = Math.max.apply(null, points.map(function (p) { return p.value; })
      .concat(compare.map(function (p) { return p.value; })).concat([1]));

    var ticks = niceTicks(maxValue * 1.08, 4);
    var top = ticks[ticks.length - 1];
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;

    var xAt = function (i) {
      return pad.left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    };
    var yAt = function (v) { return pad.top + plotH - (v / top) * plotH; };

    ticks.forEach(function (t) {
      el("line", {
        x1: pad.left, x2: width - pad.right, y1: yAt(t), y2: yAt(t),
        stroke: grid, "stroke-width": 1
      }, svg);
      el("text", {
        x: pad.left - 10, y: yAt(t) + 4, "text-anchor": "end",
        class: "axis-text", fill: ink
      }, svg).textContent = Fmt.moneyShort(t);
    });

    // x labels — thin them out until they stop colliding
    var every = Math.ceil((points.length * 34) / Math.max(plotW, 1));
    points.forEach(function (p, i) {
      if (i % every !== 0 && i !== points.length - 1) return;
      el("text", {
        x: xAt(i), y: height - 10, "text-anchor": "middle", class: "axis-text", fill: ink
      }, svg).textContent = p.label;
    });

    function path(data) {
      return data.map(function (p, i) {
        return (i ? "L" : "M") + xAt(i) + "," + yAt(p.value);
      }).join(" ");
    }

    if (compare.length) {
      el("path", {
        d: path(compare), fill: "none", stroke: muted, "stroke-width": 2,
        "stroke-linejoin": "round", "stroke-linecap": "round"
      }, svg);
    }

    el("path", {
      d: path(points) + " L" + xAt(points.length - 1) + "," + yAt(0) + " L" + xAt(0) + "," + yAt(0) + " Z",
      fill: accent, opacity: 0.1
    }, svg);

    el("path", {
      d: path(points), fill: "none", stroke: accent, "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round"
    }, svg);

    // end marker + direct label, the only labelled point on the line
    var last = points.length - 1;
    el("circle", {
      cx: xAt(last), cy: yAt(points[last].value), r: 4.5,
      fill: accent, stroke: surface, "stroke-width": 2
    }, svg);
    el("text", {
      x: xAt(last) + 10, y: yAt(points[last].value) + 4,
      class: "chart-label", fill: cssVar(container, "--text-primary")
    }, svg).textContent = Fmt.moneyShort(points[last].value);

    /* hover + keyboard layer */
    var crosshair = el("line", {
      y1: pad.top, y2: pad.top + plotH, stroke: cssVar(container, "--axis"),
      "stroke-width": 1, opacity: 0
    }, svg);
    var hoverDot = el("circle", { r: 4.5, fill: accent, stroke: surface, "stroke-width": 2, opacity: 0 }, svg);
    var hoverDot2 = el("circle", { r: 4, fill: muted, stroke: surface, "stroke-width": 2, opacity: 0 }, svg);

    var active = -1;

    function focusIndex(i, clientX, clientY) {
      if (i < 0 || i >= points.length) return;
      active = i;
      var x = xAt(i);
      crosshair.setAttribute("x1", x);
      crosshair.setAttribute("x2", x);
      crosshair.setAttribute("opacity", 1);
      hoverDot.setAttribute("cx", x);
      hoverDot.setAttribute("cy", yAt(points[i].value));
      hoverDot.setAttribute("opacity", 1);

      var rows = [{ label: points[i].fullLabel || points[i].label, head: true }];
      rows.push({ label: opts.currentName, value: Fmt.money(points[i].value), color: accent, strong: true });

      if (compare[i]) {
        hoverDot2.setAttribute("cx", x);
        hoverDot2.setAttribute("cy", yAt(compare[i].value));
        hoverDot2.setAttribute("opacity", 1);
        rows.push({ label: opts.compareName, value: Fmt.money(compare[i].value), color: muted });
        var diff = global.Analytics.change(points[i].value, compare[i].value);
        if (diff != null) rows.push({ label: "vs " + opts.compareName, value: Fmt.signedPct(diff) });
      }

      var box = svg.getBoundingClientRect();
      tip.show(rows,
        clientX == null ? box.left + x : clientX,
        clientY == null ? box.top + yAt(points[i].value) : clientY);
    }

    function clear() {
      active = -1;
      crosshair.setAttribute("opacity", 0);
      hoverDot.setAttribute("opacity", 0);
      hoverDot2.setAttribute("opacity", 0);
      tip.hide();
    }

    svg.addEventListener("pointermove", function (event) {
      var box = svg.getBoundingClientRect();
      var ratio = (event.clientX - box.left - pad.left) / plotW;
      focusIndex(Math.round(ratio * (points.length - 1)), event.clientX, event.clientY);
    });
    svg.addEventListener("pointerleave", clear);
    svg.addEventListener("blur", clear);
    svg.addEventListener("focus", function () { focusIndex(points.length - 1); });
    svg.addEventListener("keydown", function (event) {
      if (event.key === "ArrowRight") { focusIndex(Math.min(active + 1, points.length - 1)); event.preventDefault(); }
      if (event.key === "ArrowLeft") { focusIndex(Math.max(active - 1, 0)); event.preventDefault(); }
      if (event.key === "Escape") clear();
    });
  }

  /* ------------------------------------------------------- horizontal bars */

  /** Magnitude by category: one hue for every bar, value at the tip. */
  function barsH(container, opts) {
    container.innerHTML = "";
    var width = container.clientWidth || 480;
    var rowH = 34;
    var barH = Math.min(24, rowH - 14);
    var labelW = Math.min(150, Math.max(92, width * (width < 460 ? 0.38 : 0.3)));
    var valueW = 74;
    var height = opts.items.length * rowH + 8;

    var svg = el("svg", {
      class: "chart", viewBox: "0 0 " + width + " " + height, width: width, height: height,
      role: "img", "aria-label": opts.ariaLabel || "Revenue by category"
    }, container);

    var accent = cssVar(container, "--series-1");
    var ink = cssVar(container, "--text-secondary");
    var primary = cssVar(container, "--text-primary");
    var plotW = Math.max(40, width - labelW - valueW);
    var max = Math.max.apply(null, opts.items.map(function (d) { return d.value; }).concat([1]));

    opts.items.forEach(function (item, i) {
      var y = i * rowH + 4;
      var w = Math.max(2, (item.value / max) * plotW);

      var row = el("g", { tabindex: "0", role: "listitem", class: "bar-row" }, svg);

      var labelText = el("text", {
        x: 0, y: y + barH / 2 + 4, class: "chart-label", fill: ink
      }, row);
      labelText.textContent = truncate(item.label, labelW - 10, 12);

      el("path", {
        d: barPath(labelW, y, w, barH, 4, true), fill: accent
      }, row);

      el("text", {
        x: labelW + w + 8, y: y + barH / 2 + 4, class: "chart-value", fill: primary
      }, row).textContent = Fmt.moneyShort(item.value);

      // hit target spans the whole row, not just the painted bar
      var hit = el("rect", {
        x: 0, y: y - 5, width: width, height: rowH, fill: "transparent"
      }, row);

      function show(event) {
        var box = hit.getBoundingClientRect();
        tip.show([
          { label: item.label, head: true },
          { label: "Net revenue", value: Fmt.money(item.value), color: accent, strong: true },
          { label: "Share of selection", value: Fmt.pct(item.share) },
          { label: "Gross margin", value: Fmt.pct(item.marginPct) },
          { label: "vs " + opts.compareName, value: item.changePct == null ? "—" : Fmt.signedPct(item.changePct) }
        ], event && event.clientX != null ? event.clientX : box.right - 40,
           event && event.clientY != null ? event.clientY : box.top + rowH / 2);
      }

      row.addEventListener("pointermove", show);
      row.addEventListener("pointerleave", function () { tip.hide(); });
      row.addEventListener("focus", show);
      row.addEventListener("blur", function () { tip.hide(); });
    });
  }

  /* ------------------------------------------------------- 100% stacked bar */

  /** Part-to-whole across a handful of classes, with a 2px surface gap between. */
  function stacked(container, opts) {
    container.innerHTML = "";
    var width = container.clientWidth || 480;
    var barH = 46;
    var height = barH + 16;
    var gap = 2;

    var svg = el("svg", {
      class: "chart", viewBox: "0 0 " + width + " " + height, width: width, height: height,
      role: "img", "aria-label": opts.ariaLabel || "Share of revenue"
    }, container);

    var surface = cssVar(container, "--surface");
    var total = opts.segments.reduce(function (s, d) { return s + d.value; }, 0) || 1;
    var usable = width - gap * (opts.segments.length - 1);
    var x = 0;

    opts.segments.forEach(function (seg, i) {
      var w = (seg.value / total) * usable;
      var first = i === 0;
      var last = i === opts.segments.length - 1;
      var r = 4;

      var group = el("g", { tabindex: "0", class: "seg", role: "listitem" }, svg);

      // rounded only on the outer ends of the whole bar
      var d = first || last
        ? roundedSegment(x, 8, w, barH, r, first, last)
        : "M" + x + ",8 H" + (x + w) + " V" + (8 + barH) + " H" + x + "Z";
      el("path", { d: d, fill: seg.color }, group);

      var pctText = Fmt.pct(seg.value / total, 0);
      var labelText = seg.label + " " + pctText;
      var fits = textWidth(labelText, 12) + 20 < w;
      var pctFits = textWidth(pctText, 12) + 16 < w;

      if (fits || pctFits) {
        el("text", {
          x: x + w / 2, y: 8 + barH / 2 + 4, "text-anchor": "middle",
          class: "chart-label seg-label", fill: seg.ink
        }, group).textContent = fits ? labelText : pctText;
      }

      var hit = el("rect", { x: x, y: 0, width: w, height: height, fill: "transparent" }, group);

      function show(event) {
        var box = hit.getBoundingClientRect();
        tip.show([
          { label: seg.label, head: true },
          { label: "Net revenue", value: Fmt.money(seg.value), color: seg.color, strong: true },
          { label: "Share", value: Fmt.pct(seg.value / total) },
          { label: "Gross margin", value: Fmt.pct(seg.marginPct) },
          { label: "vs " + opts.compareName, value: seg.shift == null ? "—" : Fmt.pp(seg.shift) + " share" }
        ], event && event.clientX != null ? event.clientX : box.left + box.width / 2,
           event && event.clientY != null ? event.clientY : box.top + 20);
      }

      group.addEventListener("pointermove", show);
      group.addEventListener("pointerleave", function () { tip.hide(); });
      group.addEventListener("focus", show);
      group.addEventListener("blur", function () { tip.hide(); });

      x += w + gap;
    });
  }

  function roundedSegment(x, y, w, h, r, roundLeft, roundRight) {
    r = Math.min(r, w / 2, h / 2);
    var d = "M" + (x + (roundLeft ? r : 0)) + "," + y;
    d += "H" + (x + w - (roundRight ? r : 0));
    if (roundRight) d += "A" + r + "," + r + " 0 0 1 " + (x + w) + "," + (y + r);
    d += "V" + (y + h - (roundRight ? r : 0));
    if (roundRight) d += "A" + r + "," + r + " 0 0 1 " + (x + w - r) + "," + (y + h);
    d += "H" + (x + (roundLeft ? r : 0));
    if (roundLeft) d += "A" + r + "," + r + " 0 0 1 " + x + "," + (y + h - r);
    d += "V" + (y + (roundLeft ? r : 0));
    if (roundLeft) d += "A" + r + "," + r + " 0 0 1 " + (x + r) + "," + y;
    return d + "Z";
  }


  /* ----------------------------------------------------- diverging bars */

  /**
   * Signed change around a zero line — the two poles read as opposite (cool
   * gain / warm loss) with a neutral axis between them.
   */
  function diverging(container, opts) {
    container.innerHTML = "";
    var width = container.clientWidth || 420;
    var rowH = 28;
    var barH = 14;
    var labelW = Math.min(132, Math.max(90, width * 0.32));
    var valueW = 56;
    var height = opts.items.length * rowH + 6;

    var svg = el("svg", {
      class: "chart", viewBox: "0 0 " + width + " " + height, width: width, height: height,
      role: "img", "aria-label": opts.ariaLabel || "Change by category"
    }, container);

    var pos = cssVar(container, "--diverge-pos");
    var neg = cssVar(container, "--diverge-neg");
    var ink = cssVar(container, "--text-secondary");
    var primary = cssVar(container, "--text-primary");
    var axis = cssVar(container, "--axis");

    var plotW = Math.max(40, width - labelW - valueW);
    var mid = labelW + plotW / 2;
    var max = Math.max.apply(null, opts.items.map(function (d) { return Math.abs(d.value); }).concat([0.0001]));

    el("line", { x1: mid, x2: mid, y1: 0, y2: height - 6, stroke: axis, "stroke-width": 1 }, svg);

    opts.items.forEach(function (item, i) {
      var y = i * rowH + 4;
      var w = (Math.abs(item.value) / max) * (plotW / 2 - 4);
      var up = item.value >= 0;
      var group = el("g", { tabindex: "0", class: "bar-row", role: "listitem" }, svg);

      el("text", { x: 0, y: y + barH / 2 + 4, class: "chart-label", fill: ink }, group)
        .textContent = truncate(item.label, labelW - 10, 12);

      el("path", {
        d: up ? barPath(mid, y, Math.max(1.5, w), barH, 3, true)
              : barPathLeft(mid, y, Math.max(1.5, w), barH, 3),
        fill: up ? pos : neg
      }, group);

      el("text", {
        x: width - valueW + 8, y: y + barH / 2 + 4, class: "chart-value", fill: primary
      }, group).textContent = opts.format(item.value);

      var hit = el("rect", { x: 0, y: y - 6, width: width, height: rowH, fill: "transparent" }, group);

      function show(event) {
        var box = hit.getBoundingClientRect();
        tip.show([{ label: item.label, head: true }].concat(item.rows || []),
          event && event.clientX != null ? event.clientX : box.right - 40,
          event && event.clientY != null ? event.clientY : box.top + rowH / 2);
      }
      group.addEventListener("pointermove", show);
      group.addEventListener("pointerleave", function () { tip.hide(); });
      group.addEventListener("focus", show);
      group.addEventListener("blur", function () { tip.hide(); });
    });
  }

  /** Mirror of barPath: grows leftward from x, rounded on the left end. */
  function barPathLeft(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w, h / 2));
    return "M" + x + "," + y +
      "H" + (x - w + r) + "A" + r + "," + r + " 0 0 0 " + (x - w) + "," + (y + r) +
      "V" + (y + h - r) + "A" + r + "," + r + " 0 0 0 " + (x - w + r) + "," + (y + h) +
      "H" + x + "Z";
  }

  /* ------------------------------------------------------------- sparkline */

  /** 12-point trend for a stat tile or table row. Decorative scale, no axis. */
  function sparkline(values, opts) {
    opts = opts || {};
    var width = opts.width || 84;
    var height = opts.height || 26;
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("class", "sparkline");
    svg.setAttribute("aria-hidden", "true");

    if (!values.length) return svg;
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = max - min || 1;
    var stepX = values.length > 1 ? width / (values.length - 1) : width;

    var d = values.map(function (v, i) {
      var x = i * stepX;
      var y = height - 3 - ((v - min) / span) * (height - 6);
      return (i ? "L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");

    el("path", { d: d, fill: "none", stroke: "currentColor", "stroke-width": 1.5,
                 "stroke-linejoin": "round", "stroke-linecap": "round", opacity: 0.55 }, svg);

    var lastX = (values.length - 1) * stepX;
    var lastY = height - 3 - ((values[values.length - 1] - min) / span) * (height - 6);
    el("circle", { cx: lastX.toFixed(1), cy: lastY.toFixed(1), r: 2.6, fill: "currentColor" }, svg);
    return svg;
  }

  global.Charts = {
    line: line,
    barsH: barsH,
    stacked: stacked,
    diverging: diverging,
    sparkline: sparkline,
    tooltip: tip,
    cssVar: cssVar
  };
})(window);
