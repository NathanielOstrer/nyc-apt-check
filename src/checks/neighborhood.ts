import { monthsAgo, NYC_OPEN_DATA, soql, soqlDate } from '../lib/api'
import { num, plural } from './helpers'
import type { Check } from './types'

export const SERVICE_REQUESTS_311 = 'erm2-nwe9'
export const NYPD_COMPLAINTS_YTD = '5uac-w243'

/** About one block in every direction. */
const NEARBY_311_M = 150
const NEARBY_CRIME_M = 250

export const complaints311: Check = {
  id: '311',
  title: '311 complaints nearby',
  category: 'Neighborhood',
  sources: [{ name: 'NYC 311 Service Requests', url: 'https://data.cityofnewyork.us/d/erm2-nwe9' }],
  async run(place, deps) {
    const rows = await soql<{ complaint_type: string; n: string }>(deps, NYC_OPEN_DATA, SERVICE_REQUESTS_311, {
      $select: 'complaint_type,count(*) as n',
      $where: `within_circle(location, ${place.lat}, ${place.lon}, ${NEARBY_311_M}) AND created_date > ${soqlDate(monthsAgo(deps.now, 12))}`,
      $group: 'complaint_type',
      $order: 'n DESC',
      $limit: '50',
    })
    const noise = rows.filter((r) => /noise/i.test(r.complaint_type)).reduce((sum, r) => sum + num(r.n), 0)
    const total = rows.reduce((sum, r) => sum + num(r.n), 0)
    return {
      level: 'info',
      summary: `People made ${plural(total, '311 complaint')} within about 500 ft in the last 12 months. ${plural(noise, 'complaint was', 'complaints were')} about noise.`,
      details: rows.slice(0, 8).map((r) => `${r.complaint_type}: ${num(r.n).toLocaleString('en-US')}.`),
    }
  },
}

export const crime: Check = {
  id: 'crime',
  title: 'Reported crime nearby',
  category: 'Neighborhood',
  sources: [
    { name: 'NYPD Complaint Data, current year to date', url: 'https://data.cityofnewyork.us/d/5uac-w243' },
    { name: 'NYC Crime Map', url: 'https://maps.nyc.gov/crime/' },
  ],
  async run(place, deps) {
    const where = `within_circle(geocoded_column, ${place.lat}, ${place.lon}, ${NEARBY_CRIME_M})`
    const [byCategory, byOffense] = await Promise.all([
      soql<{ law_cat_cd: string; n: string }>(deps, NYC_OPEN_DATA, NYPD_COMPLAINTS_YTD, {
        $select: 'law_cat_cd,count(*) as n',
        $where: where,
        $group: 'law_cat_cd',
      }),
      soql<{ ofns_desc: string; n: string }>(deps, NYC_OPEN_DATA, NYPD_COMPLAINTS_YTD, {
        $select: 'ofns_desc,count(*) as n',
        $where: where,
        $group: 'ofns_desc',
        $order: 'n DESC',
        $limit: '6',
      }),
    ])
    const total = byCategory.reduce((sum, r) => sum + num(r.n), 0)
    const felonies = num(byCategory.find((r) => r.law_cat_cd === 'FELONY')?.n)
    return {
      level: 'info',
      summary: `The NYPD recorded ${plural(total, 'crime complaint')} within about 800 ft so far this year. ${plural(felonies, 'was a felony', 'were felonies')}.`,
      details: [
        ...byOffense.map((r) => `${r.ofns_desc.toLowerCase()}: ${num(r.n)}.`),
        'This data is a count of police reports. It does not show risk to one person, and it is not a comparison with other areas.',
      ],
    }
  },
}
