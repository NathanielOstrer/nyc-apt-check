import type { CheckState } from '../checks'
import type { Check, Level } from '../checks/types'

export const LEVEL_LABEL: Record<Level, string> = {
  high: 'High risk',
  medium: 'Medium risk',
  low: 'Low risk',
  info: 'Information',
  clear: 'No record',
}

interface Props {
  check: Check
  state: CheckState
  onRetry(): void
}

export function ResultCard({ check, state, onRetry }: Props) {
  const level = state.status === 'done' ? state.result.level : undefined
  return (
    <article className={`card ${level ? `level-${level}` : state.status}`} data-check={check.id} aria-busy={state.status === 'loading'}>
      <header>
        <h3>{check.title}</h3>
        {level && <span className={`chip chip-${level}`}>{LEVEL_LABEL[level]}</span>}
      </header>

      {state.status === 'loading' && <p className="muted">The data is loading.</p>}

      {state.status === 'error' && (
        <div className="error">
          <p>The data did not load. The source can be slow or offline.</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      {state.status === 'done' && (
        <>
          <p className="summary">{state.result.summary}</p>
          {state.result.details.length > 0 && (
            <ul className="details">
              {state.result.details.map((d, i) =>
                typeof d === 'string' ? (
                  <li key={i}>{d}</li>
                ) : (
                  <li key={i}>
                    <a href={d.url} target="_blank" rel="noreferrer">
                      {d.text}
                    </a>
                  </li>
                ),
              )}
            </ul>
          )}
        </>
      )}

      <footer className="sources">
        Source:{' '}
        {check.sources.map((s, i) => (
          <span key={s.url}>
            {i > 0 && ', '}
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.name}
            </a>
          </span>
        ))}
      </footer>
    </article>
  )
}
