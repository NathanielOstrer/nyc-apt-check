/** A geocoded NYC address. `bbl` and `bin` come from the city's PAD file via GeoSearch. */
export interface Place {
  label: string
  lat: number
  lon: number
  bbl?: string
  bin?: string
  borough?: string
}

/**
 * How worried a renter should be about one check.
 * `clear` means the source has no record for this address; `info` is context with no judgement.
 */
export type Level = 'high' | 'medium' | 'low' | 'clear' | 'info'

export const LEVEL_ORDER: Level[] = ['high', 'medium', 'low', 'info', 'clear']

export type Category = 'Environment' | 'Flooding' | 'Building' | 'Neighborhood'

export const CATEGORIES: Category[] = ['Environment', 'Flooding', 'Building', 'Neighborhood']

export interface Source {
  name: string
  url: string
}

export type MapFeature =
  | { kind: 'point'; lat: number; lon: number; label: string; level: Level }
  | { kind: 'polygon'; rings: [number, number][][]; label: string; level: Level }

/** One line under a result. Give a `url` when the source has a page for that item. */
export type Detail = string | { text: string; url: string }

export interface CheckResult {
  level: Level
  summary: string
  details: Detail[]
  mapFeatures?: MapFeature[]
}

/** Injected so checks are testable without the network or a real clock. */
export interface Deps {
  fetch: typeof fetch
  now: Date
}

export interface Check {
  id: string
  title: string
  category: Category
  sources: Source[]
  run(place: Place, deps: Deps): Promise<CheckResult>
}
