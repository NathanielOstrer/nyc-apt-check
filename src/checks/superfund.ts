import { arcgisPointQuery } from '../lib/api'
import { distanceToPolygon, formatDistance, haversine, HALF_MILE_M, ONE_MILE_M } from '../lib/geo'
import { worst } from './helpers'
import type { Check, Level, MapFeature } from './types'

const EPA_ARCGIS = 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services'
export const SUPERFUND_BOUNDARIES = `${EPA_ARCGIS}/FAC_Superfund_Site_Boundaries_EPA_Public/FeatureServer/0`
export const SUPERFUND_POINTS = `${EPA_ARCGIS}/Superfund_National_Priorities_List_(NPL)_Sites_with_Status_Information/FeatureServer/0`

interface BoundaryAttrs {
  SITE_NAME: string
  EPA_ID: string
  NPL_STATUS_CODE: string
  URL_ALIAS_TXT: string | null
}

interface PointAttrs {
  Site_Name: string
  Site_EPA_ID: string
  Status: string
  Latitude: number
  Longitude: number
}

interface Site {
  name: string
  epaId: string
  status: string
  deleted: boolean
  distance: number
  url?: string
}

const STATUS_TEXT: Record<string, string> = {
  F: 'On the National Priorities List.',
  P: 'Proposed for the National Priorities List.',
  D: 'Deleted from the National Priorities List after cleanup.',
}

function levelFor(site: Site): Level {
  const level: Level = site.distance === 0 ? 'high' : site.distance <= HALF_MILE_M ? 'medium' : 'low'
  // A deleted site has finished cleanup. Report it, but do not rank it above low.
  return site.deleted ? 'low' : level
}

/** Title-case the EPA's all-caps names: "GOWANUS CANAL" becomes "Gowanus Canal". */
function tidyName(name: string): string {
  return name === name.toUpperCase() ? name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : name
}

export const superfund: Check = {
  id: 'superfund',
  title: 'Superfund sites',
  category: 'Environment',
  sources: [
    { name: 'EPA Superfund site boundaries', url: 'https://www.epa.gov/superfund/search-superfund-sites-where-you-live' },
  ],
  async run(place, deps) {
    // Boundaries give the real footprint. The status points catch listed sites that have no boundary yet.
    const [boundaries, points] = await Promise.all([
      arcgisPointQuery<BoundaryAttrs>(deps, SUPERFUND_BOUNDARIES, place.lat, place.lon, {
        outFields: ['SITE_NAME', 'EPA_ID', 'NPL_STATUS_CODE', 'URL_ALIAS_TXT'],
        distance: ONE_MILE_M,
        returnGeometry: true,
      }),
      arcgisPointQuery<PointAttrs>(deps, SUPERFUND_POINTS, place.lat, place.lon, {
        outFields: ['Site_Name', 'Site_EPA_ID', 'Status', 'Latitude', 'Longitude'],
        distance: ONE_MILE_M,
      }),
    ])

    const sites = new Map<string, Site>()
    const mapFeatures: MapFeature[] = []

    for (const f of boundaries) {
      const a = f.attributes
      const rings = f.geometry?.rings ?? []
      const distance = rings.length ? distanceToPolygon(place.lat, place.lon, rings) : Infinity
      const existing = sites.get(a.EPA_ID)
      // One site can have several features (operable units). Keep the nearest.
      if (!existing || distance < existing.distance) {
        sites.set(a.EPA_ID, {
          name: tidyName(a.SITE_NAME),
          epaId: a.EPA_ID,
          status: STATUS_TEXT[a.NPL_STATUS_CODE] ?? `EPA status code ${a.NPL_STATUS_CODE}.`,
          deleted: a.NPL_STATUS_CODE === 'D',
          distance,
          url: a.URL_ALIAS_TXT ?? undefined,
        })
      }
      if (rings.length) mapFeatures.push({ kind: 'polygon', rings, label: tidyName(a.SITE_NAME), level: 'high' })
    }

    for (const f of points) {
      const a = f.attributes
      if (sites.has(a.Site_EPA_ID)) continue
      sites.set(a.Site_EPA_ID, {
        name: a.Site_Name,
        epaId: a.Site_EPA_ID,
        status: `${a.Status}. The EPA has no boundary map for this site, so the distance is to its center point.`,
        deleted: /deleted/i.test(a.Status),
        distance: haversine(place.lat, place.lon, a.Latitude, a.Longitude),
      })
      mapFeatures.push({ kind: 'point', lat: a.Latitude, lon: a.Longitude, label: a.Site_Name, level: 'high' })
    }

    const ranked = [...sites.values()].filter((s) => s.distance <= ONE_MILE_M).sort((a, b) => a.distance - b.distance)
    if (ranked.length === 0) {
      return { level: 'clear', summary: 'There is no Superfund site within 1 mile.', details: [] }
    }

    const nearest = ranked[0]
    const summary =
      nearest.distance === 0
        ? `The address is inside the ${nearest.name} Superfund site.`
        : `The nearest Superfund site is ${nearest.name}, ${formatDistance(nearest.distance)} away.`

    return {
      level: worst(ranked.map(levelFor)),
      summary,
      details: ranked.map((s) => {
        const text = `${s.name}: ${s.distance === 0 ? 'the address is inside' : formatDistance(s.distance)}. ${s.status}`
        return s.url ? { text, url: s.url } : text
      }),
      mapFeatures,
    }
  },
}
