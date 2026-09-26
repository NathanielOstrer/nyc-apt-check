import { NYS_OPEN_DATA, soql } from '../lib/api'
import { formatDistance, haversine, QUARTER_MILE_M } from '../lib/geo'
import { plural, worst } from './helpers'
import type { Check, Level } from './types'

export const DEC_REMEDIATION = 'c6ci-rzpg'

/** Within this distance a site is "on or next to" the lot. */
const ADJACENT_M = 60

/** NYS DEC site classes. 1 and 2 are the State Superfund's "significant threat" classes. */
const CLASS_TEXT: Record<string, string> = {
  '1': 'Class 1: a significant threat that needs action now.',
  '2': 'Class 2: a significant threat to health or the environment.',
  '3': 'Class 3: not a significant threat.',
  '4': 'Class 4: closed, but it needs continued site management.',
  '5': 'Class 5: no further action is necessary.',
  A: 'Cleanup is in progress.',
  C: 'Cleanup is complete.',
  N: 'No further action at this time.',
  P: 'Potential site. The state is investigating it.',
}

const PROGRAM_TEXT: Record<string, string> = {
  HW: 'State Superfund',
  BCP: 'Brownfield Cleanup Program',
  ERP: 'Environmental Restoration Program',
  VCP: 'Voluntary Cleanup Program',
  RCRA: 'Hazardous waste facility',
}

const OPEN_CLASSES = new Set(['A', 'P', '4'])

interface Row {
  program_number: string
  program_type: string
  program_facility_name: string
  siteclass: string
  latitude: string
  longitude: string
}

function levelFor(siteclass: string, distance: number): Level {
  if (siteclass === '1' || siteclass === '2') return 'high'
  if (OPEN_CLASSES.has(siteclass)) return distance <= ADJACENT_M ? 'medium' : 'low'
  return 'low'
}

export const stateCleanup: Check = {
  id: 'state-cleanup',
  title: 'State cleanup sites',
  category: 'Environment',
  sources: [
    { name: 'NYS DEC Environmental Remediation Sites', url: 'https://data.ny.gov/d/c6ci-rzpg' },
  ],
  async run(place, deps) {
    // The dataset has one row per site, operable unit and contaminant. Group to get one row per site.
    const fields = 'program_number,program_type,program_facility_name,siteclass,latitude,longitude'
    const rows = await soql<Row>(deps, NYS_OPEN_DATA, DEC_REMEDIATION, {
      $select: fields,
      $where: `within_circle(georeference, ${place.lat}, ${place.lon}, ${QUARTER_MILE_M})`,
      $group: fields,
      $limit: '500',
    })

    const sites = rows
      .map((r) => {
        const lat = Number(r.latitude)
        const lon = Number(r.longitude)
        const distance = haversine(place.lat, place.lon, lat, lon)
        return { ...r, lat, lon, distance, level: levelFor(r.siteclass, distance) }
      })
      .sort((a, b) => a.distance - b.distance)

    if (sites.length === 0) {
      return { level: 'clear', summary: 'There is no state cleanup site within a quarter mile.', details: [] }
    }

    const serious = sites.filter((s) => s.level === 'high').length
    const open = sites.filter((s) => OPEN_CLASSES.has(s.siteclass)).length
    const parts = [`There ${sites.length === 1 ? 'is' : 'are'} ${plural(sites.length, 'state cleanup site')} within a quarter mile.`]
    if (serious) parts.push(`${plural(serious, 'site is', 'sites are')} a significant threat.`)
    else if (open) parts.push(`${plural(open, 'site is', 'sites are')} not closed.`)
    const nearest = sites[0]
    if (nearest.distance <= ADJACENT_M) parts.push(`${nearest.program_facility_name} is on or next to this lot.`)

    return {
      level: worst(sites.map((s) => s.level)),
      summary: parts.join(' '),
      details: sites.slice(0, 15).map((s) => {
        const program = PROGRAM_TEXT[s.program_type] ?? s.program_type
        const status = CLASS_TEXT[s.siteclass] ?? `Class ${s.siteclass}.`
        return {
          text: `${s.program_facility_name} (${program}): ${formatDistance(s.distance)}. ${status}`,
          url: `https://extapps.dec.ny.gov/cfmx/extapps/derexternal/haz/details.cfm?pageid=3&progno=${encodeURIComponent(s.program_number)}`,
        }
      }),
      mapFeatures: sites.map((s) => ({
        kind: 'point' as const,
        lat: s.lat,
        lon: s.lon,
        label: `${s.program_facility_name}: ${CLASS_TEXT[s.siteclass] ?? s.siteclass}`,
        level: s.level,
      })),
    }
  },
}
