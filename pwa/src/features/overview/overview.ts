import { useCommand } from '../../api/bot.ts'
import { parsed, unreadable, type Parsed } from '../../api/parse/blocks.ts'
import type { CommandResult } from '../../api/types.ts'

/** `fund overview --json` (Fund/FundOverview.cs in Beyond-Bot-Bybit): the fund at a glance for staff and the owner. */
export type OverviewTotal = { currency: string; value: number; today: number | null; accounts: number }
export type Severity = 'error' | 'warn' | 'info'
export type OverviewAlert = { severity: Severity; kind: string; text: string; account: string | null; client: number | null; session: string | null }
export type FundOverview = { at: string; totals: OverviewTotal[]; clients: number; accounts: number; sessions: number; alerts: OverviewAlert[] }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const str = (value: unknown) => (typeof value === 'string' ? value : null)
const SEVERITIES: Severity[] = ['error', 'warn', 'info']

export function parseOverview(result: CommandResult): Parsed<FundOverview> {
  const json = result.json
  if (!isObject(json) || !Array.isArray(json.totals) || !Array.isArray(json.alerts)) return unreadable('No overview in the answer.')
  return parsed({
    at: str(json.at) ?? '',
    totals: json.totals.filter(isObject).flatMap((t) => (typeof t.currency === 'string' && num(t.value) != null ? [{ currency: t.currency, value: num(t.value)!, today: num(t.today), accounts: num(t.accounts) ?? 0 }] : [])),
    clients: num(json.clients) ?? 0,
    accounts: num(json.accounts) ?? 0,
    sessions: num(json.sessions) ?? 0,
    alerts: json.alerts.filter(isObject).flatMap((a) =>
      typeof a.text === 'string'
        ? [{ severity: SEVERITIES.includes(a.severity as Severity) ? (a.severity as Severity) : 'info', kind: str(a.kind) ?? '', text: a.text, account: str(a.account), client: num(a.client), session: str(a.session) }]
        : [],
    ),
  })
}

// Values change hourly and alerts within minutes: a minute is often enough.
export const useOverview = () => useCommand('overview', ['fund', 'overview', '--json'], parseOverview, { refetchInterval: 60_000, staleTime: 30_000, persist: true })

/** Where an alert is fixed: the client's page, or Trading for an account's sessions. */
export function placeOf(alert: OverviewAlert): { to: string; label: string } | null {
  if (alert.client != null) return { to: `/clients/${alert.client}`, label: 'Open the client' }
  if (alert.kind === 'accountNoClient') return { to: '/clients', label: 'Link it to a client' }
  if (alert.session != null || alert.kind === 'waitingForSignIn' || alert.kind === 'notConnected') return { to: '/trading', label: 'Open Trading' }
  return null
}
