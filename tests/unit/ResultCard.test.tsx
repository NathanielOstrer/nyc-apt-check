// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Check } from '../../src/checks/types'
import { ResultCard } from '../../src/components/ResultCard'

const check: Check = {
  id: 'test',
  title: 'Test check',
  category: 'Environment',
  sources: [
    { name: 'Source A', url: 'https://a.example/' },
    { name: 'Source B', url: 'https://b.example/' },
  ],
  run: async () => ({ level: 'clear', summary: '', details: [] }),
}

afterEach(cleanup)

describe('ResultCard', () => {
  it('shows a loading message', () => {
    render(<ResultCard check={check} state={{ status: 'loading' }} onRetry={() => {}} />)
    expect(screen.getByText('The data is loading.')).toBeTruthy()
    expect(screen.getByRole('article').getAttribute('aria-busy')).toBe('true')
  })

  it('shows the level, summary, plain and linked details', () => {
    render(
      <ResultCard
        check={check}
        state={{
          status: 'done',
          result: {
            level: 'high',
            summary: 'A summary.',
            details: ['Plain line.', { text: 'Linked line.', url: 'https://detail.example/' }],
          },
        }}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByText('High risk')).toBeTruthy()
    expect(screen.getByText('A summary.')).toBeTruthy()
    expect(screen.getByText('Plain line.').tagName).toBe('LI')
    expect(screen.getByRole('link', { name: 'Linked line.' }).getAttribute('href')).toBe('https://detail.example/')
    expect(screen.getByRole('article').className).toContain('level-high')
  })

  it('shows an error with a working retry button', () => {
    const onRetry = vi.fn()
    render(<ResultCard check={check} state={{ status: 'error', message: '500' }} onRetry={onRetry} />)
    expect(screen.getByText(/did not load/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('links every source in a new tab', () => {
    render(<ResultCard check={check} state={{ status: 'loading' }} onRetry={() => {}} />)
    const a = screen.getByRole('link', { name: 'Source A' })
    expect(a.getAttribute('href')).toBe('https://a.example/')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(screen.getByRole('link', { name: 'Source B' })).toBeTruthy()
  })
})
