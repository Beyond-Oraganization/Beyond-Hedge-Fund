import type { IconName } from '../components/Icon.tsx'

/**
 * Who is using the app (docs/fund-app-redesign-plan.md, section 6, in Beyond-Bot-Bybit). Until the bot has
 * people with roles, whoever holds the API key is the owner. The client's own places come with their screens.
 */
export type Role = 'owner' | 'staff'

export type NavItem = { to: string; label: string; end?: boolean }
export type NavSection = { id: 'trading' | 'research' | 'admin'; label: string; icon: IconName; items: NavItem[] }

const TRADING: NavSection = {
  id: 'trading',
  label: 'Trading',
  icon: 'trading',
  items: [
    { to: '/', label: 'Account', end: true },
    { to: '/trading', label: 'Sessions' },
    { to: '/orders', label: 'Orders' },
  ],
}

const RESEARCH: NavSection = {
  id: 'research',
  label: 'Research',
  icon: 'markets',
  items: [
    { to: '/markets', label: 'Markets' },
    { to: '/backtest', label: 'Backtest' },
    { to: '/strategies', label: 'Strategies' },
  ],
}

const ADMIN_ITEMS: (NavItem & { ownerOnly?: boolean })[] = [
  { to: '/account', label: 'Trading accounts', ownerOnly: true },
  { to: '/connections', label: 'Connections', ownerOnly: true },
  { to: '/console', label: 'Console', ownerOnly: true },
  { to: '/system', label: 'System' },
  { to: '/settings', label: 'Settings' },
  { to: '/install', label: 'Install the app' },
]

/** The sections a role sees, in order. The server refuses what a role may not do; this only leaves it out. */
export function sectionsFor(role: Role): NavSection[] {
  const admin = ADMIN_ITEMS.filter((item) => role === 'owner' || !item.ownerOnly).map(({ to, label }) => ({ to, label }))
  return [TRADING, RESEARCH, { id: 'admin', label: 'Admin', icon: 'settings', items: admin }]
}

const matches = (item: NavItem, path: string) => (item.end ? path === item.to : path === item.to || path.startsWith(`${item.to}/`))

/** The section a screen belongs to (a market's chart is in Research, with Markets), or none (Connect). */
export const sectionOf = (sections: NavSection[], path: string) => sections.find((section) => section.items.some((item) => matches(item, path)))

/** The navigation item a path is at, if any. */
export const itemAt = (sections: NavSection[], path: string) => sections.flatMap((section) => section.items).find((item) => matches(item, path))
