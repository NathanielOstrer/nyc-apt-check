import { describe, expect, it } from 'vitest'
import {
  AEP,
  aep,
  BEDBUGS,
  bedbugs,
  buildingInfo,
  EVICTIONS,
  evictions,
  HPD_COMPLAINTS,
  HPD_VIOLATIONS,
  hpdComplaints,
  hpdViolations,
  PLUTO,
  RODENTS,
  rodents,
} from '../../src/checks/building'
import { depsWith, PLACE, socrata } from './fakeFetch'

describe('building checks without a BBL or BIN', () => {
  it.each([buildingInfo, hpdViolations, aep, hpdComplaints, rodents, evictions])('$id does not query', async (check) => {
    const { deps, calls } = depsWith([])
    const r = await check.run({ ...PLACE, bbl: undefined }, deps)
    expect(r.level).toBe('info')
    expect(calls).toHaveLength(0)
  })

  it('bedbugs needs a BIN', async () => {
    const { deps, calls } = depsWith([])
    expect((await bedbugs.run({ ...PLACE, bin: undefined }, deps)).level).toBe('info')
    expect(calls).toHaveLength(0)
  })
})

describe('buildingInfo', () => {
  const lot = (yearbuilt: string, unitsres: string, extra = {}) =>
    depsWith([
      { match: socrata(PLUTO), body: [{ yearbuilt, unitsres, numfloors: '6.0000', ownername: 'TEST OWNER LLC.', ...extra }] },
    ])

  it('queries PLUTO by numeric BBL', async () => {
    const { deps, calls } = lot('2000', '10')
    await buildingInfo.run(PLACE, deps)
    expect(calls[0].searchParams.get('$where')).toBe('bbl=3000010001')
  })

  it('describes an old rent-stabilization-age building with lead paint warning', async () => {
    const { deps } = lot('1928', '60')
    const r = await buildingInfo.run(PLACE, deps)
    expect(r.level).toBe('info')
    expect(r.summary).toBe('A 1928 building with 60 apartments.')
    expect(r.details).toContain('60 apartments, 6 floors.')
    expect(r.details).toContain('The owner of record is TEST OWNER LLC.')
    expect(r.details.join(' ')).toMatch(/lead paint/)
    expect(r.details.join(' ')).toMatch(/rent stabilized/)
  })

  it('omits the lead and rent notes for a new small building', async () => {
    const { deps } = lot('2015', '3')
    const text = (await buildingInfo.run(PLACE, deps)).details.join(' ')
    expect(text).not.toMatch(/lead paint/)
    expect(text).not.toMatch(/rent stabilized/)
  })

  it('omits the rent note for a pre-1974 building with 5 apartments', async () => {
    const { deps } = lot('1950', '5')
    const text = (await buildingInfo.run(PLACE, deps)).details.join(' ')
    expect(text).toMatch(/lead paint/)
    expect(text).not.toMatch(/rent stabilized/)
  })

  it('handles a lot with no year built', async () => {
    const { deps } = lot('0', '1', { numfloors: '1' })
    const r = await buildingInfo.run(PLACE, deps)
    expect(r.summary).toBe('A building with 1 apartment.')
    expect(r.details).toContain('1 apartment, 1 floor.')
  })

  it('handles a BBL that is not in PLUTO', async () => {
    const { deps } = depsWith([{ match: socrata(PLUTO), body: [] }])
    expect((await buildingInfo.run(PLACE, deps)).summary).toMatch(/no tax lot data/)
  })
})

