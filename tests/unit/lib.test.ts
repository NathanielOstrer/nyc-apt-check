import { describe, expect, it } from 'vitest'
import { arcgisPointQuery, ApiError, monthsAgo, soql, soqlDate, soqlString } from '../../src/lib/api'
import { distanceToPolygon, formatDistance, haversine } from '../../src/lib/geo'
import { featureToPlace, geocode } from '../../src/lib/geocode'
import { depsWith, fakeFetch, square } from './fakeFetch'

describe('haversine', () => {
  it('is zero for the same point', () => {
    expect(haversine(40.7, -74, 40.7, -74)).toBe(0)
  })

  it('measures one degree of latitude as about 111 km', () => {
    expect(haversine(40, -74, 41, -74)).toBeCloseTo(111_195, -2)
  })

  it('is symmetric', () => {
    expect(haversine(40.7, -74, 40.8, -73.9)).toBeCloseTo(haversine(40.8, -73.9, 40.7, -74), 6)
  })
})

describe('distanceToPolygon', () => {
  const lat = 40.7
  const lon = -73.95

  it('is zero inside the polygon', () => {
    expect(distanceToPolygon(lat, lon, [square(lat, lon, 0.001)])).toBe(0)
  })

  it('measures to the nearest edge from outside', () => {
    // The square's west edge is 0.002 degrees of longitude east of the point.
    const ring = square(lat, lon + 0.003, 0.001)
    const expected = haversine(lat, lon, lat, lon + 0.002)
    expect(distanceToPolygon(lat, lon, [ring])).toBeCloseTo(expected, -1)
  })

  it('measures to a corner when that is nearest', () => {
    const ring = square(lat + 0.002, lon + 0.002, 0.001)
    const expected = haversine(lat, lon, lat + 0.001, lon + 0.001)
    expect(distanceToPolygon(lat, lon, [ring])).toBeCloseTo(expected, -1)
  })

  it('treats a point in a hole as outside', () => {
    const outer = square(lat, lon, 0.002)
    const hole = square(lat, lon, 0.001)
    const d = distanceToPolygon(lat, lon, [outer, hole])
    expect(d).toBeGreaterThan(0)
    // A degree of longitude is shorter than a degree of latitude here, so the east and west edges are nearest.
    expect(d).toBeCloseTo(haversine(lat, lon, lat, lon + 0.001), -1)
  })

  it('returns Infinity for no rings', () => {
    expect(distanceToPolygon(lat, lon, [])).toBe(Infinity)
  })
})

describe('formatDistance', () => {
  it('uses feet, rounded to 10, under 1,000 ft', () => {
    expect(formatDistance(0)).toBe('0 ft')
    expect(formatDistance(55)).toBe('180 ft')
    expect(formatDistance(304)).toBe('1000 ft')
  })

  it('uses miles with one decimal from 1,000 ft', () => {
    expect(formatDistance(305)).toBe('0.2 mi')
    expect(formatDistance(1609.344)).toBe('1.0 mi')
  })
})

describe('soql', () => {
  it('builds the resource URL with encoded parameters', async () => {
    const { deps, calls } = depsWith([{ match: () => true, body: [{ a: '1' }] }])
    const rows = await soql(deps, 'https://data.example.gov', 'abcd-1234', { $where: "bbl='1' AND x > 2" })
    expect(rows).toEqual([{ a: '1' }])
    expect(calls[0].origin + calls[0].pathname).toBe('https://data.example.gov/resource/abcd-1234.json')
    expect(calls[0].searchParams.get('$where')).toBe("bbl='1' AND x > 2")
  })

  it('throws ApiError on an HTTP error', async () => {
    const { deps } = depsWith([{ match: () => true, status: 500, body: {} }])
    await expect(soql(deps, 'https://data.example.gov', 'x', {})).rejects.toBeInstanceOf(ApiError)
  })

  it('throws when Socrata returns an error object with status 200', async () => {
    const { deps } = depsWith([{ match: () => true, body: { message: 'no such column' } }])
    await expect(soql(deps, 'https://data.example.gov', 'x', {})).rejects.toThrow(/Unexpected response/)
  })
})

