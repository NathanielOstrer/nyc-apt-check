const EARTH_RADIUS_M = 6_371_000
const FEET_PER_METER = 3.28084
const METERS_PER_MILE = 1609.344

export const QUARTER_MILE_M = 402
export const HALF_MILE_M = 805
export const ONE_MILE_M = 1609

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in meters. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a))
}

/**
 * Distance in meters from a point to a polygon given as [lon, lat] rings (GeoJSON / Esri order).
 * Returns 0 when the point is inside. Uses the even-odd rule, so holes are handled.
 * Projects onto a flat plane around the point, which is accurate to well under 1% at city scale.
 */
export function distanceToPolygon(lat: number, lon: number, rings: [number, number][][]): number {
  const mPerDegLat = (Math.PI * EARTH_RADIUS_M) / 180
  const mPerDegLon = mPerDegLat * Math.cos(toRad(lat))
  const project = ([x, y]: [number, number]): [number, number] => [(x - lon) * mPerDegLon, (y - lat) * mPerDegLat]

  let inside = false
  let best = Infinity
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = project(ring[i])
      const [xj, yj] = project(ring[j])
      // Ray cast from the origin (the query point) along +x.
      if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside
      best = Math.min(best, distanceToSegment(xi, yi, xj, yj))
    }
  }
  return inside ? 0 : best
}

/** Distance from the origin to segment (x1,y1)-(x2,y2). */
function distanceToSegment(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / lenSq))
  return Math.hypot(x1 + t * dx, y1 + t * dy)
}

/** "350 ft" under 1,000 ft, otherwise "0.4 mi". */
export function formatDistance(meters: number): string {
  const feet = meters * FEET_PER_METER
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`
  return `${(meters / METERS_PER_MILE).toFixed(1)} mi`
}
