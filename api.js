/**
 * Data access.
 *
 * The only file that knows where the figures come from. Both sources return the
 * same row shape, aggregated by period × sales org × distribution channel ×
 * material group — the grain an SAP analytical CDS view hands back:
 *
 *   { period, salesOrg, channel, materialGroup,
 *     revenue, cost, quantity, orders, returns, currency }
 */
(function (global) {
  "use strict";

  var cfg = global.APP_CONFIG;

  /* ------------------------------------------------------------------ mock */

  var mockRows = null;

  function mockFacts(query) {
    if (!mockRows) mockRows = global.DemoData.rows();

    var rows = mockRows.filter(function (r) {
      if (r.period < query.fromPeriod || r.period > query.toPeriod) return false;
      if (query.salesOrg.length && query.salesOrg.indexOf(r.salesOrg) === -1) return false;
      if (query.channel.length && query.channel.indexOf(r.channel) === -1) return false;
      if (query.materialGroup.length && query.materialGroup.indexOf(r.materialGroup) === -1) return false;
      return true;
    });

    return delay(rows);
  }

  function mockDimensions() {
    return delay({
      salesOrgs: global.DemoData.salesOrgs.list,
      channels: global.DemoData.channels.list,
      materialGroups: global.DemoData.materialGroups.list,
      periods: global.DemoData.periods()
    });
  }

  function delay(value) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(value); }, cfg.mockLatencyMs || 0);
    });
  }

  /* ------------------------------------------------------------- SAP OData */

  /** SAP escapes a single quote inside an OData string literal by doubling it. */
  function lit(value) {
    return "'" + String(value).replace(/'/g, "''") + "'";
  }

  /** `Field eq 'A' or Field eq 'B'`, parenthesised — empty selection means "all". */
  function anyOf(field, values) {
    if (!values.length) return "";
    return "(" + values.map(function (v) { return field + " eq " + lit(v); }).join(" or ") + ")";
  }

  function buildUrl(query) {
    var f = cfg.sap.fields;
    var where = [
      f.period + " ge " + lit(query.fromPeriod),
      f.period + " le " + lit(query.toPeriod),
      anyOf(f.salesOrg, query.salesOrg),
      anyOf(f.channel, query.channel),
      anyOf(f.materialGroup, query.materialGroup)
    ].filter(Boolean).join(" and ");

    var groupBy = [f.period, f.salesOrg, f.channel, f.materialGroup].join(",");
    var aggregate = [
      f.revenue + " with sum as " + f.revenue,
      f.cost + " with sum as " + f.cost,
      f.quantity + " with sum as " + f.quantity,
      f.orders + " with sum as " + f.orders,
      f.returns + " with sum as " + f.returns
    ].join(",");

    var apply = "filter(" + where + ")/groupby((" + groupBy + "),aggregate(" + aggregate + "))";

    return cfg.sap.baseUrl.replace(/\/$/, "") + "/" + cfg.sap.entitySet +
      "?$apply=" + encodeURIComponent(apply);
  }

  function num(value) {
    var n = typeof value === "string" ? parseFloat(value) : value;
    return Number.isFinite(n) ? n : 0;
  }

  function normalize(raw) {
    var f = cfg.sap.fields;
    return {
      period: String(raw[f.period] || "").replace("-", ""),
      salesOrg: String(raw[f.salesOrg] || ""),
      channel: String(raw[f.channel] || ""),
      materialGroup: String(raw[f.materialGroup] || ""),
      revenue: num(raw[f.revenue]),
      cost: num(raw[f.cost]),
      quantity: num(raw[f.quantity]),
      orders: num(raw[f.orders]),
      returns: num(raw[f.returns]),
      currency: raw[f.currency] || cfg.currency
    };
  }

  function sapFetch(url) {
    return fetch(url, {
      headers: Object.assign({ Accept: "application/json" }, cfg.sap.headers || {}),
      credentials: cfg.sap.credentials || "same-origin"
    }).then(function (res) {
      if (!res.ok) throw new Error("SAP request failed: " + res.status + " " + res.statusText);
      return res.json();
    });
  }

  function sapFacts(query) {
    return sapFetch(buildUrl(query)).then(function (body) {
      return (body.value || []).map(normalize);
    });
  }

  function sapDimensions() {
    var f = cfg.sap.fields;
    var url = cfg.sap.baseUrl.replace(/\/$/, "") + "/" + cfg.sap.entitySet +
      "?$apply=" + encodeURIComponent(
        "groupby((" + [f.period, f.salesOrg, f.salesOrgText, f.channel, f.channelText,
                       f.materialGroup, f.materialGroupText].join(",") + "))"
      );

    return sapFetch(url).then(function (body) {
      var rows = body.value || [];
      return {
        salesOrgs: distinct(rows, f.salesOrg, f.salesOrgText),
        channels: distinct(rows, f.channel, f.channelText),
        materialGroups: distinct(rows, f.materialGroup, f.materialGroupText),
        periods: rows.map(function (r) { return String(r[f.period]); })
          .filter(unique).sort()
      };
    });
  }

  function distinct(rows, idField, textField) {
    var seen = {};
    var out = [];
    rows.forEach(function (r) {
      var id = String(r[idField] || "");
      if (!id || seen[id]) return;
      seen[id] = true;
      out.push({ id: id, name: String(r[textField] || id) });
    });
    return out.sort(function (a, b) { return a.id.localeCompare(b.id); });
  }

  function unique(value, index, arr) {
    return arr.indexOf(value) === index;
  }

  /* ---------------------------------------------------------------- public */

  function live() {
    return !cfg.useMock && !!cfg.sap.baseUrl;
  }

  global.Api = {
    /** True when figures come from SAP rather than the generated dataset. */
    isLive: live,
    sourceLabel: function () { return live() ? "SAP" : "Demo data"; },

    /** Filter values for the dropdowns. */
    dimensions: function () {
      return live() ? sapDimensions() : mockDimensions();
    },

    /**
     * @param {{fromPeriod: string, toPeriod: string, salesOrg: string[],
     *          channel: string[], materialGroup: string[]}} query
     * @returns {Promise<Array>} fact rows
     */
    facts: function (query) {
      return live() ? sapFacts(query) : mockFacts(query);
    },

    /** Exposed for tests and for eyeballing the generated OData call. */
    buildUrl: buildUrl
  };
})(window);
