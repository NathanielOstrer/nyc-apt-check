import { useEffect, useId, useRef, useState } from 'react'
import type { Place } from '../checks/types'
import { autocomplete } from '../lib/geocode'

interface Props {
  initialText?: string
  busy: boolean
  onPick(place: Place): void
  onSubmitText(text: string): void
}

const DEBOUNCE_MS = 250
const MIN_CHARS = 3

export function SearchBox({ initialText = '', busy, onPick, onSubmitText }: Props) {
  const [text, setText] = useState(initialText)
  const [suggestions, setSuggestions] = useState<Place[]>([])
  const [active, setActive] = useState(-1)
  const [open, setOpen] = useState(false)
  const listId = useId()
  // Set when the text changes because the user picked a suggestion, so we do not search again.
  const picked = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Text from a shared link is not typing, so do not offer suggestions for it.
    picked.current = true
    setText(initialText)
  }, [initialText])

  useEffect(() => {
    if (picked.current) {
      picked.current = false
      return
    }
    if (text.trim().length < MIN_CHARS) {
      setSuggestions([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      autocomplete(text.trim())
        .then((places) => {
          if (cancelled) return
          setSuggestions(places)
          setActive(-1)
          // Only open the list for the person who is typing in the field.
          setOpen(places.length > 0 && document.activeElement === input.current)
        })
        // Suggestions are optional. The user can still submit the form.
        .catch(() => !cancelled && setSuggestions([]))
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text])

  function pick(place: Place) {
    picked.current = true
    setText(place.label)
    setOpen(false)
    setSuggestions([])
    onPick(place)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pick(suggestions[active])
    }
  }

  return (
    <form
      className="search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim()) return
        setOpen(false)
        onSubmitText(text.trim())
      }}
    >
      <label htmlFor="address">Address</label>
      <div className="search-row">
        <div className="combo">
          <input
            id="address"
            ref={input}
            type="text"
            autoComplete="off"
            placeholder="For example, 1 Centre Street, Manhattan"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setOpen(true)
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          />
          {open && suggestions.length > 0 && (
            <ul className="suggestions" id={listId} role="listbox">
              {suggestions.map((s, i) => (
                <li
                  key={`${s.label}-${i}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'active' : undefined}
                  // mousedown fires before the input blurs, so the click is not lost.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(s)
                  }}
                >
                  {s.label}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button type="submit" disabled={busy}>
          Check address
        </button>
      </div>
    </form>
  )
}
