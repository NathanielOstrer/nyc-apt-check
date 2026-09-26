import { describe, expect, it } from 'vitest'
import { E_DESIGNATIONS, eDesignation } from '../../src/checks/eDesignation'
import { EVACUATION_ZONES, FEMA_FLOOD_ZONES, flood, SANDY_INUNDATION } from '../../src/checks/flood'
import { DEC_REMEDIATION, stateCleanup } from '../../src/checks/stateCleanup'
import { SUPERFUND_BOUNDARIES, SUPERFUND_POINTS, superfund } from '../../src/checks/superfund'
import { arcgis, depsWith, PLACE, socrata, square } from './fakeFetch'

const { lat, lon } = PLACE
// About 0.004 degrees of latitude is 445 m, about 0.28 mi.
const NEAR = 0.004

function boundary(id: string, name: string, ring: [number, number][], status = 'F') {
  return {
    attributes: { SITE_NAME: name, EPA_ID: id, NPL_STATUS_CODE: status, URL_ALIAS_TXT: `https://epa.example/${id}` },
    geometry: { rings: [ring] },
  }
}

function superfundDeps(boundaries: unknown[], points: unknown[] = []) {
  return depsWith([
    { match: arcgis(SUPERFUND_BOUNDARIES), body: { features: boundaries } },
    { match: arcgis(SUPERFUND_POINTS), body: { features: points } },
  ])
}

describe('superfund', () => {
  it('is high when the address is inside a site', async () => {
    const { deps } = superfundDeps([boundary('NY1', 'TEST CANAL', square(lat, lon, 0.001))])
    const r = await superfund.run(PLACE, deps)
    expect(r.level).toBe('high')
    expect(r.summary).toBe('The address is inside the Test Canal Superfund site.')
    expect(r.details[0]).toEqual({ text: expect.stringContaining('the address is inside'), url: 'https://epa.example/NY1' })
    expect(r.mapFeatures).toHaveLength(1)
  })

  it('is medium within half a mile', async () => {
    const { deps } = superfundDeps([boundary('NY1', 'Test Creek', square(lat + NEAR + 0.001, lon, 0.001))])
    const r = await superfund.run(PLACE, deps)
    expect(r.level).toBe('medium')
    expect(r.summary).toBe('The nearest Superfund site is Test Creek, 0.3 mi away.')
  })

  it('is low between half a mile and a mile', async () => {
    // 0.011 degrees of latitude is about 1.2 km, about 0.76 mi, to the near edge.
    const { deps } = superfundDeps([boundary('NY1', 'Test Yard', square(lat + 0.012, lon, 0.001))])
    expect((await superfund.run(PLACE, deps)).level).toBe('low')
  })

  it('caps a deleted site at low even when the address is inside', async () => {
    const { deps } = superfundDeps([boundary('NY1', 'Old Site', square(lat, lon, 0.001), 'D')])
    const r = await superfund.run(PLACE, deps)
    expect(r.level).toBe('low')
    expect(r.details[0]).toMatchObject({ text: expect.stringContaining('Deleted from the National Priorities List') })
  })

  it('keeps the nearest feature when one site has several', async () => {
    const { deps } = superfundDeps([
      boundary('NY1', 'Test Canal', square(lat + 0.012, lon, 0.001)),
      boundary('NY1', 'Test Canal', square(lat + NEAR + 0.001, lon, 0.001)),
    ])
    const r = await superfund.run(PLACE, deps)
    expect(r.details).toHaveLength(1)
    expect(r.level).toBe('medium')
  })

  it('adds listed sites that only have a center point', async () => {
    const { deps } = superfundDeps(
      [],
      [{ attributes: { Site_Name: 'Test Plume', Site_EPA_ID: 'NY2', Status: 'NPL Site', Latitude: lat + NEAR, Longitude: lon } }],
    )
    const r = await superfund.run(PLACE, deps)
    expect(r.level).toBe('medium')
    expect(r.summary).toContain('Test Plume')
    expect(r.details[0]).toMatch(/center point/)
    expect(r.mapFeatures?.[0]).toMatchObject({ kind: 'point' })
  })

  it('does not list a point site twice when it also has a boundary', async () => {
    const { deps } = superfundDeps(
      [boundary('NY1', 'Test Canal', square(lat, lon, 0.001))],
      [{ attributes: { Site_Name: 'Test Canal', Site_EPA_ID: 'NY1', Status: 'NPL Site', Latitude: lat, Longitude: lon } }],
    )
    expect((await superfund.run(PLACE, deps)).details).toHaveLength(1)
  })

  it('is clear when no site is within a mile', async () => {
    const { deps } = superfundDeps([])
    const r = await superfund.run(PLACE, deps)
    expect(r.level).toBe('clear')
    expect(r.summary).toBe('There is no Superfund site within 1 mile.')
  })

  it('fails when the EPA service fails', async () => {
    const { deps } = depsWith([{ match: () => true, status: 503 }])
    await expect(superfund.run(PLACE, deps)).rejects.toThrow()
  })
})

