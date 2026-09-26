/**
 * Contract tests against the real public APIs. They catch renamed columns, moved
 * datasets and changed response shapes, which the offline unit tests cannot see.
 * Run with `npm run test:live`. They need the network and take about 30 seconds.
 */
import { describe, expect, it } from 'vitest'
import { CHECKS } from '../../src/checks'
import { aep } from '../../src/checks/building'
import { flood } from '../../src/checks/flood'
import { stateCleanup } from '../../src/checks/stateCleanup'
import { superfund } from '../../src/checks/superfund'
import type { Deps, Level, Place } from '../../src/checks/types'
import { autocomplete, geocode } from '../../src/lib/geocode'

const deps: Deps = { fetch, now: new Date() }
const LEVELS: Level[] = ['high', 'medium', 'low', 'clear', 'info']

// A supermarket on the Gowanus Canal Superfund site. Public, commercial, not anyone's home.
const GOWANUS: Place = {
  label: '214 3 STREET, Brooklyn, NY',
  lat: 40.674937,
  lon: -73.988784,
  bbl: '3009780016',
  bin: '3397192',
}

// A large apartment building on HPD's public Alternative Enforcement Program list.
const AEP_BUILDING: Place = {
  label: '1314 SENECA AVENUE, Bronx, NY',
  lat: 40.81894,
  lon: -73.886981,
  bbl: '2027627501',
  bin: '2006460',
}

describe('GeoSearch', () => {
  it('geocodes an address to a BBL and BIN', async () => {
    const place = await geocode('214 3rd Street, Brooklyn')
    expect(place?.bbl).toBe(GOWANUS.bbl)
    expect(place?.bin).toBe(GOWANUS.bin)
    expect(place?.lat).toBeCloseTo(GOWANUS.lat, 3)
  })

  it('autocompletes a partial address', async () => {
    const places = await autocomplete('214 3rd St')
    expect(places.length).toBeGreaterThan(0)
    expect(places[0].label).not.toMatch(/USA$/)
  })
})

describe('environment checks', () => {
  it('finds the Gowanus Canal Superfund site at the address', async () => {
    const result = await superfund.run(GOWANUS, deps)
    expect(result.level).not.toBe('clear')
    expect(result.summary).toMatch(/Gowanus Canal/)
    expect(result.mapFeatures?.some((f) => f.kind === 'polygon')).toBe(true)
  })

  it('finds state brownfield sites around the canal', async () => {
    const result = await stateCleanup.run(GOWANUS, deps)
    expect(result.level).not.toBe('clear')
    expect(result.details.length).toBeGreaterThan(3)
  })
})

describe('flood check', () => {
  it('loads all three flood maps', async () => {
    const result = await flood.run(GOWANUS, deps)
    expect(result.details).toHaveLength(3)
    expect(result.details.join(' ')).not.toMatch(/did not load/)
    // The canal side of Gowanus flooded in Sandy.
    expect(result.details.join(' ')).toMatch(/Sandy flooded/)
  })
})

describe('building checks', () => {
  it('reports an AEP building', async () => {
    const result = await aep.run(AEP_BUILDING, deps)
    expect(['high', 'low']).toContain(result.level)
  })
})

describe('every check', () => {
  for (const place of [GOWANUS, AEP_BUILDING]) {
    for (const check of CHECKS) {
      it(`${check.id} returns a valid result for ${place.label}`, async () => {
        const result = await check.run(place, deps)
        expect(LEVELS).toContain(result.level)
        expect(result.summary.length).toBeGreaterThan(10)
        expect(result.summary).not.toMatch(/undefined|NaN/)
      })
    }
  }
})
