import { aep, bedbugs, buildingInfo, evictions, hpdComplaints, hpdViolations, rodents } from './building'
import { eDesignation } from './eDesignation'
import { flood } from './flood'
import { complaints311, crime } from './neighborhood'
import { stateCleanup } from './stateCleanup'
import { superfund } from './superfund'
import type { Check, CheckResult, Deps, Place } from './types'

/** Every check, in display order within each category. Add new checks here. */
export const CHECKS: Check[] = [
  superfund,
  stateCleanup,
  eDesignation,
  flood,
  buildingInfo,
  aep,
  hpdViolations,
  hpdComplaints,
  bedbugs,
  rodents,
  evictions,
  complaints311,
  crime,
]

export type CheckState =
  | { status: 'loading' }
  | { status: 'done'; result: CheckResult }
  | { status: 'error'; message: string }

/**
 * Run the checks in parallel and report each one as it finishes, so a slow source
 * (311 can take several seconds) does not hold up the rest.
 */
export function runChecks(
  place: Place,
  deps: Deps,
  onUpdate: (id: string, state: CheckState) => void,
  checks: Check[] = CHECKS,
): Promise<void> {
  return Promise.all(
    checks.map(async (check) => {
      onUpdate(check.id, { status: 'loading' })
      try {
        onUpdate(check.id, { status: 'done', result: await check.run(place, deps) })
      } catch (err) {
        onUpdate(check.id, { status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }),
  ).then(() => undefined)
}
