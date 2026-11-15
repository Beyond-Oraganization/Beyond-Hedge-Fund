import type { IconName } from '../components/Icon.tsx'
import type { PersonRole } from '../state/connections.ts'

/**
 * Who is using the app (docs/fund-app-redesign-plan.md, section 6, in Beyond-Bot-Bybit): a person's role from their
 * sign-in, or the owner for whoever connects with the API key. The bot refuses what a role may not run; this only
 * leaves it out.
 */
export type Role = PersonRole

export type NavItem = { to: string; label: string; end?: boolean }
export type NavSection = { id: 'overview' | 'trading' | 'clients' | 'research' | 'admin' | 'home' | 'activity' | 'account'; label: string; icon: IconName; items: NavItem[] }

/** A person's own sign-in: who they are, and signing out. */
const YOUR_SIGN_IN: NavItem = { to: '/me', label: 'Your sign-in' }

/** A client's places, one screen each (plan, section 7). Strategies joins them with the strategy menu (step 16). */
const CLIENT: NavSection[] = [
  { id: 'home', label: 'Home', icon: 'home', items: [{ to: '/home', label: 'Home' }] },
  { id: 'activity', label: 'Activity', icon: 'orders', items: [{ to: '/activity', label: 'Activity' }] },
  { id: 'account', label: 'Account', icon: 'account', items: [{ to: '/me', label: 'Your account' }] },
]

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

/** The fund at a glance (plan, section 7): staff's and the owner's first place. */
const OVERVIEW: NavSection = { id: 'overview', label: 'Overview', icon: 'overview', items: [{ to: '/overview', label: 'Overview' }] }

/** The fund's clients (plan, section 7): staff and the owner set them up and see what each sees. */
const CLIENTS: NavSection = { id: 'clients', label: 'Clients', icon: 'people', items: [{ to: '/clients', label: 'Clients' }] }

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
  { to: '/people', label: 'People', ownerOnly: true },
  { to: '/managed', label: 'Managed accounts' },
  { to: '/audit', label: 'Audit log' },
  { to: '/account', label: 'Trading accounts', ownerOnly: true },
  { to: '/connections', label: 'Connections', ownerOnly: true },
  { to: '/console', label: 'Console', ownerOnly: true },
  { to: '/system', label: 'System' },
  { to: '/settings', label: 'Settings' },
  { to: '/install', label: 'Install the app' },
]

/**
 * The sections a role sees, in order. `person` is a person's own sign-in (not the API key), which adds their sign-in page
 * to Admin.
 */
export function sectionsFor(role: Role, { person = false } = {}): NavSection[] {
  if (role === 'client') return CLIENT
  const admin = ADMIN_ITEMS.filter((item) => role === 'owner' || !item.ownerOnly).map(({ to, label }) => ({ to, label }))
  return [OVERVIEW, TRADING, CLIENTS, RESEARCH, { id: 'admin', label: 'Admin', icon: 'settings', items: person ? [YOUR_SIGN_IN, ...admin] : admin }]
}

const matches = (item: NavItem, path: string) => (item.end ? path === item.to : path === item.to || path.startsWith(`${item.to}/`))

/** The section a screen belongs to (a market's chart is in Research, with Markets), or none (Connect). */
export const sectionOf = (sections: NavSection[], path: string) => sections.find((section) => section.items.some((item) => matches(item, path)))

/** The navigation item a path is at, if any. */
export const itemAt = (sections: NavSection[], path: string) => sections.flatMap((section) => section.items).find((item) => matches(item, path))