function decSite(program_number: string, siteclass: string, dLat: number, program_type = 'BCP') {
  return {
    program_number,
    program_type,
    program_facility_name: `Site ${program_number}`,
    siteclass,
    latitude: String(lat + dLat),
    longitude: String(lon),
  }
}

describe('stateCleanup', () => {
  it('queries a quarter-mile circle and groups rows by site', async () => {
    const { deps, calls } = depsWith([{ match: socrata(DEC_REMEDIATION), body: [] }])
    await stateCleanup.run(PLACE, deps)
    const p = calls[0].searchParams
    expect(p.get('$where')).toBe(`within_circle(georeference, ${lat}, ${lon}, 402)`)
    expect(p.get('$group')).toContain('program_number')
  })

  it('is high for a class 2 State Superfund site', async () => {
    const { deps } = depsWith([{ match: socrata(DEC_REMEDIATION), body: [decSite('241', '2', 0.002, 'HW')] }])
    const r = await stateCleanup.run(PLACE, deps)
    expect(r.level).toBe('high')
    expect(r.summary).toContain('1 site is a significant threat.')
    expect(r.details[0]).toMatchObject({ text: expect.stringContaining('(State Superfund)') })
  })

  it('is medium for an active cleanup on or next to the lot', async () => {
    const { deps } = depsWith([{ match: socrata(DEC_REMEDIATION), body: [decSite('C1', 'A', 0.0002)] }])
    const r = await stateCleanup.run(PLACE, deps)
    expect(r.level).toBe('medium')
    expect(r.summary).toContain('Site C1 is on or next to this lot.')
  })

  it('is low for an active cleanup down the block', async () => {
    const { deps } = depsWith([{ match: socrata(DEC_REMEDIATION), body: [decSite('C1', 'A', 0.002)] }])
    const r = await stateCleanup.run(PLACE, deps)
    expect(r.level).toBe('low')
    expect(r.summary).toContain('1 site is not closed.')
  })

  it('is low when every site is complete', async () => {
    const { deps } = depsWith([
      { match: socrata(DEC_REMEDIATION), body: [decSite('C1', 'C', 0.001), decSite('C2', 'N', 0.002)] },
    ])
    const r = await stateCleanup.run(PLACE, deps)
    expect(r.level).toBe('low')
    expect(r.summary).toBe('There are 2 state cleanup sites within a quarter mile.')
  })

  it('sorts sites by distance and plots each one', async () => {
    const { deps } = depsWith([
      { match: socrata(DEC_REMEDIATION), body: [decSite('FAR', 'C', 0.003), decSite('NEAR', 'C', 0.001)] },
    ])
    const r = await stateCleanup.run(PLACE, deps)
    expect(r.details[0]).toMatchObject({ text: expect.stringMatching(/^Site NEAR/) })
    expect(r.mapFeatures).toHaveLength(2)
  })

  it('is clear with no sites', async () => {
    const { deps } = depsWith([{ match: socrata(DEC_REMEDIATION), body: [] }])
    expect((await stateCleanup.run(PLACE, deps)).level).toBe('clear')
  })
})

