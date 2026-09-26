import type { CheckResult, Level, Place } from './types'
import { LEVEL_ORDER } from './types'

/** Result for a building check when GeoSearch returned no tax lot (BBL) or building (BIN). */
export function missingId(place: Place, id: 'bbl' | 'bin'): CheckResult | undefined {
  if (place[id]) return undefined
  return {
    level: 'info',
    summary: 'The city has no building record for this address. Try the street address of the building.',
    details: [],
  }
}

/** The most severe of the given levels. `info` outranks `clear` because it has something to say. */
export function worst(levels: Level[]): Level {
  return LEVEL_ORDER.find((l) => levels.includes(l)) ?? 'clear'
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

export function num(value: string | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** "Sep 2023" */
export function monthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
