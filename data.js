/**
 * Demo dataset.
 *
 * Generates monthly billing facts shaped exactly like the rows the SAP OData
 * service returns, so swapping the data source changes nothing downstream.
 * The generator is seeded, so the figures — and therefore the insights — are
 * identical on every reload.
 */
(function (global) {
  "use strict";

  /** Sales organisations (SAP: VKORG). */
  var SALES_ORGS = [
    { id: "1000", name: "Germany — Frankfurt", weight: 1.00, growth:  0.03, marginAdj:  0.010 },
    { id: "2000", name: "US East — Newark",    weight: 0.82, growth:  0.07, marginAdj: -0.005 },
    { id: "3000", name: "APAC — Singapore",    weight: 0.55, growth:  0.12, marginAdj: -0.020, marginDrift: -0.030 },
    { id: "4000", name: "UK — Manchester",     weight: 0.41, growth: -0.06, marginAdj:  0.004 }
  ];

  /** Distribution channels (SAP: VTWEG). */
  var CHANNELS = [
    { id: "10", name: "Direct sales",  weight: 1.00, growth:  0.01, marginAdj:  0.030 },
    { id: "20", name: "Wholesale",     weight: 0.74, growth: -0.01, marginAdj: -0.020 },
    { id: "30", name: "E-commerce",    weight: 0.38, growth:  0.24, marginAdj:  0.015 },
    { id: "40", name: "Distributors",  weight: 0.52, growth: -0.09, marginAdj: -0.035 }
  ];

  /** Material groups (SAP: MATKL). */
  var MATERIAL_GROUPS = [
    { id: "PUMP", name: "Hydraulic pumps",   weight: 1.00, growth:  0.02, margin: 0.34, asp: 2150, returns: 0.011 },
    { id: "VALV", name: "Valves & fittings", weight: 0.78, growth:  0.00, margin: 0.31, asp:  640, returns: 0.013 },
    { id: "MOTR", name: "Electric motors",   weight: 0.71, growth:  0.04, margin: 0.28, asp: 1780, returns: 0.009 },
    { id: "BRNG", name: "Bearings",          weight: 0.52, growth: -0.01, margin: 0.26, asp:  190, returns: 0.015 },
    { id: "SENS", name: "Sensors & IoT",     weight: 0.44, growth:  0.27, margin: 0.47, asp:  410, returns: 0.008 },
    { id: "SEAL", name: "Seals & gaskets",   weight: 0.38, growth: -0.16, margin: 0.22, asp:   75, returns: 0.021, returnsDrift: 0.012 },
    { id: "SRVK", name: "Service kits",      weight: 0.33, growth:  0.06, margin: 0.52, asp:  320, returns: 0.006 },
    { id: "SPAR", name: "Spare parts",       weight: 0.46, growth:  0.03, margin: 0.39, asp:  145, returns: 0.018 }
  ];

  /** Combinations that simply don't exist in this business. */
  var EXCLUDED = {
    "30|PUMP": true,  // pumps are never sold through the web shop
    "30|MOTR": true,
    "40|SRVK": true   // service kits stay out of the distributor catalogue
  };

  var MONTHS = 24;                 // full months, oldest first
  var LAST_MONTH = "202608";       // most recent closed period
  var BASE_MONTHLY = 98000;        // scale factor per org × channel × group

  /* mulberry32 — small seeded PRNG, so every reload produces the same figures */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Builds the list of CALMONTH periods, oldest first. */
  function periods() {
    var year = parseInt(LAST_MONTH.slice(0, 4), 10);
    var month = parseInt(LAST_MONTH.slice(4), 10);
    var out = [];
    for (var i = MONTHS - 1; i >= 0; i--) {
      var m = month - i;
      var y = year;
      while (m <= 0) { m += 12; y -= 1; }
      out.push(String(y) + String(m).padStart(2, "0"));
    }
    return out;
  }

  function build() {
    var rand = rng(20260918);
    var months = periods();
    var rows = [];

    months.forEach(function (period, t) {
      var age = t / 12; // years since the start of the window

      SALES_ORGS.forEach(function (org) {
        CHANNELS.forEach(function (ch) {
          MATERIAL_GROUPS.forEach(function (mg) {
            if (EXCLUDED[ch.id + "|" + mg.id]) return;

            var base = BASE_MONTHLY * org.weight * ch.weight * mg.weight;
            var trend = Math.pow(1 + org.growth, age) *
                        Math.pow(1 + ch.growth, age) *
                        Math.pow(1 + mg.growth, age);

            // seasonality: summer dip, quarter-end push
            var monthNo = parseInt(period.slice(4), 10);
            var seasonal = 1 + 0.10 * Math.sin((monthNo - 3) / 12 * 2 * Math.PI);
            if (monthNo % 3 === 0) seasonal += 0.08;

            var noise = 0.94 + rand() * 0.12;
            var revenue = base * trend * seasonal * noise;

            // A framework agreement booked in March 2026 lands in one slice.
            if (period === "202603" && org.id === "2000" && mg.id === "MOTR" && ch.id === "10") {
              revenue *= 2.2;
            }

            var margin = mg.margin + org.marginAdj + ch.marginAdj +
                         (org.marginDrift || 0) * age +
                         (rand() - 0.5) * 0.02;
            margin = Math.min(0.62, Math.max(0.08, margin));

            var returnsRate = mg.returns + (mg.returnsDrift || 0) * age;

            rows.push({
              period: period,
              salesOrg: org.id,
              channel: ch.id,
              materialGroup: mg.id,
              revenue: Math.round(revenue),
              cost: Math.round(revenue * (1 - margin)),
              quantity: Math.round(revenue / mg.asp),
              orders: Math.max(1, Math.round(revenue / (mg.asp * 14))),
              returns: Math.round(revenue * returnsRate),
              currency: "EUR"
            });
          });
        });
      });
    });

    return rows;
  }

  var dimension = function (list) {
    var map = {};
    list.forEach(function (d) { map[d.id] = d.name; });
    return { list: list.map(function (d) { return { id: d.id, name: d.name }; }), name: map };
  };

  global.DemoData = {
    rows: build,
    periods: periods,
    salesOrgs: dimension(SALES_ORGS),
    channels: dimension(CHANNELS),
    materialGroups: dimension(MATERIAL_GROUPS)
  };
})(window);
