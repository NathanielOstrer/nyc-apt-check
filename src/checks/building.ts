import { monthsAgo, NYC_OPEN_DATA, soql, soqlDate, soqlString } from '../lib/api'
import { missingId, monthYear, num, plural } from './helpers'
import type { Check, Detail, Level } from './types'

export const PLUTO = '64uk-42ks'
export const HPD_VIOLATIONS = 'wvxf-dwi5'
export const HPD_COMPLAINTS = 'ygpa-z7cr'
export const AEP = 'hcir-3275'
export const BEDBUGS = 'wz6d-d3jb'
export const RODENTS = 'p937-wjvj'
export const EVICTIONS = '6z8x-wfk4'

const hpdOnline = (bbl: string) =>
  `https://hpdonline.nyc.gov/hpdonline/building/search-results?boroId=${bbl[0]}&block=${Number(bbl.slice(1, 6))}&lot=${Number(bbl.slice(6))}`

export const buildingInfo: Check = {
  id: 'building-info',
  title: 'About the building',
  category: 'Building',
  sources: [{ name: 'NYC PLUTO tax lot data', url: 'https://data.cityofnewyork.us/d/64uk-42ks' }],
  async run(place, deps) {
    const missing = missingId(place, 'bbl')
    if (missing) return missing

    const [lot] = await soql(deps, NYC_OPEN_DATA, PLUTO, {
      $select: 'yearbuilt,unitsres,numfloors,ownername,bldgclass',
      // PLUTO stores the BBL as a number.
      $where: `bbl=${Number(place.bbl)}`,
    })
    if (!lot) return { level: 'info', summary: 'The city has no tax lot data for this address.', details: [] }

    const year = num(lot.yearbuilt)
    const units = num(lot.unitsres)
    const details: string[] = []
    if (year) details.push(`Built in ${year}.`)
    details.push(`${plural(units, 'apartment')}${num(lot.numfloors) ? `, ${plural(num(lot.numfloors), 'floor')}` : ''}.`)
    if (lot.ownername) details.push(`The owner of record is ${lot.ownername.replace(/\.$/, '')}.`)
    if (year && year < 1960 && units > 0) {
      details.push('The building is older than 1960. Assume there is lead paint under newer paint. Ask for the lead paint disclosure form.')
    }
    if (year && year < 1974 && units >= 6) {
      details.push(
        'Some apartments here can be rent stabilized. Ask the state housing agency (HCR) for the rent history of the apartment.',
      )
    }
    return {
      level: 'info',
      summary: year ? `A ${year} building with ${plural(units, 'apartment')}.` : `A building with ${plural(units, 'apartment')}.`,
      details,
    }
  },
}

interface ClassCount {
  class: string
  n: string
}

export const hpdViolations: Check = {
  id: 'hpd-violations',
  title: 'Open housing code violations',
  category: 'Building',
  sources: [
    { name: 'HPD Housing Maintenance Code Violations', url: 'https://data.cityofnewyork.us/d/wvxf-dwi5' },
    { name: 'HPD Online', url: 'https://hpdonline.nyc.gov/' },
  ],
  async run(place, deps) {
    const missing = missingId(place, 'bbl')
    if (missing) return missing
    const openHere = `bbl=${soqlString(place.bbl!)} AND violationstatus='Open'`
    const desc = 'upper(novdescription)'

    const [byClass, [lead], [pests]] = await Promise.all([
      soql<ClassCount>(deps, NYC_OPEN_DATA, HPD_VIOLATIONS, {
        $select: 'class,count(*) as n',
        $where: openHere,
        $group: 'class',
      }),
      soql<{ n: string }>(deps, NYC_OPEN_DATA, HPD_VIOLATIONS, {
        $select: 'count(*) as n',
        $where: `${openHere} AND ${desc} like '%LEAD%PAINT%'`,
      }),
      soql<{ n: string }>(deps, NYC_OPEN_DATA, HPD_VIOLATIONS, {
        $select: 'count(*) as n',
        $where: `${openHere} AND (${desc} like '%MICE%' OR ${desc} like '%RATS%' OR ${desc} like '%ROACHES%' OR ${desc} like '%BED BUG%' OR ${desc} like '%BEDBUG%')`,
      }),
    ])

    const count = (cls: string) => num(byClass.find((r) => r.class === cls)?.n)
    const [a, b, c] = [count('A'), count('B'), count('C')]
    const total = byClass.reduce((sum, r) => sum + num(r.n), 0)
    const leadN = num(lead?.n)
    const pestN = num(pests?.n)

    let level: Level = 'clear'
    if (total > 0) level = 'low'
    if (c >= 1 || b >= 10 || leadN > 0) level = 'medium'
    if (c >= 10) level = 'high'

    const details: Detail[] = [
      `Class C (immediately hazardous): ${c}.`,
      `Class B (hazardous): ${b}.`,
      `Class A (not hazardous): ${a}.`,
    ]
    if (leadN) details.push(`${plural(leadN, 'open violation')} for lead paint.`)
    if (pestN) details.push(`${plural(pestN, 'open violation')} for mice, rats, roaches or bedbugs.`)
    details.push({ text: 'See each violation on HPD Online.', url: hpdOnline(place.bbl!) })

    return {
      level,
      summary:
        total === 0
          ? 'The building has no open HPD violations.'
          : c === 0
            ? `The building has ${plural(total, 'open HPD violation')}. None is class C, immediately hazardous.`
            : `The building has ${plural(total, 'open HPD violation')}. ${c} ${c === 1 ? 'is' : 'are'} class C, immediately hazardous.`,
      details,
    }
  },
}

