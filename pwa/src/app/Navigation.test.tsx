import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { sectionsFor } from './nav.ts'
import { BottomNav, SectionTabs, SideNav } from './Navigation.tsx'

afterEach(cleanup)

const sections = sectionsFor('owner')
const at = (path: string, element: React.ReactElement) => render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>)

describe('SideNav (computers)', () => {
  it('lists each section with its screens, and marks the one open', () => {
    at('/backtest', <SideNav sections={sections} />)
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    const research = within(nav).getByRole('list', { name: 'Research' })
    expect(within(research).getByRole('link', { name: 'Backtest' })).toHaveAttribute('aria-current', 'page')
    expect(within(research).getByRole('link', { name: 'Markets' })).not.toHaveAttribute('aria-current')
    expect(within(nav).getByRole('list', { name: 'Trading' })).toBeInTheDocument()
    expect(within(nav).getByRole('list', { name: 'Admin' })).toBeInTheDocument()
  })
})

describe('BottomNav (phones)', () => {
  it('has one tab per section, and marks the section of a screen deep inside it', () => {
    at('/markets/XAUUSD/1h', <BottomNav sections={sections} />)
    const nav = screen.getByRole('navigation', { name: 'Sections' })
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Trading', 'Research', 'Admin'])
    expect(within(nav).getByRole('link', { name: 'Research' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Trading' })).not.toHaveAttribute('aria-current')
  })

  it('opens a section at its first screen', () => {
    at('/', <BottomNav sections={sections} />)
    expect(screen.getByRole('link', { name: 'Research' })).toHaveAttribute('href', '/markets')
  })
})

describe('SectionTabs (phones)', () => {
  it('shows the screens of the open section', () => {
    at('/orders', <SectionTabs sections={sections} />)
    const nav = screen.getByRole('navigation', { name: 'Trading screens' })
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Account', 'Sessions', 'Orders'])
    expect(within(nav).getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows nothing on a screen outside the sections', () => {
    const { container } = at('/connect', <SectionTabs sections={sections} />)
    expect(container).toBeEmptyDOMElement()
  })
})
