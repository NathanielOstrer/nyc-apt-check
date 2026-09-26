# NYC Apartment Check

Type in a New York City address and get the things worth knowing before you sign a lease there: Superfund and state cleanup sites nearby, flood zones, open housing code violations, rat inspections, bedbug reports, evictions, and what the neighbors call 311 about.

**Experimental.** The risk levels are rough heuristics this project sets, not official ratings, and the underlying data can be stale. Check anything that matters at its source.

## How it works

It's a static site with no backend. The browser geocodes the address with [NYC Planning GeoSearch](https://geosearch.planninglabs.nyc/), which returns coordinates plus the tax lot (BBL) and building (BIN) ids, then queries each public data source directly. All of them allow cross-origin requests.

| Check | Source | Looks up by |
| --- | --- | --- |
| Superfund sites | EPA NPL site boundaries and status points (ArcGIS) | 1 mile around the point |
| State cleanup sites | NYS DEC Environmental Remediation Sites (`c6ci-rzpg`) | Quarter mile around the point |
| E-designation | NYC Planning E-Designations (`hxm3-23vy`) | BBL |
| Flood risk | FEMA NFHL, Sandy Inundation Zone (`5xsi-dfpx`), Hurricane Evacuation Zones (`epne-qv9x`) | Point |
| About the building | PLUTO (`64uk-42ks`) | BBL |
| AEP (worst-building list) | HPD AEP (`hcir-3275`) | BBL |
| Open violations | HPD violations (`wvxf-dwi5`) | BBL |
| Tenant complaints | HPD complaints (`ygpa-z7cr`), last 12 months | BBL |
| Bedbugs | HPD bedbug reports (`wz6d-d3jb`) | BIN |
| Rats | DOHMH rodent inspections (`p937-wjvj`), last 2 years | BBL |
| Evictions | Marshal evictions (`6z8x-wfk4`), last 3 years | BBL |
| 311 nearby | 311 requests (`erm2-nwe9`), last 12 months | 150 m around the point |
| Crime nearby | NYPD complaints, year to date (`5uac-w243`) | 250 m around the point |

## Development

```sh
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests, offline
npm run test:e2e     # Playwright against the production build, all APIs mocked
npm run test:live    # contract tests against the real APIs (needs network, ~30 s)
```
