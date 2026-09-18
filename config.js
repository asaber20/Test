/**
 * Runtime configuration.
 *
 * Flip `useMock` to false and fill in `sap` to read live figures from the SAP
 * backend instead of the generated demo dataset. Nothing else in the app needs
 * to change — `api.js` is the only file that talks to a data source.
 */
window.APP_CONFIG = {
  /** Demo data while the backend is not wired up yet. */
  useMock: true,

  /** Artificial latency for the mock source, so the loading path is real. */
  mockLatencyMs: 120,

  /** Currency the figures are reported in (SAP: WAERK / display currency). */
  currency: "EUR",
  locale: "en-US",

  sap: {
    /**
     * Base URL of the OData V4 service exposing the revenue CDS view, e.g.
     *   https://sap.example.com/sap/opu/odata4/sap/zsd_revenue/srvd/sap/zsd_revenue/0001
     * Leave empty to keep using demo data.
     */
    baseUrl: "",

    /** Entity set of the analytical CDS view (ZC_RevenueAnalysis or similar). */
    entitySet: "RevenueAnalysis",

    /**
     * Field names as they come back from the CDS view. Change the right-hand
     * side to match your view — the app only ever refers to the keys.
     */
    fields: {
      period: "CalendarYearMonth",   // CALMONTH, e.g. "202608"
      salesOrg: "SalesOrganization", // VKORG
      salesOrgText: "SalesOrganizationName",
      channel: "DistributionChannel", // VTWEG
      channelText: "DistributionChannelName",
      materialGroup: "MaterialGroup", // MATKL
      materialGroupText: "MaterialGroupName",
      revenue: "NetAmount",          // NETWR, net of credit memos
      cost: "CostAmount",            // cost of goods sold
      quantity: "BilledQuantity",    // MENGE
      orders: "BillingDocumentCount",
      returns: "ReturnsAmount",      // credit memo value
      currency: "TransactionCurrency" // WAERK
    },

    /** Extra headers, e.g. { "Authorization": "Bearer …" } or an API key. */
    headers: {},

    /** Sent as `credentials` on fetch — "include" for SAP cookie sessions. */
    credentials: "same-origin"
  }
};
