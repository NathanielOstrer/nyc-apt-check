import type { Deps } from '../../src/checks/types'

export type Matcher = (url: URL) => boolean

interface Route {
  match: Matcher
  body?: unknown
  status?: number
}

/**
 * A fetch stand-in that answers from a route table and records every URL.
 * An unmatched URL throws, so a test fails loudly if a check calls an unexpected source.
 */
export function fakeFetch(routes: Route[]) {
  const calls: URL[] = []
  const fn = async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    calls.push(url)
    const route = routes.find((r) => r.match(url))
    if (!route) throw new Error(`No fake route for ${url}`)
    return new Response(JSON.stringify(route.body ?? []), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetch: fn as typeof fetch, calls }
}

export function depsWith(routes: Route[], now = new Date('2026-09-26T12:00:00Z')) {
  const f = fakeFetch(routes)
  const deps: Deps = { fetch: f.fetch, now }
  return { deps, calls: f.calls }
}

/** Matches a Socrata dataset, optionally only when $where contains `whereIncludes`. */
export const socrata =
  (datasetId: string, whereIncludes?: string): Matcher =>
  (url) =>
    url.pathname.endsWith(`/resource/${datasetId}.json`) &&
    (!whereIncludes || (url.searchParams.get('$where') ?? '').includes(whereIncludes))

/** Matches an ArcGIS layer query by its layer URL. */
export const arcgis =
  (layerUrl: string): Matcher =>
  (url) =>
    decodeURIComponent(url.href).startsWith(`${layerUrl}/query`)

export const PLACE = {
  label: '1 TEST AVENUE, Brooklyn, NY',
  lat: 40.7,
  lon: -73.95,
  bbl: '3000010001',
  bin: '3000001',
}

/** A square polygon ring [lon, lat] centered on (lat, lon) with a half-side in degrees. */
export function square(lat: number, lon: number, half: number): [number, number][] {
  return [
    [lon - half, lat - half],
    [lon + half, lat - half],
    [lon + half, lat + half],
    [lon - half, lat + half],
    [lon - half, lat - half],
  ]
}
