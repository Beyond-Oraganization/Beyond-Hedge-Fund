import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { Footnote } from './ui.tsx'

afterEach(cleanup)

describe('Footnote', () => {
  it('keeps the command and its timing behind a closed Details', async () => {
    render(<Footnote parts={['market list', '12 ms', null, 'updated 14:03:21 UTC']} />)
    const summary = screen.getByText('Details')
    const details = summary.closest('details')!
    expect(details).not.toHaveAttribute('open')
    expect(details).toHaveTextContent('market list · 12 ms · updated 14:03:21 UTC')
    await userEvent.click(summary)
    expect(details).toHaveAttribute('open')
  })

  it('shows nothing when there is nothing to tell', () => {
    const { container } = render(<Footnote parts={[null, false]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