describe('eDesignation', () => {
  it('does not query without a BBL', async () => {
    const { deps, calls } = depsWith([])
    const r = await eDesignation.run({ ...PLACE, bbl: undefined }, deps)
    expect(r.level).toBe('info')
    expect(calls).toHaveLength(0)
  })

  it('is medium for a hazardous materials designation', async () => {
    const { deps, calls } = depsWith([
      {
        match: socrata(E_DESIGNATIONS),
        body: [{ enumber: 'E-99', hazmat_code: 'True', air_code: 'False', noise_code: 'True', description: 'Test' }],
      },
    ])
    const r = await eDesignation.run(PLACE, deps)
    expect(r.level).toBe('medium')
    expect(r.summary).toMatch(/hazardous materials/)
    expect(r.details).toEqual(['E-99: Test'])
    expect(calls[0].searchParams.get('$where')).toBe("bbl='3000010001'")
  })

  it('is low for a noise-only designation', async () => {
    const { deps } = depsWith([
      { match: socrata(E_DESIGNATIONS), body: [{ enumber: 'E-1', hazmat_code: 'False', air_code: 'False', noise_code: 'True' }] },
    ])
    const r = await eDesignation.run(PLACE, deps)
    expect(r.level).toBe('low')
    expect(r.summary).toBe('The lot has an E-designation for noise.')
  })

  it('is clear with no designation', async () => {
    const { deps } = depsWith([{ match: socrata(E_DESIGNATIONS), body: [] }])
    expect((await eDesignation.run(PLACE, deps)).level).toBe('clear')
  })
})

function floodDeps(opts: { fema?: unknown; femaStatus?: number; sandy?: unknown[]; evac?: unknown[]; evacStatus?: number }) {
  return depsWith([
    { match: arcgis(FEMA_FLOOD_ZONES), body: opts.fema ?? { features: [] }, status: opts.femaStatus },
    { match: socrata(SANDY_INUNDATION), body: opts.sandy ?? [] },
    { match: socrata(EVACUATION_ZONES), body: opts.evac ?? [], status: opts.evacStatus },
  ])
}

const femaZone = (FLD_ZONE: string, SFHA_TF: string, ZONE_SUBTY: string | null = null) => ({
  features: [{ attributes: { FLD_ZONE, SFHA_TF, ZONE_SUBTY } }],
})

describe('flood', () => {
  it('is high in a FEMA special flood hazard area', async () => {
    const { deps } = floodDeps({ fema: femaZone('AE', 'T') })
    const r = await flood.run(PLACE, deps)
    expect(r.level).toBe('high')
    expect(r.details[0]).toMatch(/^FEMA flood zone AE: a high-risk area/)
  })

  it('is medium in shaded zone X', async () => {
    const { deps } = floodDeps({ fema: femaZone('X', 'F', '0.2 PCT ANNUAL CHANCE FLOOD HAZARD') })
    expect((await flood.run(PLACE, deps)).level).toBe('medium')
  })

  it('is medium where Sandy flooded, even in zone X', async () => {
    const { deps } = floodDeps({ fema: femaZone('X', 'F', 'AREA OF MINIMAL FLOOD HAZARD'), sandy: [{ id: '0' }] })
    const r = await flood.run(PLACE, deps)
    expect(r.level).toBe('medium')
    expect(r.details[1]).toBe('Hurricane Sandy flooded this area in 2012.')
  })

  it('reports the lowest evacuation zone number and ignores X and 7', async () => {
    const { deps } = floodDeps({ evac: [{ hurricane_: 'X' }, { hurricane_: '4' }, { hurricane_: '2' }, { hurricane_: '7' }] })
    const r = await flood.run(PLACE, deps)
    expect(r.details[2]).toMatch(/^Hurricane evacuation zone 2\./)
    expect(r.level).toBe('medium')
  })

  it('treats zones 3 to 6 as low', async () => {
    const { deps } = floodDeps({ fema: femaZone('X', 'F'), evac: [{ hurricane_: '5' }] })
    expect((await flood.run(PLACE, deps)).level).toBe('low')
  })

  it('says the address is outside every zone', async () => {
    const { deps } = floodDeps({ evac: [{ hurricane_: 'X' }] })
    expect((await flood.run(PLACE, deps)).details[2]).toBe('The address is not in a hurricane evacuation zone.')
  })

  it('still shows the other maps when one fails', async () => {
    const { deps } = floodDeps({ femaStatus: 500, sandy: [{ id: '0' }] })
    const r = await flood.run(PLACE, deps)
    expect(r.details[0]).toBe('The FEMA flood map did not load.')
    expect(r.details[1]).toMatch(/Sandy flooded/)
    expect(r.level).toBe('medium')
  })

  it('fails when every map fails', async () => {
    const { deps } = depsWith([{ match: () => true, status: 500 }])
    await expect(flood.run(PLACE, deps)).rejects.toThrow()
  })
})
