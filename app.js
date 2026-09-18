/**
 * Dashboard wiring: filter state, data loading, rendering.
 *
 * Filters scope everything below them — one load, one slice, every figure on the
 * page computed from it, so the numbers always agree.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "revenue.filters.v1";
  var TOP_GROUPS = 8;

  var state = {
    months: 12,
    compare: "year",
    salesOrg: new Set(),
    channel: new Set(),
    materialGroup: new Set(),
    theme: null
  };

  var dims = null;        // { salesOrgs, channels, materialGroups, periods }
  var names = {};         // id -> text, per dimension
  var view = null;        // last rendered slice, kept for re-render on resize/theme
  var loadToken = 0;

  var dom = {
    main: document.getElementById("main"),
    chips: document.getElementById("chips"),
    periodLabel: document.getElementById("period-label"),
    heroValue: document.getElementById("hero-value"),
    heroDelta: document.getElementById("hero-delta"),
    heroNote: document.getElementById("hero-note"),
    kpis: document.getElementById("kpis"),
    insights: document.getElementById("insights"),
    sourceBadge: document.getElementById("source-badge"),
    footNote: document.getElementById("foot-note")
  };

  /* ----------------------------------------------------------------- theme */

  function initTheme() {
    var stored = read("revenue.theme");
    if (stored === "dark" || stored === "light") {
      state.theme = stored;
      document.documentElement.setAttribute("data-theme", stored);
    }
    document.getElementById("theme-toggle").addEventListener("click", function () {
      var dark = state.theme
        ? state.theme === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      state.theme = dark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", state.theme);
      write("revenue.theme", state.theme);
      if (view) renderCharts(view);
    });
  }

  function read(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (err) { /* private mode */ }
  }

  /* ----------------------------------------------------------- filter state */

  function restore() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) return;
      state.months = saved.months || 12;
      state.compare = saved.compare || "year";
      ["salesOrg", "channel", "materialGroup"].forEach(function (key) {
        state[key] = new Set(saved[key] || []);
      });
    } catch (err) { /* ignore corrupt or blocked storage */ }
  }

  function persist() {
    write(STORAGE_KEY, JSON.stringify({
      months: state.months,
      compare: state.compare,
      salesOrg: Array.from(state.salesOrg),
      channel: Array.from(state.channel),
      materialGroup: Array.from(state.materialGroup)
    }));
  }

  /** Current window and its comparison window, as period-code ranges. */
  function ranges() {
    var all = dims.periods;
    var end = all.length - 1;
    var start = Math.max(0, end - state.months + 1);
    var shift = state.compare === "year" ? 12 : (end - start + 1);
    var compareEnd = start - shift + (state.compare === "year" ? state.months - 1 : state.months - 1);
    var compareStart = start - shift;

    return {
      current: { from: all[start], to: all[end], periods: all.slice(start, end + 1) },
      compare: compareStart < 0 ? null : {
        from: all[compareStart],
        to: all[Math.min(compareEnd, end)],
        periods: all.slice(compareStart, Math.min(compareEnd, end) + 1)
      }
    };
  }

  function comparisonLabel(r) {
    if (!r.compare) return "no comparable period";
    return Fmt.period(r.compare.from) + " – " + Fmt.period(r.compare.to);
  }

  /* -------------------------------------------------------------- controls */

  function multiSelect(host, opts) {
    host.innerHTML = "";
    var label = document.createElement("span");
    label.className = "field-label";
    label.textContent = opts.label;

    var button = document.createElement("button");
    button.type = "button";
    button.className = "select-btn";
    button.setAttribute("aria-haspopup", "true");
    button.setAttribute("aria-expanded", "false");

    var pop = document.createElement("div");
    pop.className = "popover";
    pop.hidden = true;

    var head = document.createElement("div");
    head.className = "popover-head";
    ["All", "None"].forEach(function (action) {
      var link = document.createElement("button");
      link.type = "button";
      link.className = "link-btn";
      link.textContent = action;
      link.addEventListener("click", function () {
        opts.selected.clear();
        if (action === "None") opts.items.forEach(function (i) { opts.selected.add(i.id); });
        sync();
        opts.onChange();
      });
      head.appendChild(link);
    });
    pop.appendChild(head);

    opts.items.forEach(function (item) {
      var row = document.createElement("label");
      row.className = "popover-row";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.value = item.id;
      box.addEventListener("change", function () {
        if (box.checked) opts.selected.add(item.id);
        else opts.selected.delete(item.id);
        sync();
        opts.onChange();
      });
      var text = document.createElement("span");
      text.textContent = item.name;
      var code = document.createElement("span");
      code.className = "popover-code";
      code.textContent = item.id;
      row.appendChild(box);
      row.appendChild(text);
      row.appendChild(code);
      pop.appendChild(row);
    });

    function sync() {
      var count = opts.selected.size;
      button.textContent = count === 0
        ? "All " + opts.items.length
        : count === 1
          ? (opts.items.filter(function (i) { return opts.selected.has(i.id); })[0] || {}).name
          : count + " selected";
      Array.prototype.forEach.call(pop.querySelectorAll("input"), function (box) {
        box.checked = opts.selected.has(box.value);
      });
      button.classList.toggle("is-set", count > 0);
    }

    button.addEventListener("click", function () {
      var open = pop.hidden;
      closeAllPopovers();
      pop.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    });

    host.appendChild(label);
    host.appendChild(button);
    host.appendChild(pop);
    sync();
    return { sync: sync };
  }

  function closeAllPopovers() {
    Array.prototype.forEach.call(document.querySelectorAll(".popover"), function (pop) {
      pop.hidden = true;
      var button = pop.previousElementSibling;
      if (button) button.setAttribute("aria-expanded", "false");
    });
  }

  document.addEventListener("click", function (event) {
    if (!event.target.closest(".field")) closeAllPopovers();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") { closeAllPopovers(); Charts.tooltip.hide(); }
  });

  var controls = {};

  function buildFilters() {
    controls.salesOrg = multiSelect(document.getElementById("f-vkorg"), {
      label: "Sales organisation", items: dims.salesOrgs, selected: state.salesOrg, onChange: load
    });
    controls.channel = multiSelect(document.getElementById("f-vtweg"), {
      label: "Distribution channel", items: dims.channels, selected: state.channel, onChange: load
    });
    controls.materialGroup = multiSelect(document.getElementById("f-matkl"), {
      label: "Material group", items: dims.materialGroups, selected: state.materialGroup, onChange: load
    });

    var period = document.getElementById("f-period");
    period.value = String(state.months);
    period.addEventListener("change", function () {
      state.months = parseInt(period.value, 10);
      load();
    });

    var compare = document.getElementById("f-compare");
    compare.value = state.compare;
    compare.addEventListener("change", function () {
      state.compare = compare.value;
      load();
    });

    document.getElementById("f-reset").addEventListener("click", function () {
      state.salesOrg.clear();
      state.channel.clear();
      state.materialGroup.clear();
      state.months = 12;
      state.compare = "year";
      period.value = "12";
      compare.value = "year";
      syncControls();
      load();
    });
  }

  function syncControls() {
    Object.keys(controls).forEach(function (key) { controls[key].sync(); });
  }

  var DIM_LABEL = {
    salesOrg: "Sales org", channel: "Channel", materialGroup: "Material group"
  };
  var DIM_NAMES = {
    salesOrg: "salesOrgs", channel: "channels", materialGroup: "materialGroups"
  };

  function renderChips() {
    dom.chips.innerHTML = "";
    var any = false;

    ["salesOrg", "channel", "materialGroup"].forEach(function (dim) {
      state[dim].forEach(function (id) {
        any = true;
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        var key = document.createElement("span");
        key.className = "chip-dim";
        key.textContent = DIM_LABEL[dim];
        var value = document.createElement("span");
        value.textContent = names[DIM_NAMES[dim]].get(id) || id;
        var close = document.createElement("span");
        close.className = "chip-x";
        close.textContent = "×";
        chip.append(key, value, close);
        chip.title = "Remove this filter";
        chip.addEventListener("click", function () {
          state[dim].delete(id);
          syncControls();
          load();
        });
        dom.chips.appendChild(chip);
      });
    });

    dom.chips.hidden = !any;
  }

  /* ------------------------------------------------------------ data + render */

  function load() {
    persist();
    renderChips();

    var r = ranges();
    var token = ++loadToken;
    dom.main.classList.add("is-loading");

    var query = {
      salesOrg: Array.from(state.salesOrg),
      channel: Array.from(state.channel),
      materialGroup: Array.from(state.materialGroup)
    };

    var requests = [
      Api.facts(Object.assign({ fromPeriod: r.current.from, toPeriod: r.current.to }, query))
    ];
    requests.push(r.compare
      ? Api.facts(Object.assign({ fromPeriod: r.compare.from, toPeriod: r.compare.to }, query))
      : Promise.resolve([]));

    Promise.all(requests).then(function (result) {
      if (token !== loadToken) return;              // a newer filter change won
      dom.main.classList.remove("is-loading");
      render({
        ranges: r,
        current: result[0],
        previous: result[1],
        comparisonLabel: comparisonLabel(r)
      });
    }).catch(function (err) {
      if (token !== loadToken) return;
      dom.main.classList.remove("is-loading");
      showError(err);
    });
  }

  function showError(err) {
    dom.insights.innerHTML = "";
    var box = document.createElement("p");
    box.className = "empty";
    box.textContent = "Could not load figures: " + err.message;
    dom.insights.appendChild(box);
  }

  function render(slice) {
    view = slice;
    var cur = Analytics.total(slice.current);
    var prev = Analytics.total(slice.previous);

    dom.periodLabel.textContent =
      Fmt.period(slice.ranges.current.from) + " – " + Fmt.period(slice.ranges.current.to);

    dom.heroValue.textContent = Fmt.moneyShort(cur.revenue);
    dom.heroValue.title = Fmt.money(cur.revenue);
    renderDelta(dom.heroDelta, Analytics.change(cur.revenue, prev.revenue), "up", null);
    dom.heroNote.textContent = slice.current.length
      ? "vs " + slice.comparisonLabel + " · " + Fmt.int(cur.orders) + " billing documents"
      : "No billing documents match these filters.";

    renderKpis(cur, prev, slice);
    renderInsights(slice, cur, prev);
    renderCharts(slice);
  }

  function renderDelta(node, value, goodWhen, suffix) {
    node.innerHTML = "";
    if (value == null) { node.textContent = "—"; return; }
    var good = goodWhen === "up" ? value >= 0 : value <= 0;
    node.className = node.className.replace(/\bis-(good|bad)\b/g, "").trim() +
      " " + (good ? "is-good" : "is-bad");
    var arrow = document.createElement("span");
    arrow.className = "delta-arrow";
    arrow.textContent = value >= 0 ? "▲" : "▼";
    var text = document.createElement("span");
    text.textContent = Fmt.signedPct(value);
    node.append(arrow, text);
    if (suffix) {
      var note = document.createElement("span");
      note.className = "delta-note";
      note.textContent = suffix;
      node.appendChild(note);
    }
  }

  function renderKpis(cur, prev, slice) {
    var months = slice.ranges.current.periods;
    var trend = Analytics.series(slice.current, months);

    var tiles = [
      { label: "Gross margin", value: Fmt.pct(cur.marginPct),
        delta: cur.marginPct - prev.marginPct, deltaText: Fmt.pp(cur.marginPct - prev.marginPct),
        goodWhen: "up", spark: trend.map(function (p) { return p.marginPct; }) },
      { label: "Billing documents", value: Fmt.int(cur.orders),
        delta: Analytics.change(cur.orders, prev.orders), goodWhen: "up",
        spark: trend.map(function (p) { return p.orders; }) },
      { label: "Average order value", value: Fmt.money(cur.avgOrder),
        delta: Analytics.change(cur.avgOrder, prev.avgOrder), goodWhen: "up",
        spark: trend.map(function (p) { return p.avgOrder; }) },
      { label: "Returns rate", value: Fmt.pct(cur.returnsRate),
        delta: cur.returnsRate - prev.returnsRate,
        deltaText: Fmt.pp(cur.returnsRate - prev.returnsRate),
        goodWhen: "down", spark: trend.map(function (p) { return p.returnsRate; }) }
    ];

    dom.kpis.innerHTML = "";
    tiles.forEach(function (tile) {
      var card = document.createElement("div");
      card.className = "kpi";

      var label = document.createElement("p");
      label.className = "kpi-label";
      label.textContent = tile.label;

      var value = document.createElement("p");
      value.className = "kpi-value";
      value.textContent = tile.value;

      var delta = document.createElement("p");
      delta.className = "kpi-delta";
      if (tile.delta == null || !Number.isFinite(tile.delta)) {
        delta.textContent = "—";
      } else {
        var good = tile.goodWhen === "up" ? tile.delta >= 0 : tile.delta <= 0;
        delta.classList.add(good ? "is-good" : "is-bad");
        delta.textContent = (tile.delta >= 0 ? "▲ " : "▼ ") +
          (tile.deltaText || Fmt.signedPct(tile.delta));
      }

      var spark = document.createElement("div");
      spark.className = "kpi-spark";
      spark.appendChild(Charts.sparkline(tile.spark));

      card.append(label, value, delta, spark);
      dom.kpis.appendChild(card);
    });
  }

  var SEVERITY = {
    good: { label: "Growth", icon: "▲" },
    warning: { label: "Watch", icon: "!" },
    critical: { label: "Risk", icon: "!" },
    info: { label: "Note", icon: "i" }
  };

  function renderInsights(slice, cur, prev) {
    var months = slice.ranges.current.periods;
    var found = Analytics.insights({
      current: slice.current,
      previous: slice.previous,
      series: Analytics.series(slice.current, months),
      names: names,
      labels: { comparison: slice.comparisonLabel }
    }).slice(0, 4);

    dom.insights.innerHTML = "";

    if (!found.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = slice.current.length
        ? "Nothing stands out in this slice — revenue, margin and mix all moved within normal range."
        : "No billing documents match these filters.";
      dom.insights.appendChild(empty);
      return;
    }

    found.forEach(function (insight) {
      var meta = SEVERITY[insight.severity] || SEVERITY.info;
      var card = document.createElement(insight.focus ? "button" : "div");
      card.className = "insight sev-" + insight.severity;
      if (insight.focus) {
        card.type = "button";
        card.addEventListener("click", function () {
          state[insight.focus.dim] = new Set([insight.focus.id]);
          syncControls();
          load();
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
      }

      var tag = document.createElement("span");
      tag.className = "insight-tag";
      var icon = document.createElement("span");
      icon.className = "insight-icon";
      icon.textContent = meta.icon;
      var tagText = document.createElement("span");
      tagText.textContent = meta.label;
      tag.append(icon, tagText);

      var title = document.createElement("h3");
      title.textContent = insight.title;

      var detail = document.createElement("p");
      detail.textContent = insight.detail;

      card.append(tag, title, detail);

      if (insight.focus) {
        var action = document.createElement("span");
        action.className = "insight-action";
        action.textContent = "Filter to this →";
        card.appendChild(action);
      }

      dom.insights.appendChild(card);
    });
  }

  /* ---------------------------------------------------------------- charts */

  function cardShell(host, opts) {
    host.innerHTML = "";
    var head = document.createElement("div");
    head.className = "card-head";

    var titles = document.createElement("div");
    var title = document.createElement("h2");
    title.id = opts.titleId;
    title.textContent = opts.title;
    var sub = document.createElement("p");
    sub.className = "card-sub";
    sub.textContent = opts.subtitle;
    titles.append(title, sub);
    head.appendChild(titles);

    var chartHost = document.createElement("div");
    chartHost.className = "chart-host";
    var tableHost = document.createElement("div");
    tableHost.className = "table-host";
    tableHost.hidden = true;

    if (opts.table) {
      var toggle = document.createElement("div");
      toggle.className = "view-toggle";
      toggle.setAttribute("role", "group");
      toggle.setAttribute("aria-label", "View as");
      [["chart", "Chart"], ["table", "Table"]].forEach(function (pair, i) {
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = pair[1];
        button.className = i === 0 ? "is-active" : "";
        button.addEventListener("click", function () {
          Array.prototype.forEach.call(toggle.children, function (b) { b.classList.remove("is-active"); });
          button.classList.add("is-active");
          chartHost.hidden = pair[0] !== "chart";
          tableHost.hidden = pair[0] !== "table";
          Charts.tooltip.hide();
        });
        toggle.appendChild(button);
      });
      head.appendChild(toggle);
    }

    host.append(head, chartHost, tableHost);
    return { chart: chartHost, table: tableHost };
  }

  function table(host, columns, rows) {
    host.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "table-wrap";
    var t = document.createElement("table");
    var thead = document.createElement("thead");
    var tr = document.createElement("tr");
    columns.forEach(function (col) {
      var th = document.createElement("th");
      th.textContent = col.label;
      if (col.numeric) th.className = "num";
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    var tbody = document.createElement("tbody");
    rows.forEach(function (row) {
      var line = document.createElement("tr");
      columns.forEach(function (col) {
        var cell = document.createElement("td");
        if (col.numeric) cell.className = "num";
        var value = col.render ? col.render(row) : row[col.key || col.label];
        cell.setAttribute("data-col", col.label);
        if (value instanceof Node) cell.appendChild(value);
        else cell.textContent = value == null ? "—" : value;
        line.appendChild(cell);
      });
      tbody.appendChild(line);
    });
    t.append(thead, tbody);
    wrap.appendChild(t);
    host.appendChild(wrap);
  }

  function groupCount(slice) {
    return new Set(slice.current.map(function (r) { return r.materialGroup; })).size;
  }

  function renderCharts(slice) {
    var months = slice.ranges.current.periods;
    var curTotal = Analytics.total(slice.current);
    var trend = Analytics.series(slice.current, months);
    var prevTrend = slice.ranges.compare
      ? Analytics.series(slice.previous, slice.ranges.compare.periods)
      : [];

    /* --- trend ---------------------------------------------------------- */
    var trendCard = cardShell(document.getElementById("card-trend"), {
      titleId: "trend-title",
      title: "Net revenue by month",
      subtitle: "Selected period against " + slice.comparisonLabel,
      table: true
    });

    var legend = document.createElement("div");
    legend.className = "legend";
    [["--series-1", "Selected period", "line"], ["--deemphasis", slice.ranges.compare ? "Comparison" : "—", "line"]]
      .forEach(function (item) {
        if (!slice.ranges.compare && item[1] === "—") return;
        var entry = document.createElement("span");
        entry.className = "legend-item";
        var key = document.createElement("span");
        key.className = "legend-key";
        key.style.background = Charts.cssVar(document.body, item[0]);
        var text = document.createElement("span");
        text.textContent = item[1];
        entry.append(key, text);
        legend.appendChild(entry);
      });
    trendCard.chart.appendChild(legend);

    var plot = document.createElement("div");
    plot.className = "plot";
    trendCard.chart.appendChild(plot);

    Charts.line(plot, {
      current: trend.map(function (p) {
        return { value: p.revenue, label: Fmt.periodShort(p.period), fullLabel: Fmt.period(p.period) };
      }),
      compare: prevTrend.map(function (p) {
        return { value: p.revenue, label: Fmt.periodShort(p.period) };
      }),
      currentName: "Selected period",
      compareName: "Comparison",
      height: 280,
      ariaLabel: "Net revenue by month"
    });

    table(trendCard.table,
      [{ label: "Period" }, { label: "Net revenue", numeric: true },
       { label: "Gross margin", numeric: true }, { label: "Billing documents", numeric: true }],
      trend.map(function (p) {
        return {
          "Period": Fmt.period(p.period),
          "Net revenue": Fmt.money(p.revenue),
          "Gross margin": Fmt.pct(p.marginPct),
          "Billing documents": Fmt.int(p.orders)
        };
      }));

    /* --- material groups ------------------------------------------------ */
    var matklCard = cardShell(document.getElementById("card-matkl"), {
      titleId: "matkl-title",
      title: "Revenue by material group",
      subtitle: groupCount(slice) <= TOP_GROUPS
        ? "All " + groupCount(slice) + " groups in the selection"
        : "Top " + TOP_GROUPS + " of " + groupCount(slice) + " groups in the selection",
      table: true
    });

    var groups = Analytics.groupBy(slice.current, "materialGroup");
    var prevGroups = new Map(Analytics.groupBy(slice.previous, "materialGroup")
      .map(function (g) { return [g.id, g]; }));

    var barHost = document.createElement("div");
    barHost.className = "plot";
    matklCard.chart.appendChild(barHost);

    Charts.barsH(barHost, {
      compareName: "comparison",
      items: groups.slice(0, TOP_GROUPS).map(function (g) {
        var before = prevGroups.get(g.id);
        return {
          label: names.materialGroups.get(g.id) || g.id,
          value: g.revenue,
          share: curTotal.revenue ? g.revenue / curTotal.revenue : 0,
          marginPct: g.marginPct,
          changePct: before ? Analytics.change(g.revenue, before.revenue) : null
        };
      }),
      ariaLabel: "Revenue by material group"
    });

    table(matklCard.table,
      [{ label: "Material group" }, { label: "Net revenue", numeric: true },
       { label: "Share", numeric: true }, { label: "Gross margin", numeric: true },
       { label: "vs comparison", numeric: true }],
      groups.map(function (g) {
        var before = prevGroups.get(g.id);
        var change = before ? Analytics.change(g.revenue, before.revenue) : null;
        return {
          "Material group": (names.materialGroups.get(g.id) || g.id),
          "Net revenue": Fmt.money(g.revenue),
          "Share": Fmt.pct(curTotal.revenue ? g.revenue / curTotal.revenue : 0),
          "Gross margin": Fmt.pct(g.marginPct),
          "vs comparison": change == null ? "—" : Fmt.signedPct(change)
        };
      }));

    /* --- channel mix ---------------------------------------------------- */
    var channelCard = cardShell(document.getElementById("card-channel"), {
      titleId: "channel-title",
      title: "Share by distribution channel",
      subtitle: "Where the selected revenue is booked",
      table: true
    });

    var channels = Analytics.groupBy(slice.current, "channel");
    var prevTotal = Analytics.total(slice.previous);
    var prevChannels = new Map(Analytics.groupBy(slice.previous, "channel")
      .map(function (c) { return [c.id, c]; }));

    // colour follows the channel itself, so filtering never repaints the rest
    var order = dims.channels.map(function (c) { return c.id; });
    var segments = channels.slice().sort(function (a, b) {
      return order.indexOf(a.id) - order.indexOf(b.id);
    }).map(function (c) {
      var slot = (order.indexOf(c.id) % 4) + 1;
      var before = prevChannels.get(c.id);
      return {
        label: names.channels.get(c.id) || c.id,
        value: c.revenue,
        color: Charts.cssVar(document.body, "--series-" + slot),
        ink: Charts.cssVar(document.body, "--series-" + slot + "-ink"),
        marginPct: c.marginPct,
        shift: before && prevTotal.revenue && curTotal.revenue
          ? (c.revenue / curTotal.revenue) - (before.revenue / prevTotal.revenue)
          : null
      };
    });

    var stackHost = document.createElement("div");
    stackHost.className = "plot";
    channelCard.chart.appendChild(stackHost);
    Charts.stacked(stackHost, {
      segments: segments, compareName: "comparison", ariaLabel: "Share of revenue by distribution channel"
    });

    var channelLegend = document.createElement("div");
    channelLegend.className = "legend legend-grid";
    segments.forEach(function (seg) {
      var entry = document.createElement("span");
      entry.className = "legend-item";
      var key = document.createElement("span");
      key.className = "legend-key legend-swatch";
      key.style.background = seg.color;
      var text = document.createElement("span");
      text.textContent = seg.label;
      var value = document.createElement("span");
      value.className = "legend-value";
      value.textContent = Fmt.moneyShort(seg.value);
      entry.append(key, text, value);
      channelLegend.appendChild(entry);
    });
    channelCard.chart.appendChild(channelLegend);

    if (slice.ranges.compare && segments.some(function (s) { return s.shift != null; })) {
      var shiftHead = document.createElement("p");
      shiftHead.className = "sub-head";
      shiftHead.textContent = "Share shift vs comparison";
      channelCard.chart.appendChild(shiftHead);

      var shiftHost = document.createElement("div");
      shiftHost.className = "plot";
      channelCard.chart.appendChild(shiftHost);

      Charts.diverging(shiftHost, {
        format: function (v) { return Fmt.pp(v); },
        ariaLabel: "Change in share of revenue by distribution channel",
        items: segments.slice().sort(function (a, b) { return (b.shift || 0) - (a.shift || 0); })
          .map(function (seg) {
            return {
              label: seg.label,
              value: seg.shift || 0,
              rows: [
                { label: "Share now", value: Fmt.pct(curTotal.revenue ? seg.value / curTotal.revenue : 0), strong: true },
                { label: "Shift", value: Fmt.pp(seg.shift || 0) },
                { label: "Net revenue", value: Fmt.money(seg.value) }
              ]
            };
          })
      });
    }

    table(channelCard.table,
      [{ label: "Distribution channel" }, { label: "Net revenue", numeric: true },
       { label: "Share", numeric: true }, { label: "Gross margin", numeric: true },
       { label: "Share shift", numeric: true }],
      segments.map(function (seg) {
        return {
          "Distribution channel": seg.label,
          "Net revenue": Fmt.money(seg.value),
          "Share": Fmt.pct(curTotal.revenue ? seg.value / curTotal.revenue : 0),
          "Gross margin": Fmt.pct(seg.marginPct),
          "Share shift": seg.shift == null ? "—" : Fmt.pp(seg.shift)
        };
      }));

    /* --- sales organisations -------------------------------------------- */
    var orgCard = cardShell(document.getElementById("card-org"), {
      titleId: "org-title",
      title: "Sales organisations",
      subtitle: "Select a row to filter the dashboard to that organisation",
      table: false
    });

    var orgs = Analytics.groupBy(slice.current, "salesOrg");
    var prevOrgs = new Map(Analytics.groupBy(slice.previous, "salesOrg")
      .map(function (o) { return [o.id, o]; }));

    var wrap = document.createElement("div");
    wrap.className = "table-wrap";
    var t = document.createElement("table");
    t.className = "org-table";
    t.innerHTML = "<thead><tr>" +
      "<th>Sales organisation</th><th class='num'>Net revenue</th><th class='num'>Share</th>" +
      "<th class='num'>Gross margin</th><th class='num'>vs comparison</th><th>12-month trend</th>" +
      "</tr></thead>";
    var tbody = document.createElement("tbody");

    orgs.forEach(function (org) {
      var before = prevOrgs.get(org.id);
      var change = before ? Analytics.change(org.revenue, before.revenue) : null;
      var orgSeries = Analytics.series(
        slice.current.filter(function (r) { return r.salesOrg === org.id; }), months);

      var row = document.createElement("tr");
      row.tabIndex = 0;
      row.className = "org-row";

      var nameCell = document.createElement("td");
      nameCell.setAttribute("data-col", "Sales organisation");
      var code = document.createElement("span");
      code.className = "org-code";
      code.textContent = org.id;
      var label = document.createElement("span");
      label.textContent = names.salesOrgs.get(org.id) || org.id;
      nameCell.append(code, label);

      var cells = [
        ["Net revenue", Fmt.money(org.revenue)],
        ["Share", Fmt.pct(curTotal.revenue ? org.revenue / curTotal.revenue : 0)],
        ["Gross margin", Fmt.pct(org.marginPct)]
      ].map(function (pair) {
        var cell = document.createElement("td");
        cell.className = "num";
        cell.setAttribute("data-col", pair[0]);
        cell.textContent = pair[1];
        return cell;
      });

      var deltaCell = document.createElement("td");
      deltaCell.className = "num";
      deltaCell.setAttribute("data-col", "vs comparison");
      var deltaSpan = document.createElement("span");
      deltaSpan.className = "delta-pill " + (change == null ? "" : (change >= 0 ? "is-good" : "is-bad"));
      deltaSpan.textContent = change == null ? "—" : (change >= 0 ? "▲ " : "▼ ") + Fmt.signedPct(change);
      deltaCell.appendChild(deltaSpan);

      var sparkCell = document.createElement("td");
      sparkCell.className = "spark-cell";
      sparkCell.setAttribute("data-col", "12-month trend");
      sparkCell.appendChild(Charts.sparkline(
        orgSeries.map(function (p) { return p.revenue; }), { width: 110, height: 24 }));

      row.append(nameCell, cells[0], cells[1], cells[2], deltaCell, sparkCell);

      function focusOrg() {
        state.salesOrg = new Set([org.id]);
        syncControls();
        load();
      }
      row.addEventListener("click", focusOrg);
      row.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focusOrg(); }
      });

      tbody.appendChild(row);
    });

    t.appendChild(tbody);
    wrap.appendChild(t);
    orgCard.chart.appendChild(wrap);
  }

  /* ------------------------------------------------------------------ boot */

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (view) renderCharts(view); }, 150);
  });

  function start() {
    initTheme();
    restore();

    dom.sourceBadge.textContent = Api.sourceLabel();
    dom.sourceBadge.classList.toggle("is-live", Api.isLive());
    dom.sourceBadge.title = Api.isLive()
      ? "Figures read from the configured SAP OData service"
      : "Generated demo dataset — set APP_CONFIG.sap.baseUrl and useMock:false to read from SAP";
    if (Api.isLive()) dom.footNote.textContent = "Figures from SAP.";

    Api.dimensions().then(function (result) {
      dims = result;
      names = {
        salesOrgs: new Map(result.salesOrgs.map(function (d) { return [d.id, d.name]; })),
        channels: new Map(result.channels.map(function (d) { return [d.id, d.name]; })),
        materialGroups: new Map(result.materialGroups.map(function (d) { return [d.id, d.name]; }))
      };
      buildFilters();
      load();
    }).catch(showError);
  }

  start();
})();
