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
  SEMS_ID: number | null
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

// The EPA's own links for these sites redirect to a 403 page on www3.epa.gov (checked 2026-10-12).
const SITE_URL_OVERRIDES: Record<string, string> = {
  NYD980763841: 'https://www.epa.gov/hudsonriverpcbs', // Hudson River PCBs
}

/**
 * The EPA stores site links without a scheme ("www.epa.gov/superfund/newtown-creek").
 * A bare link like that is relative in an href, so it opens a path on this site.
 */
export function epaSiteUrl(epaId: string, link: string | null | undefined): string | undefined {
  if (SITE_URL_OVERRIDES[epaId]) return SITE_URL_OVERRIDES[epaId]
  const trimmed = link?.trim()
  if (!trimmed) return undefined
  return /^https?:\/\//i.test(trimmed) ? trimmed.replace(/^http:/i, 'https:') : `https://${trimmed}`
}

/** The site profile page for a SEMS id. The id is a number in the data and seven digits in the URL. */
function profileUrl(semsId: number | null): string | undefined {
  return semsId ? `https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=${String(semsId).padStart(7, '0')}` : undefined
}

// Words that stay as written when an all-caps name is title-cased. Taken from the NY and NJ site
// names in the boundary layer (checked 2026-10-18), plus common abbreviations and roman numerals.
const KEEP_CASE: Record<string, string> = Object.fromEntries(
  [
    'BEC', 'CPS', 'DEC', 'DOD', 'DOE', 'DOT', 'EPA', 'FAA', 'FMC', 'GCL', 'GE', 'GEMS', 'GW', 'JIS', 'LCP', 'LF',
    'LLC', 'MGP', 'NJ', 'NL', 'NY', 'NYC', 'PCB', 'PCE', 'PFAS', 'PFOA', 'PJP', 'SMS', 'TCE', 'US', 'USA',
    'USARMY', 'USDOE', 'USDOT', 'USN', 'VOC', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII',
  ].map((w) => [w, w]),
)
KEEP_CASE.PCBS = 'PCBs'
KEEP_CASE.VOCS = 'VOCs'

// Short words that are lowercase inside a name ("King of Prussia"). "A" is left out: "Site A" is a label.
const SMALL_WORDS = new Set(['AN', 'AND', 'AT', 'BY', 'FOR', 'IN', 'OF', 'ON', 'OR', 'THE', 'TO'])

const capitalize = (w: string) => w[0] + w.slice(1).toLowerCase()

/**
 * Title-case the EPA's all-caps names: "GOWANUS CANAL" becomes "Gowanus Canal" and
 * "HUDSON RIVER PCBS" becomes "Hudson River PCBs". Mixed-case names pass through unchanged.
 */
export function tidyName(name: string): string {
  if (name !== name.toUpperCase()) return name
  let first = true
  return name.replace(/[A-Z0-9]+(?:'[A-Z]+)?/g, (word, index: number) => {
    const isFirst = first
    first = false
    if (KEEP_CASE[word]) return KEEP_CASE[word]
    if (/^\d/.test(word)) return word.toLowerCase() // 102ND -> 102nd
    // A small word followed by a period is an initial, not a word.
    if (!isFirst && SMALL_WORDS.has(word) && name[index + word.length] !== '.') return word.toLowerCase()
    if (/^MC[A-Z]{2}/.test(word)) return `Mc${capitalize(word.slice(2))}` // MCGUIRE -> McGuire
    const prefixed = /^([A-Z])'([A-Z]+)$/.exec(word) // D'IMPERIO -> D'Imperio
    if (prefixed) return `${prefixed[1]}'${capitalize(prefixed[2])}`
    return capitalize(word) // EMMELL'S -> Emmell's
  })
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
        outFields: ['Site_Name', 'Site_EPA_ID', 'Status', 'Latitude', 'Longitude', 'SEMS_ID'],
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
          url: epaSiteUrl(a.EPA_ID, a.URL_ALIAS_TXT),
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
        url: SITE_URL_OVERRIDES[a.Site_EPA_ID] ?? profileUrl(a.SEMS_ID),
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
