# NYC Apartment Check

Static site: enter an NYC address, see environmental, flood, building and neighborhood risks. React + Vite + TypeScript, Leaflet for the map. No backend. The browser calls every public API directly (all send `Access-Control-Allow-Origin`). README.md has the table of checks and datasets.

## Commands

```sh
npm run dev          # Vite dev server
npm run typecheck    # tsc -b
npm test             # Vitest unit tests (tests/unit), offline
npm run test:e2e     # Playwright: builds, serves under /nyc-apt-check/, mocks every external host
npm run test:live    # Vitest contract tests against the real APIs (tests/live), needs network
npm run build        # dist/
```

Run `typecheck`, `test` and `test:e2e` before you push. CI runs the same three. Run `test:live` when you add or change a query. A GitHub Action also runs it every Monday to catch dataset drift.

## Layout

- `src/checks/`: one `Check` per risk. A check is `{ id, title, category, sources, run(place, deps) }` and returns `{ level, summary, details, mapFeatures? }`. Register new checks in `src/checks/index.ts`.
- `src/lib/api.ts`: `soql()` for Socrata, `arcgisPointQuery()` for ArcGIS. `src/lib/geo.ts`: distances, point-to-polygon. `src/lib/geocode.ts`: GeoSearch.
- `src/components/`: `SearchBox` (autocomplete combobox), `ResultCard`, `RiskMap`.

## Conventions

- Checks take `Deps` (`fetch`, `now`) so tests never touch the network or the clock. Tests use `tests/unit/fakeFetch.ts`. An unmatched URL throws, on purpose.
- Test fixtures use synthetic addresses (`1 TEST AVENUE`). Do not put a real person's address in code, tests or docs. The live tests use two public, impersonal addresses: a Gowanus supermarket and an AEP building from HPD's public list.
- Levels: `high`, `medium`, `low` are judgments; `info` is context with no judgment; `clear` means the source has no record. The thresholds are this project's heuristics. Keep the UI line that says they are not official ratings.
- All interface copy follows ASD-STE100: no contractions, active voice, one idea per sentence, under 20 words. Use "high risk", "medium risk", "low risk" everywhere. Do not introduce synonyms.
- A check that throws shows "did not load" with a retry button on its own card. The flood check degrades per map with `Promise.allSettled`. Copy that pattern for any check that combines sources.
- `vite.config.ts` sets `base: './'` so the same build works at a domain root and under `/<repo>/`.

## Gotchas

- Put SoQL through `URLSearchParams` (the `soql()` helper does). Hand-built URLs with raw spaces return empty results with no error.
- Socrata returns an error object with HTTP 200 for bad column names, and ArcGIS returns `{ error }` with HTTP 200. Both helpers throw on these.
- PLUTO stores `bbl` as a number (`bbl=3009780016`). Every other dataset uses a string (`bbl='3009780016'`).
- The NYS DEC dataset has one row per site, operable unit and contaminant. Group by `program_number`.
- The EPA boundary polygons are simplified to about 10 m (`maxAllowableOffset`), so "inside" is approximate at the edge.
- The evacuation zone dataset has polygons coded `X` and `7`. Only 1 to 6 are zones.
- FEMA NFHL returns the effective 2007 FIRM. NYC uses the 2015 preliminary maps as best available, which are not in this check yet.
- CARTO basemaps now need an API key. The map uses tile.openstreetmap.org, which is fine for light use with attribution.
- The HPD Online link format (`search-results?boroId=&block=&lot=`) was checked in a browser on 2026-09-26.

## Next steps

1. Go live at `apt.nathaniel.nyc`. Blocked on two decisions by the owner, listed in the deploy notes below.
2. Add NYC's 2015 preliminary FEMA maps and the DEP stormwater flood maps (`9i7c-xyvv`) to the flood check. Stormwater flooding hits basement apartments far from the coast.
3. Add NYC OER cleanup sites (`3279-pp7v`). It has no point column, so filter `latitude::number` and `longitude::number` in a bounding box.
4. Add DOB violations, ECB violations, and the HPD registration contact (the real managing agent behind the LLC).
5. Tune the thresholds against a set of known-bad and known-good buildings. They are first guesses.
6. If the 311 query gets slower, cache results per address in `sessionStorage`.

### Deploy notes

`.github/workflows/deploy.yml` (test, build, deploy to Pages) and `live.yml` (weekly contract tests) are written but **not committed**. Two things block them:

- The local `gh` token has no `workflow` scope, and GitHub rejects any push that adds a workflow file. Run `gh auth refresh -h github.com -s workflow` in an interactive terminal. Then commit `.github/` and push.
- The account is on the free plan, and GitHub Pages is not available for private repos on that plan. The owner must pick one: make the repo public, pay for GitHub Pro, or publish `dist/` to a separate public repo.

After Pages is on, do these steps in order:

1. Run `gh api -X PUT repos/NathanielOstrer/nyc-apt-check/pages -f cname=apt.nathaniel.nyc`.
2. In Cloudflare DNS for nathaniel.nyc, add `CNAME apt -> nathanielostrer.github.io` as **DNS only** (grey cloud). If it is proxied, GitHub cannot issue the TLS certificate.
3. When the certificate is ready, run `gh api -X PUT repos/NathanielOstrer/nyc-apt-check/pages -F https_enforced=true`.

Until step 1 is done, Pages serves the site at `nathanielostrer.com/nyc-apt-check/`, because the user site repo carries a CNAME for nathanielostrer.com. The apex nathaniel.nyc is the personal site behind Cloudflare. Do not touch it.
