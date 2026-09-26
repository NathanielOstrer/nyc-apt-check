import type { Deps } from '../checks/types'

export const NYC_OPEN_DATA = 'https://data.cityofnewyork.us'
export const NYS_OPEN_DATA = 'https://data.ny.gov'

export class ApiError extends Error {}

async function getJson(deps: Deps, url: string): Promise<unknown> {
  const res = await deps.fetch(url)
  if (!res.ok) throw new ApiError(`${res.status} from ${new URL(url).host}`)
  return res.json()
}

/**
 * Query a Socrata dataset with SoQL, e.g. soql(deps, NYC_OPEN_DATA, 'wvxf-dwi5', { $where: "bbl='1'" }).
 * Values are passed through URLSearchParams, so quote string literals in $where yourself.
 */
export async function soql<T = Record<string, string>>(
  deps: Deps,
  domain: string,
  datasetId: string,
  params: Record<string, string>,
): Promise<T[]> {
  const url = `${domain}/resource/${datasetId}.json?${new URLSearchParams(params)}`
  const body = await getJson(deps, url)
  if (!Array.isArray(body)) throw new ApiError(`Unexpected response from ${datasetId}`)
  return body as T[]
}

/** Escape a value for a single-quoted SoQL string literal. */
export function soqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** A SoQL floating timestamp literal for the start of the given day, in UTC. */
export function soqlDate(date: Date): string {
  return `'${date.toISOString().slice(0, 10)}T00:00:00'`
}

export function monthsAgo(now: Date, months: number): Date {
  const d = new Date(now)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d
}

export interface EsriFeature<A> {
  attributes: A
  geometry?: { rings?: [number, number][][]; x?: number; y?: number }
}

/** Point query against an ArcGIS FeatureServer/MapServer layer. `distance` is in meters. */
export async function arcgisPointQuery<A>(
  deps: Deps,
  layerUrl: string,
  lat: number,
  lon: number,
  opts: { outFields: string[]; distance?: number; returnGeometry?: boolean },
): Promise<EsriFeature<A>[]> {
  const params = new URLSearchParams({
    f: 'json',
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: opts.outFields.join(','),
    returnGeometry: String(opts.returnGeometry ?? false),
  })
  if (opts.distance) {
    params.set('distance', String(opts.distance))
    params.set('units', 'esriSRUnit_Meter')
  }
  if (opts.returnGeometry) {
    // Simplify to about 10 m. Superfund boundaries can be several MB at full detail.
    params.set('maxAllowableOffset', '0.0001')
    params.set('geometryPrecision', '5')
  }
  const body = (await getJson(deps, `${layerUrl}/query?${params}`)) as {
    features?: EsriFeature<A>[]
    error?: { message?: string }
  }
  if (body.error) throw new ApiError(body.error.message ?? 'ArcGIS error')
  return body.features ?? []
}
