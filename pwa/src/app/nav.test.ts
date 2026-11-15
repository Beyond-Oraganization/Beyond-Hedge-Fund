import { describe, expect, it } from 'vitest'
import { sectionOf, sectionsFor } from './nav.ts'

// Every screen the app has today, by its route.
const SCREENS = ['/', '/trading', '/orders', '/markets', '/backtest', '/strategies', '/account', '/connections', '/console', '/system', '/settings', '/install']

describe('the navigation, by role', () => {
  it('gives the owner Trading, Research and Admin, with every screen once', () => {
    const sections = sectionsFor('owner')
    expect(sections.map((section) => section.label)).toEqual(['Trading', 'Research', 'Admin'])
    const routes = sections.flatMap((section) => section.items.map((item) => item.to))
    expect([...routes].sort()).toEqual([...SCREENS].sort())
  })

  it('keeps the bot’s keys, console and accounts away from staff, but not its health', () => {
    const admin = sectionsFor('staff').find((section) => section.id === 'admin')!
    const routes = admin.items.map((item) => item.to)
    expect(routes).toContain('/system')
    expect(routes).toContain('/settings')
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
  it('gives a client their account only, for now', () => {
    expect(sectionsFor('client', { person: true }).flatMap((section) => section.items.map((item) => item.to))).toEqual(['/me'])
  })

  it('adds a person’s own sign-in to Admin, and not for the API key', () => {
    const admin = (person: boolean) => sectionsFor('staff', { person }).find((section) => section.id === 'admin')!.items.map((item) => item.to)
    expect(admin(true)[0]).toBe('/me')
    expect(admin(false)).not.toContain('/me')
  })
})
