import { NYC_OPEN_DATA, soql, soqlString } from '../lib/api'
import { missingId } from './helpers'
import type { Check, Level } from './types'

export const E_DESIGNATIONS = 'hxm3-23vy'

interface Row {
  enumber: string
  hazmat_code: string
  air_code: string
  noise_code: string
  description?: string
}

export const eDesignation: Check = {
  id: 'e-designation',
  title: 'E-designation on the lot',
  category: 'Environment',
  sources: [
    { name: 'NYC Planning E-Designations', url: 'https://data.cityofnewyork.us/d/hxm3-23vy' },
    { name: 'NYC Office of Environmental Remediation', url: 'https://www.nyc.gov/site/oer/remediation/e-designation.page' },
  ],
  async run(place, deps) {
    const missing = missingId(place, 'bbl')
    if (missing) return missing

    const rows = await soql<Row>(deps, NYC_OPEN_DATA, E_DESIGNATIONS, {
      $select: 'enumber,hazmat_code,air_code,noise_code,description',
      $where: `bbl=${soqlString(place.bbl!)}`,
    })
    if (rows.length === 0) {
      return { level: 'clear', summary: 'The lot has no E-designation.', details: [] }
    }

    const hazmat = rows.some((r) => r.hazmat_code === 'True')
    const kinds = [
      hazmat && 'hazardous materials',
      rows.some((r) => r.air_code === 'True') && 'air quality',
      rows.some((r) => r.noise_code === 'True') && 'noise',
    ].filter(Boolean)
    const level: Level = hazmat ? 'medium' : 'low'
    const summary = hazmat
      ? 'The lot has a hazardous materials E-designation. The city found possible soil or groundwater contamination here. Redevelopment needs a cleanup plan.'
      : `The lot has an E-designation for ${kinds.join(' and ')}.`

    return {
      level,
      summary,
      details: rows.map((r) => `${r.enumber}${r.description ? `: ${r.description}` : ''}`),
    }
  },
}
