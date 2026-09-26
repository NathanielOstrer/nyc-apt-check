import { describe, expect, it } from 'vitest'
import { CHECKS, runChecks, type CheckState } from '../../src/checks'
import { complaints311, crime, NYPD_COMPLAINTS_YTD, SERVICE_REQUESTS_311 } from '../../src/checks/neighborhood'
import { CATEGORIES, type Check } from '../../src/checks/types'
import { depsWith, PLACE, socrata } from './fakeFetch'

describe('complaints311', () => {
  it('sums every noise type and uses a 150 m circle over 12 months', async () => {
    const { deps, calls } = depsWith([
      {
        match: socrata(SERVICE_REQUESTS_311),
        body: [
          { complaint_type: 'Illegal Parking', n: '100' },
          { complaint_type: 'Noise - Residential', n: '40' },
          { complaint_type: 'Noise', n: '2' },
        ],
      },
    ])
    const r = await complaints311.run(PLACE, deps)
    expect(r.level).toBe('info')
    expect(r.summary).toBe(
      'People made 142 311 complaints within about 500 ft in the last 12 months. 42 complaints were about noise.',
    )
    const where = calls[0].searchParams.get('$where')!
    expect(where).toContain(`within_circle(location, ${PLACE.lat}, ${PLACE.lon}, 150)`)
    expect(where).toContain("created_date > '2025-09-26T00:00:00'")
  })

  it('handles no complaints', async () => {
    const { deps } = depsWith([{ match: socrata(SERVICE_REQUESTS_311), body: [] }])
    expect((await complaints311.run(PLACE, deps)).summary).toMatch(/^People made 0 311 complaints/)
  })
})

describe('crime', () => {
  it('counts felonies and lists top offenses with a caveat', async () => {
    const { deps } = depsWith([
      {
        match: (u) => socrata(NYPD_COMPLAINTS_YTD)(u) && u.searchParams.get('$group') === 'law_cat_cd',
        body: [
          { law_cat_cd: 'FELONY', n: '1' },
          { law_cat_cd: 'MISDEMEANOR', n: '4' },
        ],
      },
      { match: socrata(NYPD_COMPLAINTS_YTD), body: [{ ofns_desc: 'PETIT LARCENY', n: '3' }] },
    ])
    const r = await crime.run(PLACE, deps)
    expect(r.level).toBe('info')
    expect(r.summary).toBe('The NYPD recorded 5 crime complaints within about 800 ft so far this year. 1 was a felony.')
    expect(r.details[0]).toBe('petit larceny: 3.')
    expect(r.details.at(-1)).toMatch(/not a comparison/)
  })
})

describe('CHECKS registry', () => {
  it('has unique ids', () => {
    const ids = CHECKS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('puts every check in a known category with at least one https source', () => {
    for (const c of CHECKS) {
      expect(CATEGORIES).toContain(c.category)
      expect(c.sources.length).toBeGreaterThan(0)
      for (const s of c.sources) expect(s.url).toMatch(/^https:\/\//)
    }
  })
})

describe('runChecks', () => {
  const ok: Check = {
    id: 'ok',
    title: 'OK',
    category: 'Environment',
    sources: [],
    run: async () => ({ level: 'low', summary: 'fine', details: [] }),
  }
  const broken: Check = { ...ok, id: 'broken', run: async () => Promise.reject(new Error('boom')) }

  it('reports loading, then a result or an error for each check', async () => {
    const { deps } = depsWith([])
    const updates: [string, CheckState][] = []
    await runChecks(PLACE, deps, (id, s) => updates.push([id, s]), [ok, broken])
    expect(updates.filter(([, s]) => s.status === 'loading').map(([id]) => id).sort()).toEqual(['broken', 'ok'])
    expect(updates).toContainEqual(['ok', { status: 'done', result: { level: 'low', summary: 'fine', details: [] } }])
    expect(updates).toContainEqual(['broken', { status: 'error', message: 'boom' }])
  })

  it('does not let one failure stop the others', async () => {
    const { deps } = depsWith([])
    const done: string[] = []
    await runChecks(PLACE, deps, (id, s) => s.status === 'done' && done.push(id), [broken, ok])
    expect(done).toEqual(['ok'])
  })
})
