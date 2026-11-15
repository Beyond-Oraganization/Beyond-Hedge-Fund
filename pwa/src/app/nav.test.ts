import { describe, expect, it } from 'vitest'
import { sectionOf, sectionsFor } from './nav.ts'

// Every screen the app has today, by its route.
const SCREENS = ['/overview', '/', '/trading', '/clients', '/orders', '/markets', '/backtest', '/strategies', '/account', '/connections', '/console', '/people', '/managed', '/audit', '/system', '/settings', '/install']

describe('the navigation, by role', () => {
  it('gives the owner Overview, Trading, Clients, Research and Admin, with every screen once', () => {
    const sections = sectionsFor('owner')
    expect(sections.map((section) => section.label)).toEqual(['Overview', 'Trading', 'Clients', 'Research', 'Admin'])
    const routes = sections.flatMap((section) => section.items.map((item) => item.to))
    expect([...routes].sort()).toEqual([...SCREENS].sort())
  })

  it('keeps the bot’s keys, console and accounts away from staff, but not its health', () => {
    const admin = sectionsFor('staff').find((section) => section.id === 'admin')!
    const routes = admin.items.map((item) => item.to)
    expect(routes).toContain('/system')
    expect(routes).toContain('/settings')
    expect(routes).toContain('/audit')
    expect(routes).toContain('/managed')
    expect(routes).not.toContain('/people')
    expect(routes).not.toContain('/console')
    expect(routes).not.toContain('/connections')
    expect(routes).not.toContain('/account')
  })
})

describe('which section a screen belongs to', () => {
  const sections = sectionsFor('owner')
  it.each([
    ['/', 'trading'],
    ['/trading', 'trading'],
    ['/orders', 'trading'],
    ['/markets', 'research'],
    ['/markets/XAUUSD/1h', 'research'],
    ['/backtest', 'research'],
    ['/overview', 'overview'],
    ['/clients', 'clients'],
    ['/clients/3', 'clients'],
    ['/clients/3/view', 'clients'],
    ['/connections', 'admin'],
    ['/system', 'admin'],
  ])('%s is in %s', (path, id) => {
    expect(sectionOf(sections, path)?.id).toBe(id)
  })

  it('a screen outside the navigation (Connect) is in none', () => {
    expect(sectionOf(sections, '/connect')).toBeUndefined()
  })
})

describe('the navigation of people who sign in', () => {
  it('gives a client Home, Activity and their Account, each a place of its own', () => {
    const sections = sectionsFor('client', { person: true })
    expect(sections.map((section) => section.label)).toEqual(['Home', 'Activity', 'Account'])
    expect(sections.map((section) => section.items.map((item) => item.to))).toEqual([['/home'], ['/activity'], ['/me']])
  })

  it('adds a person’s own sign-in to Admin, and not for the API key', () => {
    const admin = (person: boolean) => sectionsFor('staff', { person }).find((section) => section.id === 'admin')!.items.map((item) => item.to)
    expect(admin(true)[0]).toBe('/me')
    expect(admin(false)).not.toContain('/me')
  })
})