export const aep: Check = {
  id: 'aep',
  title: 'Worst-building list (AEP)',
  category: 'Building',
  sources: [
    {
      name: 'HPD Alternative Enforcement Program',
      url: 'https://www.nyc.gov/site/hpd/services-and-information/alternative-enforcement-program-aep.page',
    },
  ],
  async run(place, deps) {
    const missing = missingId(place, 'bbl')
    if (missing) return missing
    const rows = await soql<{ aep_start_date: string; current_status: string; aep_round: string }>(
      deps,
      NYC_OPEN_DATA,
      AEP,
      {
        $select: 'aep_start_date,current_status,aep_round',
        $where: `bbl=${soqlString(place.bbl!)}`,
        $order: 'aep_start_date DESC',
      },
    )
    if (rows.length === 0) {
      return { level: 'clear', summary: 'HPD never put this building in the Alternative Enforcement Program.', details: [] }
    }
    const latest = rows[0]
    const since = monthYear(new Date(latest.aep_start_date))
    const active = /active/i.test(latest.current_status)
    return {
      level: active ? 'high' : 'low',
      summary: active
        ? `HPD put this building in the Alternative Enforcement Program in ${since}. The program is for the most distressed buildings in the city.`
        : `HPD put this building in the Alternative Enforcement Program in ${since}. It is not in the program now.`,
      details: rows.map((r) => `${r.aep_round}, ${monthYear(new Date(r.aep_start_date))}: ${r.current_status}.`),
    }
  },
}

export const hpdComplaints: Check = {
  id: 'hpd-complaints',
  title: 'Tenant complaints to HPD',
  category: 'Building',
  sources: [{ name: 'HPD Complaints and Problems', url: 'https://data.cityofnewyork.us/d/ygpa-z7cr' }],
  async run(place, deps) {
    const missing = missingId(place, 'bbl')
    if (missing) return missing
    const rows = await soql<{ major_category: string; n: string }>(deps, NYC_OPEN_DATA, HPD_COMPLAINTS, {
      // One complaint can list several problems, so count distinct complaints.
      $select: 'major_category,count(distinct complaint_id) as n',
      $where: `bbl=${soqlString(place.bbl!)} AND received_date > ${soqlDate(monthsAgo(deps.now, 12))}`,
      $group: 'major_category',
      $order: 'n DESC',
    })
    if (rows.length === 0) {
      return { level: 'clear', summary: 'Tenants made no complaints to HPD in the last 12 months.', details: [] }
    }
    const heat = num(rows.find((r) => r.major_category === 'HEAT/HOT WATER')?.n)
    return {
      level: heat >= 10 ? 'medium' : 'low',
      summary:
        heat > 0
          ? `Tenants made ${plural(heat, 'heat or hot water complaint')} to HPD in the last 12 months.`
          : 'Tenants made no heat or hot water complaints to HPD in the last 12 months.',
      details: rows.slice(0, 8).map((r) => `${r.major_category.toLowerCase()}: ${plural(num(r.n), 'complaint')}.`),
    }
  },
}

