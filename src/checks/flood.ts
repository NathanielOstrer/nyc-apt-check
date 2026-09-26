import { arcgisPointQuery, NYC_OPEN_DATA, soql } from '../lib/api'
import { worst } from './helpers'
import type { Check, CheckResult, Deps, Level, Place } from './types'

export const FEMA_FLOOD_ZONES = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28'
export const SANDY_INUNDATION = '5xsi-dfpx'
export const EVACUATION_ZONES = 'epne-qv9x'

interface Part {
  level: Level
  line: string
}

async function femaZone(place: Place, deps: Deps): Promise<Part> {
  const features = await arcgisPointQuery<{ FLD_ZONE: string; ZONE_SUBTY: string | null; SFHA_TF: string }>(
    deps,
    FEMA_FLOOD_ZONES,
    place.lat,
    place.lon,
    { outFields: ['FLD_ZONE', 'ZONE_SUBTY', 'SFHA_TF'] },
  )
  const zone = features[0]?.attributes
  if (!zone) return { level: 'clear', line: 'FEMA has no flood zone mapped here.' }
  if (zone.SFHA_TF === 'T') {
    return {
      level: 'high',
      line: `FEMA flood zone ${zone.FLD_ZONE}: a high-risk area with a 1% chance of a flood each year. Ask about flood insurance and the basement.`,
    }
  }
  if (zone.ZONE_SUBTY?.includes('0.2 PCT')) {
    return { level: 'medium', line: 'FEMA shaded zone X: a moderate-risk area with a 0.2% chance of a flood each year.' }
  }
  return { level: 'low', line: `FEMA flood zone ${zone.FLD_ZONE}: minimal flood risk.` }
}

async function sandy(place: Place, deps: Deps): Promise<Part> {
  const rows = await soql(deps, NYC_OPEN_DATA, SANDY_INUNDATION, {
    $select: 'id',
    $where: `intersects(the_geom, 'POINT(${place.lon} ${place.lat})')`,
    $limit: '1',
  })
  return rows.length
    ? { level: 'medium', line: 'Hurricane Sandy flooded this area in 2012.' }
    : { level: 'clear', line: 'Hurricane Sandy did not flood this area in 2012.' }
}

async function evacuationZone(place: Place, deps: Deps): Promise<Part> {
  const rows = await soql<{ hurricane_: string }>(deps, NYC_OPEN_DATA, EVACUATION_ZONES, {
    $select: 'hurricane_',
    $where: `intersects(the_geom, 'POINT(${place.lon} ${place.lat})')`,
  })
  // Only 1 to 6 are evacuation zones. The dataset also has polygons coded X and 7.
  const zones = rows.map((r) => Number(r.hurricane_)).filter((z) => z >= 1 && z <= 6)
  if (zones.length === 0) return { level: 'clear', line: 'The address is not in a hurricane evacuation zone.' }
  const zone = Math.min(...zones)
  return {
    level: zone <= 2 ? 'medium' : 'low',
    line: `Hurricane evacuation zone ${zone}. Zone 1 is the first to leave, and zone 6 is the last.`,
  }
}

const PARTS: [string, (place: Place, deps: Deps) => Promise<Part>][] = [
  ['The FEMA flood map', femaZone],
  ['The Sandy flood map', sandy],
  ['The evacuation zone map', evacuationZone],
]

export const flood: Check = {
  id: 'flood',
  title: 'Flood risk',
  category: 'Flooding',
  sources: [
    { name: 'FEMA National Flood Hazard Layer', url: 'https://msc.fema.gov/portal/home' },
    { name: 'NYC Sandy Inundation Zone', url: 'https://data.cityofnewyork.us/d/5xsi-dfpx' },
    { name: 'NYC Hurricane Evacuation Zones', url: 'https://www.nyc.gov/site/em/ready/hurricane-evacuation.page' },
    { name: 'NYC Flood Hazard Mapper (future flood maps)', url: 'https://www.nyc.gov/site/planning/data-maps/flood-hazard-mapper.page' },
  ],
  async run(place, deps): Promise<CheckResult> {
    // One slow or broken map must not hide the other two.
    const settled = await Promise.allSettled(PARTS.map(([, fn]) => fn(place, deps)))
    const parts: Part[] = settled.map((s, i) =>
      s.status === 'fulfilled' ? s.value : { level: 'info', line: `${PARTS[i][0]} did not load.` },
    )
    if (settled.every((s) => s.status === 'rejected')) throw (settled[0] as PromiseRejectedResult).reason

    const level = worst(parts.map((p) => p.level))
    const summary =
      level === 'high'
        ? 'The address is in a high-risk flood zone.'
        : level === 'medium'
          ? 'The address has some flood risk.'
          : 'The flood maps show low risk for this address.'
    return { level, summary, details: parts.map((p) => p.line) }
  },
}