describe('hpdViolations', () => {
  function violations(byClass: Record<string, number>, lead = 0, pests = 0) {
    return depsWith([
      { match: socrata(HPD_VIOLATIONS, 'LEAD'), body: [{ n: String(lead) }] },
      { match: socrata(HPD_VIOLATIONS, 'MICE'), body: [{ n: String(pests) }] },
      {
        match: socrata(HPD_VIOLATIONS),
        body: Object.entries(byClass).map(([cls, n]) => ({ class: cls, n: String(n) })),
      },
    ])
  }

  it('only counts open violations on this lot', async () => {
    const { deps, calls } = violations({})
    await hpdViolations.run(PLACE, deps)
    for (const call of calls) expect(call.searchParams.get('$where')).toMatch(/^bbl='3000010001' AND violationstatus='Open'/)
  })

  it('is clear with no open violations', async () => {
    const { deps } = violations({})
    const r = await hpdViolations.run(PLACE, deps)
    expect(r.level).toBe('clear')
    expect(r.summary).toBe('The building has no open HPD violations.')
  })

  it('is low with only a few class A and B', async () => {
    const { deps } = violations({ A: 4, B: 3 })
    const r = await hpdViolations.run(PLACE, deps)
    expect(r.level).toBe('low')
    expect(r.summary).toBe('The building has 7 open HPD violations. None is class C, immediately hazardous.')
  })

  it('is medium with one class C', async () => {
    const { deps } = violations({ C: 1 })
    const r = await hpdViolations.run(PLACE, deps)
    expect(r.level).toBe('medium')
    expect(r.summary).toBe('The building has 1 open HPD violation. 1 is class C, immediately hazardous.')
  })

  it('is medium with 10 class B', async () => {
    const { deps } = violations({ B: 10 })
    expect((await hpdViolations.run(PLACE, deps)).level).toBe('medium')
  })

  it('is medium with any open lead paint violation', async () => {
    const { deps } = violations({ A: 1 }, 1)
    const r = await hpdViolations.run(PLACE, deps)
    expect(r.level).toBe('medium')
    expect(r.details).toContain('1 open violation for lead paint.')
  })

  it('is high with 10 class C', async () => {
    const { deps } = violations({ C: 10, B: 2 }, 0, 3)
    const r = await hpdViolations.run(PLACE, deps)
    expect(r.level).toBe('high')
    expect(r.details).toContain('3 open violations for mice, rats, roaches or bedbugs.')
  })

  it('links to the lot on HPD Online', async () => {
    const { deps } = violations({})
    const r = await hpdViolations.run(PLACE, deps)
    expect(r.details.at(-1)).toMatchObject({ url: expect.stringContaining('boroId=3&block=1&lot=1') })
  })
})

describe('aep', () => {
  const rows = (current_status: string) =>
    depsWith([
      {
        match: socrata(AEP),
        body: [{ aep_start_date: '2024-01-31T00:00:00.000', current_status, aep_round: 'Aep Round 17' }],
      },
    ])

  it('is high while the building is active in AEP', async () => {
    const { deps } = rows('AEP Active')
    const r = await aep.run(PLACE, deps)
    expect(r.level).toBe('high')
    expect(r.summary).toMatch(/in Jan 2024/)
  })

  it('is low after discharge', async () => {
    const { deps } = rows('AEP Discharged')
    const r = await aep.run(PLACE, deps)
    expect(r.level).toBe('low')
    expect(r.summary).toMatch(/not in the program now/)
  })

  it('is clear when never listed', async () => {
    const { deps } = depsWith([{ match: socrata(AEP), body: [] }])
    expect((await aep.run(PLACE, deps)).level).toBe('clear')
  })
})

describe('hpdComplaints', () => {
  it('limits to the last 12 months from deps.now', async () => {
    const { deps, calls } = depsWith([{ match: socrata(HPD_COMPLAINTS), body: [] }])
    const r = await hpdComplaints.run(PLACE, deps)
    expect(r.level).toBe('clear')
    expect(calls[0].searchParams.get('$where')).toContain("received_date > '2025-09-26T00:00:00'")
  })

  it('is medium with 10 heat complaints', async () => {
    const { deps } = depsWith([
      {
        match: socrata(HPD_COMPLAINTS),
        body: [
          { major_category: 'HEAT/HOT WATER', n: '10' },
          { major_category: 'PLUMBING', n: '2' },
        ],
      },
    ])
    const r = await hpdComplaints.run(PLACE, deps)
    expect(r.level).toBe('medium')
    expect(r.summary).toBe('Tenants made 10 heat or hot water complaints to HPD in the last 12 months.')
    expect(r.details).toContain('plumbing: 2 complaints.')
  })

  it('is low with other complaints only', async () => {
    const { deps } = depsWith([{ match: socrata(HPD_COMPLAINTS), body: [{ major_category: 'PLUMBING', n: '1' }] }])
    const r = await hpdComplaints.run(PLACE, deps)
    expect(r.level).toBe('low')
    expect(r.summary).toMatch(/no heat or hot water complaints/)
  })
})