interface BedbugRow {
  filing_date: string
  of_dwelling_units: string
  infested_dwelling_unit_count: string
  eradicated_unit_count: string
  re_infested_dwelling_unit: string
}

export const bedbugs: Check = {
  id: 'bedbugs',
  title: 'Bedbug history',
  category: 'Building',
  sources: [{ name: 'HPD Bedbug Reporting', url: 'https://data.cityofnewyork.us/d/wz6d-d3jb' }],
  async run(place, deps) {
    const missing = missingId(place, 'bin')
    if (missing) return missing
    const rows = await soql<BedbugRow>(deps, NYC_OPEN_DATA, BEDBUGS, {
      $where: `bin=${soqlString(place.bin!)}`,
      $order: 'filing_date DESC',
      $limit: '3',
    })
    if (rows.length === 0) {
      return {
        level: 'info',
        summary: 'The owner did not file a bedbug report. Owners of buildings with 3 or more apartments must file one each year.',
        details: [],
      }
    }
    const latest = rows[0]
    const infested = num(latest.infested_dwelling_unit_count)
    const reinfested = num(latest.re_infested_dwelling_unit)
    const filed = monthYear(new Date(latest.filing_date))
    return {
      level: infested > 0 || reinfested > 0 ? 'medium' : 'clear',
      summary:
        infested > 0
          ? `The owner reported bedbugs in ${plural(infested, 'apartment')} in the report filed ${filed}.`
          : `The owner reported no bedbugs in the report filed ${filed}.`,
      details: rows.map(
        (r) =>
          `Filed ${monthYear(new Date(r.filing_date))}: ${num(r.infested_dwelling_unit_count)} infested, ${num(r.eradicated_unit_count)} eradicated, ${num(r.re_infested_dwelling_unit)} re-infested, of ${num(r.of_dwelling_units)} apartments.`,
      ),
    }
  },
}

export const rodents: Check = {
  id: 'rodents',
  title: 'Rat inspections',
  category: 'Building',
  sources: [
    { name: 'DOHMH Rodent Inspections', url: 'https://data.cityofnewyork.us/d/p937-wjvj' },
    { name: 'Rat Information Portal', url: 'https://www.nyc.gov/site/doh/health/health-topics/rats.page' },
  ],
  async run(place, deps) {
    const missing = missingId(place, 'bbl')
    if (missing) return missing
    const rows = await soql<{ result: string; n: string }>(deps, NYC_OPEN_DATA, RODENTS, {
      $select: 'result,count(*) as n',
      $where: `bbl=${soqlString(place.bbl!)} AND inspection_date > ${soqlDate(monthsAgo(deps.now, 24))}`,
      $group: 'result',
    })
    if (rows.length === 0) {
      return { level: 'clear', summary: 'The Health Department did no rat inspections here in the last 2 years.', details: [] }
    }
    const failed = rows.filter((r) => /rat activity/i.test(r.result)).reduce((sum, r) => sum + num(r.n), 0)
    return {
      level: failed >= 3 ? 'high' : failed > 0 ? 'medium' : 'low',
      summary:
        failed > 0
          ? `The lot failed ${plural(failed, 'inspection')} for rat activity in the last 2 years.`
          : 'The lot passed its rat inspections in the last 2 years.',
      details: rows.map((r) => `${r.result}: ${num(r.n)}.`),
    }
  },
}

export const evictions: Check = {
  id: 'evictions',
  title: 'Evictions',
  category: 'Building',
  sources: [{ name: 'NYC Marshal Evictions', url: 'https://data.cityofnewyork.us/d/6z8x-wfk4' }],
  async run(place, deps) {
    const missing = missingId(place, 'bbl')
    if (missing) return missing
    const since = monthsAgo(deps.now, 36)
    const [row] = await soql<{ n: string }>(deps, NYC_OPEN_DATA, EVICTIONS, {
      $select: 'count(*) as n',
      $where: `bbl=${soqlString(place.bbl!)} AND residential_commercial_ind='Residential' AND executed_date > ${soqlDate(since)}`,
    })
    const n = num(row?.n)
    return {
      level: n >= 3 ? 'medium' : n > 0 ? 'low' : 'clear',
      summary:
        n > 0
          ? `City marshals did ${plural(n, 'residential eviction')} here since ${monthYear(since)}.`
          : `City marshals did no residential evictions here since ${monthYear(since)}.`,
      details: [],
    }
  },
}