describe('SoQL literals', () => {
  it('escapes single quotes', () => {
    expect(soqlString("O'Brien")).toBe("'O''Brien'")
  })

  it('formats a date as a floating timestamp at midnight', () => {
    expect(soqlDate(new Date('2026-09-26T18:30:00Z'))).toBe("'2026-09-26T00:00:00'")
  })

  it('subtracts months without changing the input', () => {
    const now = new Date('2026-09-26T12:00:00Z')
    expect(monthsAgo(now, 12).toISOString().slice(0, 10)).toBe('2025-09-26')
    expect(monthsAgo(now, 36).toISOString().slice(0, 10)).toBe('2023-09-26')
    expect(now.toISOString().slice(0, 10)).toBe('2026-09-26')
  })
})

describe('arcgisPointQuery', () => {
  const layer = 'https://example.gov/arcgis/rest/services/x/FeatureServer/0'

  it('sends a point intersect query and returns features', async () => {
    const { deps, calls } = depsWith([{ match: () => true, body: { features: [{ attributes: { A: 1 } }] } }])
    const features = await arcgisPointQuery<{ A: number }>(deps, layer, 40.7, -73.9, { outFields: ['A', 'B'] })
    expect(features[0].attributes.A).toBe(1)
    const p = calls[0].searchParams
    expect(p.get('geometry')).toBe('-73.9,40.7')
    expect(p.get('inSR')).toBe('4326')
    expect(p.get('outFields')).toBe('A,B')
    expect(p.get('returnGeometry')).toBe('false')
    expect(p.has('distance')).toBe(false)
    expect(p.has('maxAllowableOffset')).toBe(false)
  })

  it('adds a buffer distance in meters and simplifies returned geometry', async () => {
    const { deps, calls } = depsWith([{ match: () => true, body: { features: [] } }])
    await arcgisPointQuery(deps, layer, 40.7, -73.9, { outFields: ['A'], distance: 500, returnGeometry: true })
    const p = calls[0].searchParams
    expect(p.get('distance')).toBe('500')
    expect(p.get('units')).toBe('esriSRUnit_Meter')
    expect(p.get('maxAllowableOffset')).toBeTruthy()
  })

  it('throws on an ArcGIS error body, which arrives with HTTP 200', async () => {
    const { deps } = depsWith([{ match: () => true, body: { error: { code: 400, message: 'Invalid query' } } }])
    await expect(arcgisPointQuery(deps, layer, 40.7, -73.9, { outFields: ['A'] })).rejects.toThrow('Invalid query')
  })

  it('treats a missing features array as no features', async () => {
    const { deps } = depsWith([{ match: () => true, body: {} }])
    expect(await arcgisPointQuery(deps, layer, 40.7, -73.9, { outFields: ['A'] })).toEqual([])
  })
})

describe('geocode', () => {
  const feature = {
    geometry: { coordinates: [-73.95, 40.7] as [number, number] },
    properties: {
      label: '1 TEST AVENUE, Brooklyn, NY, USA',
      borough: 'Brooklyn',
      addendum: { pad: { bbl: '3000010001', bin: '3000001' } },
    },
  }

  it('maps a GeoSearch feature to a place', () => {
    expect(featureToPlace(feature)).toEqual({
      label: '1 TEST AVENUE, Brooklyn, NY',
      lat: 40.7,
      lon: -73.95,
      bbl: '3000010001',
      bin: '3000001',
      borough: 'Brooklyn',
    })
  })

  it('leaves bbl and bin undefined when PAD has none', () => {
    const place = featureToPlace({ ...feature, properties: { label: 'X', addendum: { pad: { bbl: '' } } } })
    expect(place.bbl).toBeUndefined()
    expect(place.bin).toBeUndefined()
  })

  it('returns the first search match', async () => {
    const f = fakeFetch([{ match: (u) => u.pathname.endsWith('/search'), body: { features: [feature] } }])
    expect((await geocode('1 test ave', f.fetch))?.bbl).toBe('3000010001')
    expect(f.calls[0].searchParams.get('size')).toBe('1')
  })

  it('returns undefined when nothing matches', async () => {
    const f = fakeFetch([{ match: () => true, body: { features: [] } }])
    expect(await geocode('nowhere', f.fetch)).toBeUndefined()
  })

  it('throws when the geocoder fails', async () => {
    const f = fakeFetch([{ match: () => true, status: 502 }])
    await expect(geocode('x', f.fetch)).rejects.toThrow(/502/)
  })
})
