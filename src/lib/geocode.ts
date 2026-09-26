import type { Place } from '../checks/types'

/** NYC Planning Labs GeoSearch: a Pelias instance over the city's PAD address file. No key needed. */
export const GEOSEARCH = 'https://geosearch.planninglabs.nyc/v2'

interface GeoSearchFeature {
  geometry: { coordinates: [number, number] }
  properties: {
    label: string
    borough?: string
    addendum?: { pad?: { bbl?: string; bin?: string } }
  }
}

export function featureToPlace(f: GeoSearchFeature): Place {
  const [lon, lat] = f.geometry.coordinates
  const pad = f.properties.addendum?.pad
  return {
    // "214 3 STREET, Brooklyn, NY, USA" reads better without the trailing ", USA".
    label: f.properties.label.replace(/, USA$/, ''),
    lat,
    lon,
    bbl: pad?.bbl || undefined,
    bin: pad?.bin || undefined,
    borough: f.properties.borough,
  }
}

async function query(endpoint: 'search' | 'autocomplete', text: string, size: number, fetchFn: typeof fetch) {
  const url = `${GEOSEARCH}/${endpoint}?${new URLSearchParams({ text, size: String(size) })}`
  const res = await fetchFn(url)
  if (!res.ok) throw new Error(`Address search failed (${res.status})`)
  const body = (await res.json()) as { features?: GeoSearchFeature[] }
  return (body.features ?? []).map(featureToPlace)
}

export function autocomplete(text: string, fetchFn: typeof fetch = fetch): Promise<Place[]> {
  return query('autocomplete', text, 6, fetchFn)
}

export async function geocode(text: string, fetchFn: typeof fetch = fetch): Promise<Place | undefined> {
  return (await query('search', text, 1, fetchFn))[0]
}
