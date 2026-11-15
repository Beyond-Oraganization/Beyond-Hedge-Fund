import { useCommand } from '../../api/bot.ts'
import { parsed, unreadable, type Parsed } from '../../api/parse/blocks.ts'
import type { CommandResult } from '../../api/types.ts'

/**
 * A client's money, as the bot's Fund module tells it (`portfolio --json`, `activity --json`; Fund/Portfolios.cs and
 * Fund/Activity.cs in Beyond-Bot-Bybit). Returns are fractions (0.021 is +2.1%) and leave deposits and withdrawals out
 * (ADR 0004); null means there are not yet two values to go between.
 */
export type Returns = { today: number | null; month: number | null; sinceStart: number | null }

/** One day of the value over time: the day's last value, the money put in (+) or taken out (−) that day. */
export type DayValue = { date: string; value: number; cashFlow: number; return: number | null }

export type CashFlow = { id: number; account: string; at: string; amount: number; kind: 'deposit' | 'withdrawal'; currency: string | null; source: string; note: string | null }

export type AccountPortfolio = {
  login: string
  currency: string | null
  /** Null until the fund has recorded the account's value once. */
  value: number | null
  valuedAt: string | null
  returns: Returns
  series: DayValue[]
  cashFlows: CashFlow[]
  /** Until when the broker was asked for deposits and withdrawals; null: not yet (an older bot has no such field). */
  cashFlowsConfirmedUntil: string | null
}

export type ActivityItem = { at: string; account: string; kind: 'close' | 'cashFlow' | 'strategy' | (string & {}); text: string; amount: number | null }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const str = (value: unknown) => (typeof value === 'string' ? value : null)

function readAccount(value: unknown): AccountPortfolio | null {
  if (!isObject(value) || typeof value.login !== 'string') return null
  const returns = isObject(value.returns) ? value.returns : {}
  const series = Array.isArray(value.series) ? value.series.filter(isObject) : []
  const flows = Array.isArray(value.cashFlows) ? value.cashFlows.filter(isObject) : []
  return {
    login: value.login,
    currency: str(value.currency),
    value: num(value.value),
    valuedAt: str(value.valuedAt),
    returns: { today: num(returns.today), month: num(returns.month), sinceStart: num(returns.sinceStart) },
    series: series.flatMap((day) => (typeof day.date === 'string' && num(day.value) !== null ? [{ date: day.date, value: num(day.value)!, cashFlow: num(day.cashFlow) ?? 0, return: num(day.return) }] : [])),
    cashFlows: flows.flatMap((flow) =>
      typeof flow.at === 'string' && num(flow.amount) !== null
        ? [{ id: num(flow.id) ?? 0, account: str(flow.account) ?? value.login as string, at: flow.at, amount: num(flow.amount)!, kind: num(flow.amount)! >= 0 ? ('deposit' as const) : ('withdrawal' as const), currency: str(flow.currency), source: str(flow.source) ?? '', note: str(flow.note) }]
        : [],
    ),
    cashFlowsConfirmedUntil: str(value.cashFlowsConfirmedUntil),
  }
}

/** `portfolio --json`: `{"accounts": [...]}`, one entry per account the person reaches. */
export function parsePortfolio(result: CommandResult): Parsed<AccountPortfolio[]> {
  const json = result.json
  if (!isObject(json) || !Array.isArray(json.accounts)) return unreadable('No accounts in the answer.')
  return parsed(json.accounts.map(readAccount).filter((account): account is AccountPortfolio => account !== null))
}

/** `activity --json`: newest first. */
export function parseActivity(result: CommandResult): Parsed<ActivityItem[]> {
  const json = result.json
  if (!Array.isArray(json)) return unreadable('No list of activity in the answer.')
  return parsed(
    json.filter(isObject).flatMap((item) =>
      typeof item.at === 'string' && typeof item.text === 'string'
        ? [{ at: item.at, account: str(item.account) ?? '', kind: str(item.kind) ?? '', text: item.text, amount: num(item.amount) }]
        : [],
    ),
  )
}

// Values are recorded hourly, so a minute is often enough; the last answer is kept for starting offline.
const READ = { refetchInterval: 60_000, staleTime: 30_000, persist: true } as const

export const usePortfolio = () => useCommand('portfolio', ['portfolio', '--json'], parsePortfolio, READ)
export const useActivity = (last = 50) => useCommand('activity', ['activity', '--last', String(last), '--json'], parseActivity, READ)

/**
 * Whether the deposits and withdrawals are known up to now: the bot asks the broker after each hour's values, so an
 * answer older than two hours (or none) means a recent deposit could still be counted as a gain.
 */
export function cashFlowsUnconfirmed(account: AccountPortfolio, now = Date.now()): boolean {
  if (!account.cashFlowsConfirmedUntil) return true
  return now - Date.parse(account.cashFlowsConfirmedUntil) > 2 * 3600_000
}
