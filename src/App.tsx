import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CHECKS, runChecks, type CheckState } from './checks'
import { plural } from './checks/helpers'
import { CATEGORIES, type Check, type Deps, type Level, type MapFeature, type Place } from './checks/types'
import { ResultCard } from './components/ResultCard'
import { RiskMap } from './components/RiskMap'
import { SearchBox } from './components/SearchBox'
import { geocode } from './lib/geocode'

const deps = (): Deps => ({ fetch: (...args) => fetch(...args), now: new Date() })

function readAddressParam(): string {
  return new URLSearchParams(window.location.search).get('address') ?? ''
}

function writeAddressParam(label: string) {
  const url = new URL(window.location.href)
  url.searchParams.set('address', label)
  window.history.replaceState(null, '', url)
}

export default function App() {
  const [place, setPlace] = useState<Place>()
  const [states, setStates] = useState<Record<string, CheckState>>({})
  const [searching, setSearching] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [initialText] = useState(readAddressParam)
  // Increments on each new address, so results from an older search are dropped.
  const run = useRef(0)

  const start = useCallback((p: Place, checks: Check[] = CHECKS) => {
    const id = checks === CHECKS ? ++run.current : run.current
    setPlace(p)
    setNotFound(false)
    writeAddressParam(p.label)
    if (checks === CHECKS) setStates({})
    void runChecks(
      p,
      deps(),
      (checkId, state) => {
        if (run.current === id) setStates((s) => ({ ...s, [checkId]: state }))
      },
      checks,
    )
  }, [])

  const searchText = useCallback(
    async (text: string) => {
      setSearching(true)
      try {
        const p = await geocode(text)
        if (p) start(p)
        else {
          setNotFound(true)
          setPlace(undefined)
        }
      } catch {
        setNotFound(true)
      } finally {
        setSearching(false)
      }
    },
    [start],
  )

  useEffect(() => {
    if (initialText) void searchText(initialText)
  }, [initialText, searchText])

  const features = useMemo(
    () =>
      Object.values(states).flatMap((s): MapFeature[] => (s.status === 'done' ? (s.result.mapFeatures ?? []) : [])),
    [states],
  )

  const counts = useMemo(() => {
    const c: Partial<Record<Level, number>> = {}
    for (const s of Object.values(states)) if (s.status === 'done') c[s.result.level] = (c[s.result.level] ?? 0) + 1
    return c
  }, [states])
  const pending = CHECKS.filter((c) => states[c.id]?.status === 'loading').length

  return (
    <div className="page">
      <header className="masthead">
        <h1>NYC Apartment Check</h1>
        <p className="lede">
          Enter an address in New York City. The page shows environmental, flood and building risks for that address.
        </p>
        <aside className="experimental" role="note">
          <strong>Experimental.</strong> This site is a test project. The data comes from public city, state and federal
          sources. The data can be old or wrong. Check each result at its source before you sign a lease.
        </aside>
      </header>

      <SearchBox initialText={initialText} busy={searching} onPick={(p) => start(p)} onSubmitText={searchText} />

      {notFound && (
        <p className="notice" role="alert">
          The address was not found. Enter a street address in New York City.
        </p>
      )}

      {place && (
        <main className="results">
          <section className="overview" aria-live="polite">
            <h2>{place.label}</h2>
            <p>
              {pending > 0
                ? `The page is checking ${pending} of ${CHECKS.length} sources.`
                : `The page found ${plural(counts.high ?? 0, 'high risk')} and ${plural(counts.medium ?? 0, 'medium risk')}.`}
            </p>
            <p className="muted">The risk levels are rough guides that this site sets. They are not official ratings.</p>
          </section>

          <div className="layout">
            <div className="map-wrap">
              <RiskMap place={place} features={features} />
              <p className="legend muted">
                The black circle is the address. Red shapes are Superfund sites. The dots are cleanup sites, in the color of their risk level.
              </p>
            </div>
            <div className="groups">
              {CATEGORIES.map((category) => (
                <section key={category} className="group">
                  <h2>{category}</h2>
                  {CHECKS.filter((c) => c.category === category).map((check) => (
                    <ResultCard
                      key={check.id}
                      check={check}
                      state={states[check.id] ?? { status: 'loading' }}
                      onRetry={() => start(place, [check])}
                    />
                  ))}
                </section>
              ))}
            </div>
          </div>
        </main>
      )}

      <footer className="colophon muted">
        <p>
          This site has no server. Your browser sends the address directly to NYC Planning GeoSearch and to the public
          data services named on each card.
        </p>
      </footer>
    </div>
  )
}
