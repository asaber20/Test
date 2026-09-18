# Revenue Analysis dashboard

A revenue analysis dashboard with filters by **sales organisation**, **distribution
channel** and **material group**, and a panel that reads the selected slice and says
what changed in it.

Demo figures today; the data layer is written against an SAP OData service, so
going live is a config change, not a rewrite.

## Run it

No build step, no dependencies. Either:

```bash
open index.html              # macOS (xdg-open on Linux)
npx http-server . -p 8080    # or serve it: http://localhost:8080
```

## What's on the page

**Headline** — net revenue as the lead figure with its change against the
comparison period, then gross margin, billing documents, average order value and
returns rate, each with its own 12-month sparkline.

**What changed** — the intelligent part. The panel derives findings from the
selected slice and ranks them by how much of the revenue they touch:

| Finding | Fires when |
| --- | --- |
| Growth driver | the material group contributing most of the increase |
| Shrinking group | the largest decline against the comparison period |
| Margin squeeze | a sales org whose revenue rose while gross margin fell ≥ 1 pp |
| Channel shift | a channel whose share of revenue moved ≥ 1.5 pp |
| Concentration | the top three material groups exceed 55% of revenue |
| Returns | a material group whose credit-memo rate runs ≥ 1.8× the average |
| Anomaly | a month more than 2 standard deviations off the mean |

Each card carries the real numbers behind it, and most are clickable — selecting
one filters the whole dashboard to that slice. **Cards only appear when the data
supports them**; nothing is invented to fill the panel.

**Charts** — net revenue by month against the comparison period; revenue by
material group; channel mix with a share-shift companion. Every chart has a
`Chart | Table` toggle, hover and keyboard tooltips (focus the trend chart and use
← →), and the sales organisation table doubles as a drill-down.

## Connecting the SAP backend

Everything about the data source lives in `config.js` and `api.js`. Nothing else
in the app knows where the numbers come from.

1. Point `APP_CONFIG.sap.baseUrl` at the OData V4 service exposing your revenue
   CDS view, and set `useMock: false`.
2. Map `APP_CONFIG.sap.fields` to your view's element names — the defaults assume
   `CalendarYearMonth`, `SalesOrganization`, `DistributionChannel`,
   `MaterialGroup`, `NetAmount`, `CostAmount`, `BilledQuantity`,
   `BillingDocumentCount`, `ReturnsAmount`.
3. Add auth in `APP_CONFIG.sap.headers`, or set `credentials: "include"` for a
   cookie session.

The app issues one analytical query per period window:

```
GET {baseUrl}/{entitySet}?$apply=filter(
      CalendarYearMonth ge '202509' and CalendarYearMonth le '202608'
      and (SalesOrganization eq '1000' or SalesOrganization eq '2000'))
    /groupby((CalendarYearMonth,SalesOrganization,DistributionChannel,MaterialGroup),
      aggregate(NetAmount with sum as NetAmount, CostAmount with sum as CostAmount, …))
```

Filter selections become `$filter` terms, so the aggregation happens in SAP and the
browser only receives the grain it charts. `Api.buildUrl(query)` returns the URL
without sending it, which is the quickest way to check the call against your view.

The badge in the header reads **Demo data** or **SAP** so nobody mistakes generated
figures for booked revenue.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell: header, filter row, cards |
| `styles.css` | Design tokens, layout, light and dark themes |
| `config.js` | Data source switch, SAP endpoint and field mapping |
| `api.js` | The only file that fetches — mock source and SAP OData source |
| `data.js` | Seeded demo dataset in the same row shape as the SAP view |
| `analytics.js` | Aggregation, KPI maths and the insight engine |
| `charts.js` | SVG line, bar, stacked, diverging and sparkline renderers |
| `app.js` | Filter state, loading, rendering |

## Design notes

Charts are hand-drawn SVG rather than a charting library: no CDN dependency, and
the marks follow one spec — thin marks, hairline grid, a 2px surface gap between
touching fills, direct labels used sparingly, and colour that follows the entity
so filtering never repaints the survivors. The categorical palette was validated
for colour-blind separation and contrast in both themes; because two light-mode
hues sit under 3:1 against the surface, every chart ships visible labels and a
table view so colour is never the only channel.

## Notes on the demo data

`data.js` generates 24 months across 4 sales organisations, 4 distribution
channels and 8 material groups from a fixed seed, so the figures — and the
insights drawn from them — are identical on every reload. The dataset has
deliberate structure for the insight engine to find: sensors growing fast,
seals declining, APAC trading margin for growth, e-commerce taking share from
distributors, rising credit memos on seals, and one framework order inflating
March 2026.