describe('bedbugs', () => {
  const report = (infested: string, reinfested = '0') => ({
    filing_date: '2025-12-01T00:00:00.000',
    of_dwelling_units: '20',
    infested_dwelling_unit_count: infested,
    eradicated_unit_count: '0',
    re_infested_dwelling_unit: reinfested,
  })

  it('queries by BIN, newest first', async () => {
    const { deps, calls } = depsWith([{ match: socrata(BEDBUGS), body: [] }])
    await bedbugs.run(PLACE, deps)
    expect(calls[0].searchParams.get('$where')).toBe("bin='3000001'")
    expect(calls[0].searchParams.get('$order')).toBe('filing_date DESC')
  })

  it('is medium when the latest report has infested units', async () => {
    const { deps } = depsWith([{ match: socrata(BEDBUGS), body: [report('2')] }])
    const r = await bedbugs.run(PLACE, deps)
    expect(r.level).toBe('medium')
    expect(r.summary).toBe('The owner reported bedbugs in 2 apartments in the report filed Dec 2025.')
  })

  it('is medium for re-infested units alone', async () => {
    const { deps } = depsWith([{ match: socrata(BEDBUGS), body: [report('0', '1')] }])
    expect((await bedbugs.run(PLACE, deps)).level).toBe('medium')
  })

  it('is clear for a clean report', async () => {
    const { deps } = depsWith([{ match: socrata(BEDBUGS), body: [report('0')] }])
    expect((await bedbugs.run(PLACE, deps)).level).toBe('clear')
  })

  it('is info when no report was filed', async () => {
    const { deps } = depsWith([{ match: socrata(BEDBUGS), body: [] }])
    expect((await bedbugs.run(PLACE, deps)).summary).toMatch(/did not file a bedbug report/)
  })
})

describe('rodents', () => {
  const results = (rows: [string, number][]) =>
    depsWith([{ match: socrata(RODENTS), body: rows.map(([result, n]) => ({ result, n: String(n) })) }])

  it('is high with 3 failures for rat activity', async () => {
    const { deps } = results([
      ['Failed for Rat Activity', 1],
      ['Failed for Rat Activity and Other Reason', 2],
      ['Passed', 4],
    ])
    const r = await rodents.run(PLACE, deps)
    expect(r.level).toBe('high')
    expect(r.summary).toBe('The lot failed 3 inspections for rat activity in the last 2 years.')
  })

  it('is medium with one failure', async () => {
    const { deps } = results([['Failed for Rat Activity', 1]])
    expect((await rodents.run(PLACE, deps)).level).toBe('medium')
  })

  it('does not count failures for other reasons', async () => {
    const { deps } = results([
      ['Failed for Other Reason', 5],
      ['Passed', 1],
    ])
    const r = await rodents.run(PLACE, deps)
    expect(r.level).toBe('low')
    expect(r.summary).toMatch(/passed/)
  })

  it('is clear with no inspections and looks back 2 years', async () => {
    const { deps, calls } = results([])
    expect((await rodents.run(PLACE, deps)).level).toBe('clear')
    expect(calls[0].searchParams.get('$where')).toContain("inspection_date > '2024-09-26T00:00:00'")
  })
})

describe('evictions', () => {
  const count = (n: number) => depsWith([{ match: socrata(EVICTIONS), body: [{ n: String(n) }] }])

  it('counts residential evictions in the last 3 years', async () => {
    const { deps, calls } = count(0)
    const r = await evictions.run(PLACE, deps)
    expect(r.level).toBe('clear')
    expect(r.summary).toBe('City marshals did no residential evictions here since Sep 2023.')
    const where = calls[0].searchParams.get('$where')
    expect(where).toContain("residential_commercial_ind='Residential'")
    expect(where).toContain("executed_date > '2023-09-26T00:00:00'")
  })

  it('is low with 1 or 2', async () => {
    const { deps } = count(1)
    const r = await evictions.run(PLACE, deps)
    expect(r.level).toBe('low')
    expect(r.summary).toBe('City marshals did 1 residential eviction here since Sep 2023.')
  })

  it('is medium with 3 or more', async () => {
    const { deps } = count(3)
    expect((await evictions.run(PLACE, deps)).level).toBe('medium')
  })
})
