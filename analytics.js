/**
 * Aggregation and the insight engine.
 *
 * Everything here is pure: fact rows in, numbers and findings out. An insight is
 * only emitted when the data actually supports it — no finding is invented to
 * fill the panel.
 */
(function (global) {
  "use strict";

  var cfg = global.APP_CONFIG;
  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ------------------------------------------------------------ formatting */

  var money = new Intl.NumberFormat(cfg.locale, {
    style: "currency", currency: cfg.currency, maximumFractionDigits: 0
  });
  var moneyCompact = new Intl.NumberFormat(cfg.locale, {
    style: "currency", currency: cfg.currency, notation: "compact",
    maximumFractionDigits: 1
  });

  var Fmt = {
    money: function (v) { return money.format(v || 0); },
    moneyShort: function (v) { return moneyCompact.format(v || 0); },
    int: function (v) { return new Intl.NumberFormat(cfg.locale).format(Math.round(v || 0)); },
    pct: function (v, digits) { return (100 * (v || 0)).toFixed(digits == null ? 1 : digits) + "%"; },
    /** Percentage-point difference, always signed. */
    pp: function (v, digits) {
      var n = 100 * (v || 0);
      return (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(digits == null ? 1 : digits) + " pp";
    },
    signedPct: function (v, digits) {
      if (v == null || !Number.isFinite(v)) return "—";
      var n = 100 * v;
      return (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(digits == null ? 1 : digits) + "%";
    },
    signedMoney: function (v) {
      return (v >= 0 ? "+" : "−") + moneyCompact.format(Math.abs(v || 0));
    },
    period: function (p) {
      return MONTH_NAMES[parseInt(String(p).slice(4), 10) - 1] + " " + String(p).slice(0, 4);
    },
    periodShort: function (p) {
      var m = parseInt(String(p).slice(4), 10);
      return MONTH_NAMES[m - 1] + (m === 1 ? " " + String(p).slice(2, 4) : "");
    }
  };

  /* ----------------------------------------------------------- aggregation */

  function blank() {
    return { revenue: 0, cost: 0, quantity: 0, orders: 0, returns: 0 };
  }

  function add(acc, row) {
    acc.revenue += row.revenue;
    acc.cost += row.cost;
    acc.quantity += row.quantity;
    acc.orders += row.orders;
    acc.returns += row.returns;
    return acc;
  }

  function derive(t) {
    t.margin = t.revenue - t.cost;
    t.marginPct = t.revenue ? t.margin / t.revenue : 0;
    t.avgOrder = t.orders ? t.revenue / t.orders : 0;
    t.returnsRate = t.revenue ? t.returns / t.revenue : 0;
    return t;
  }

  function total(rows) {
    return derive(rows.reduce(add, blank()));
  }

  /** Groups rows by a field, returning `[{ id, ...totals }]` sorted by revenue. */
  function groupBy(rows, field) {
    var map = new Map();
    rows.forEach(function (row) {
      var key = row[field];
      if (!map.has(key)) map.set(key, blank());
      add(map.get(key), row);
    });
    return Array.from(map, function (entry) {
      var t = derive(entry[1]);
      t.id = entry[0];
      return t;
    }).sort(function (a, b) { return b.revenue - a.revenue; });
  }

  /** One point per period in `periods`, zero-filled so the line has no gaps. */
  function series(rows, periods) {
    var map = new Map();
    periods.forEach(function (p) { map.set(p, blank()); });
    rows.forEach(function (row) {
      if (map.has(row.period)) add(map.get(row.period), row);
    });
    return periods.map(function (p) {
      var t = derive(map.get(p));
      t.period = p;
      return t;
    });
  }

  function indexBy(list) {
    var map = new Map();
    list.forEach(function (item) { map.set(item.id, item); });
    return map;
  }

  function change(cur, prev) {
    if (!prev) return null;
    return (cur - prev) / Math.abs(prev);
  }

  /* -------------------------------------------------------------- insights */

  var MIN_SHARE = 0.02; // ignore slices too small to be worth a card

  /**
   * @param {object} ctx { current, previous, names, labels }
   * @returns {Array} insight cards, most consequential first
   */
  function insights(ctx) {
    var cur = ctx.current, prev = ctx.previous;
    var curTotal = total(cur), prevTotal = total(prev);
    var found = [];

    found.push(
      driverInsight(cur, prev, curTotal, prevTotal, ctx, "materialGroup", "materialGroups", 1),
      dragInsight(cur, prev, ctx, "materialGroup", "materialGroups"),
      marginInsight(cur, prev, ctx),
      channelShiftInsight(cur, prev, curTotal, prevTotal, ctx),
      concentrationInsight(cur, curTotal, ctx),
      returnsInsight(cur, curTotal, ctx),
      anomalyInsight(ctx)
    );

    return found.filter(Boolean).sort(function (a, b) { return b.weight - a.weight; });
  }

  function deltaList(cur, prev, field) {
    var c = indexBy(groupBy(cur, field));
    var p = indexBy(groupBy(prev, field));
    var ids = new Set(Array.from(c.keys()).concat(Array.from(p.keys())));
    return Array.from(ids, function (id) {
      var a = c.get(id) || derive(blank());
      var b = p.get(id) || derive(blank());
      return {
        id: id,
        current: a,
        previous: b,
        delta: a.revenue - b.revenue,
        changePct: change(a.revenue, b.revenue),
        marginDelta: a.marginPct - b.marginPct
      };
    });
  }

  function driverInsight(cur, prev, curTotal, prevTotal, ctx, field, nameKey) {
    var totalDelta = curTotal.revenue - prevTotal.revenue;
    var top = deltaList(cur, prev, field)
      .filter(function (d) { return d.delta > 0 && d.previous.revenue > 0; })
      .sort(function (a, b) { return b.delta - a.delta })[0];
    if (!top || !totalDelta || top.delta / curTotal.revenue < MIN_SHARE) return null;

    var shareOfGrowth = totalDelta > 0 ? top.delta / totalDelta : null;
    var name = ctx.names[nameKey].get(top.id) || top.id;

    return {
      id: "driver",
      severity: "good",
      title: name + " is carrying the growth",
      detail: "Revenue rose " + Fmt.signedMoney(top.delta) + " (" + Fmt.signedPct(top.changePct) +
        ") to " + Fmt.moneyShort(top.current.revenue) +
        (shareOfGrowth && shareOfGrowth <= 1
          ? ", which is " + Fmt.pct(shareOfGrowth, 0) + " of the total increase."
          : ".") +
        " Gross margin there is " + Fmt.pct(top.current.marginPct) + ".",
      focus: { dim: field, id: top.id },
      weight: 100 * Math.abs(top.delta / curTotal.revenue)
    };
  }

  function dragInsight(cur, prev, ctx, field, nameKey) {
    var worst = deltaList(cur, prev, field)
      .filter(function (d) { return d.previous.revenue > 0; })
      .sort(function (a, b) { return a.delta - b.delta })[0];
    if (!worst || worst.delta >= 0) return null;

    var curTotal = total(cur);
    if (Math.abs(worst.delta) / curTotal.revenue < MIN_SHARE) return null;

    var name = ctx.names[nameKey].get(worst.id) || worst.id;
    return {
      id: "drag",
      severity: worst.changePct <= -0.15 ? "critical" : "warning",
      title: name + " is shrinking",
      detail: "Down " + Fmt.moneyShort(Math.abs(worst.delta)) + " (" + Fmt.signedPct(worst.changePct) +
        ") against " + ctx.labels.comparison + ", now " + Fmt.moneyShort(worst.current.revenue) +
        " at " + Fmt.pct(worst.current.marginPct) + " margin.",
      focus: { dim: field, id: worst.id },
      weight: 100 * Math.abs(worst.delta / curTotal.revenue) + 10
    };
  }

  /** Revenue up but margin down — growth bought with mix or discount. */
  function marginInsight(cur, prev, ctx) {
    var hit = deltaList(cur, prev, "salesOrg")
      .filter(function (d) {
        return d.previous.revenue > 0 && d.changePct > 0.02 && d.marginDelta <= -0.01;
      })
      .sort(function (a, b) { return a.marginDelta - b.marginDelta })[0];
    if (!hit) return null;

    var name = ctx.names.salesOrgs.get(hit.id) || hit.id;
    var lostMargin = Math.abs(hit.marginDelta) * hit.current.revenue;

    return {
      id: "margin",
      severity: hit.marginDelta <= -0.025 ? "critical" : "warning",
      title: name + " is growing on thinner margin",
      detail: "Revenue " + Fmt.signedPct(hit.changePct) + " but gross margin " +
        Fmt.pp(hit.marginDelta) + " to " + Fmt.pct(hit.current.marginPct) +
        " — worth about " + Fmt.moneyShort(lostMargin) + " of margin at today's volume.",
      focus: { dim: "salesOrg", id: hit.id },
      weight: 100 * Math.abs(hit.marginDelta) * 8
    };
  }

  function channelShiftInsight(cur, prev, curTotal, prevTotal, ctx) {
    if (!curTotal.revenue || !prevTotal.revenue) return null;
    var moves = deltaList(cur, prev, "channel").map(function (d) {
      return {
        id: d.id,
        shareNow: d.current.revenue / curTotal.revenue,
        shareBefore: d.previous.revenue / prevTotal.revenue,
        shift: d.current.revenue / curTotal.revenue - d.previous.revenue / prevTotal.revenue
      };
    }).sort(function (a, b) { return Math.abs(b.shift) - Math.abs(a.shift) });

    var top = moves[0];
    if (!top || Math.abs(top.shift) < 0.015) return null;
    var counter = moves.filter(function (m) {
      return m.id !== top.id && Math.sign(m.shift) !== Math.sign(top.shift);
    })[0];

    var name = ctx.names.channels.get(top.id) || top.id;
    var detail = "Its share of revenue moved " + Fmt.pp(top.shift) + " to " +
      Fmt.pct(top.shareNow) + " against " + ctx.labels.comparison + ".";
    if (counter) {
      detail += " " + (ctx.names.channels.get(counter.id) || counter.id) + " gave up " +
        Fmt.pp(counter.shift) + ".";
    }

    return {
      id: "channel",
      severity: "info",
      title: name + (top.shift > 0 ? " is taking share" : " is losing share"),
      detail: detail,
      focus: { dim: "channel", id: top.id },
      weight: 100 * Math.abs(top.shift) * 3
    };
  }

  function concentrationInsight(cur, curTotal, ctx) {
    var groups = groupBy(cur, "materialGroup");
    if (groups.length < 4 || !curTotal.revenue) return null;
    var topThree = groups.slice(0, 3);
    var share = topThree.reduce(function (s, g) { return s + g.revenue; }, 0) / curTotal.revenue;
    if (share < 0.55) return null;

    var names = topThree.map(function (g) {
      return ctx.names.materialGroups.get(g.id) || g.id;
    });

    return {
      id: "concentration",
      severity: share >= 0.7 ? "warning" : "info",
      title: "Revenue leans on three material groups",
      detail: names.join(", ") + " together make " + Fmt.pct(share, 0) +
        " of the selected revenue across " + groups.length + " groups.",
      focus: null,
      weight: 100 * (share - 0.5)
    };
  }

  function returnsInsight(cur, curTotal, ctx) {
    if (curTotal.returnsRate <= 0) return null;
    var worst = groupBy(cur, "materialGroup")
      .filter(function (g) { return g.revenue / curTotal.revenue >= MIN_SHARE; })
      .sort(function (a, b) { return b.returnsRate - a.returnsRate })[0];
    if (!worst) return null;
    if (worst.returnsRate < 0.02 || worst.returnsRate < curTotal.returnsRate * 1.8) return null;

    var name = ctx.names.materialGroups.get(worst.id) || worst.id;
    return {
      id: "returns",
      severity: worst.returnsRate >= 0.035 ? "critical" : "warning",
      title: "Credit memos concentrate in " + name,
      detail: Fmt.pct(worst.returnsRate) + " of its revenue comes back as returns, against " +
        Fmt.pct(curTotal.returnsRate) + " overall — " + Fmt.moneyShort(worst.returns) +
        " in the selected period.",
      focus: { dim: "materialGroup", id: worst.id },
      weight: 100 * worst.returnsRate * 6
    };
  }

  /** Flags a month more than 2 standard deviations off the mean. */
  function anomalyInsight(ctx) {
    var points = ctx.series;
    if (!points || points.length < 6) return null;
    var values = points.map(function (p) { return p.revenue; });
    var mean = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
    if (!mean) return null;
    var sd = Math.sqrt(values.reduce(function (s, v) {
      return s + Math.pow(v - mean, 2);
    }, 0) / values.length);
    if (!sd) return null;

    var outlier = points.map(function (p) {
      return { period: p.period, revenue: p.revenue, z: (p.revenue - mean) / sd };
    }).sort(function (a, b) { return Math.abs(b.z) - Math.abs(a.z) })[0];
    if (Math.abs(outlier.z) < 2) return null;

    // Name the slice that accounts for most of the gap, rather than guess at a cause.
    var monthRows = ctx.current.filter(function (r) { return r.period === outlier.period; });
    var byOrg = groupBy(monthRows, "salesOrg")[0];
    var byGroup = groupBy(monthRows, "materialGroup")[0];
    var where = byOrg && byGroup
      ? " Largest slice that month: " + (ctx.names.salesOrgs.get(byOrg.id) || byOrg.id) +
        " / " + (ctx.names.materialGroups.get(byGroup.id) || byGroup.id) + "."
      : "";

    return {
      id: "anomaly",
      severity: "info",
      title: Fmt.period(outlier.period) + (outlier.z > 0 ? " ran hot" : " ran cold"),
      detail: Fmt.moneyShort(outlier.revenue) + " is " +
        Fmt.signedPct((outlier.revenue - mean) / mean) + " against the " +
        points.length + "-month average of " + Fmt.moneyShort(mean) + "." + where,
      focus: null,
      weight: 100 * Math.abs(outlier.z) * 0.8
    };
  }

  global.Fmt = Fmt;
  global.Analytics = {
    total: total,
    groupBy: groupBy,
    series: series,
    change: change,
    deltaList: deltaList,
    insights: insights
  };
})(window);
