import type { Page, Route } from '@playwright/test'

export const LAT = 40.7
export const LON = -73.95

const PLACE_FEATURE = {
  geometry: { type: 'Point', coordinates: [LON, LAT] },
  properties: {
    label: '1 TEST AVENUE, Brooklyn, NY, USA',
    borough: 'Brooklyn',
    addendum: { pad: { bbl: '3000010001', bin: '3000001' } },
  },
}

const ring = (half: number) => [
  [LON - half, LAT - half],
  [LON + half, LAT - half],
  [LON + half, LAT + half],
  [LON - half, LAT + half],
  [LON - half, LAT - half],
]

/** Socrata responses by dataset id. A function gets the $where clause. */
const SOCRATA: Record<string, unknown[] | ((where: string, group: string | null) => unknown[])> = {
  'c6ci-rzpg': [
    {
      program_number: 'C1',
      program_type: 'BCP',
      program_facility_name: 'Test Brownfield',
      siteclass: 'A',
      latitude: String(LAT + 0.0003),
      longitude: String(LON),
    },
  ],
  'hxm3-23vy': [],
  '5xsi-dfpx': [{ id: '0' }],
  'epne-qv9x': [{ hurricane_: '2' }],
  '64uk-42ks': [{ yearbuilt: '1928', unitsres: '24', numfloors: '5', ownername: 'TEST OWNER LLC' }],
  'hcir-3275': [],
  'wvxf-dwi5': (where) => (where.includes('upper(') ? [{ n: '0' }] : [{ class: 'B', n: '2' }]),
  'ygpa-z7cr': [{ major_category: 'HEAT/HOT WATER', n: '3' }],
  'wz6d-d3jb': [],
  'p937-wjvj': [],
  '6z8x-wfk4': [{ n: '0' }],
  'erm2-nwe9': [{ complaint_type: 'Noise - Residential', n: '12' }],
  '5uac-w243': (_where, group) => (group === 'law_cat_cd' ? [{ law_cat_cd: 'FELONY', n: '2' }] : [{ ofns_desc: 'PETIT LARCENY', n: '2' }]),
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } })

export interface MockOptions {
  /** Dataset ids that answer with HTTP 500. */
  failing?: Set<string>
  /** Make GeoSearch find nothing. */
  noMatch?: boolean
}

/** Intercept every request that leaves localhost. Unknown hosts are aborted so nothing reaches the network. */
export async function mockApis(page: Page, opts: MockOptions = {}) {
  const failing = opts.failing ?? new Set<string>()
  await page.route(
    (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
    async (route) => {
      const url = new URL(route.request().url())

      if (url.hostname === 'geosearch.planninglabs.nyc') {
        return json(route, { features: opts.noMatch ? [] : [PLACE_FEATURE] })
      }

      const socrata = url.pathname.match(/\/resource\/([a-z0-9]{4}-[a-z0-9]{4})\.json$/)
      if (socrata) {
        const id = socrata[1]
        if (failing.has(id)) return json(route, { message: 'fail' }, 500)
        const body = SOCRATA[id]
        const where = url.searchParams.get('$where') ?? ''
        return json(route, typeof body === 'function' ? body(where, url.searchParams.get('$group')) : (body ?? []))
      }

      const path = decodeURIComponent(url.pathname)
      if (path.includes('FAC_Superfund_Site_Boundaries')) {
        if (failing.has('superfund')) return json(route, { error: { message: 'fail' } })
        return json(route, {
          features: [
            {
              attributes: { SITE_NAME: 'TEST CANAL', EPA_ID: 'NYTEST', NPL_STATUS_CODE: 'F', URL_ALIAS_TXT: 'https://epa.example/' },
              geometry: { rings: [ring(0.001)] },
            },
          ],
        })
      }
      if (path.includes('Superfund_National_Priorities_List')) return json(route, { features: [] })
      if (path.includes('/NFHL/')) {
        return json(route, { features: [{ attributes: { FLD_ZONE: 'AE', SFHA_TF: 'T', ZONE_SUBTY: null } }] })
      }

      // Map tiles and anything else.
      return route.abort()
    },
  )
}
