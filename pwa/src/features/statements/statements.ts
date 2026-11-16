import { useCommand } from '../../api/bot.ts'
import { parsed, unreadable, type Parsed } from '../../api/parse/blocks.ts'
import type { CommandResult } from '../../api/types.ts'

/**
 * A client's monthly statement, as the bot's Fund module tells it (`statement --json`, `statement --list --json`;
 * Fund/Statements.cs in Beyond-Bot-Bybit). Money in the account's currency; returns are fractions (0.021 is +2.1%) and
 * leave deposits and withdrawals out (ADR 0004). A client gets their own; staff name the client.
 */
export type StatementTrade = { openedAt: string; closedAt: string; symbol: string; side: string; quantity: number; entryPrice: number; result: number | null; strategy: string | null }
export type StatementStrategy = { name: string | null; trades: number; wins: number; losses: number; result: number }
export type StatementFlow = { at: string; amount: number; note: string | null }

export type AccountStatement = {
  login: string
  currency: string | null
  opening: number | null
  openingAt: string | null
  closing: number | null
  closingAt: string | null
  deposits: number
  withdrawals: number
  /** What trading made: closing − opening − the money moved in and out. */
  change: number | null
  return: number | null
  /** The broker was asked for the month's deposits and withdrawals; until then the return is unconfirmed. */
  cashFlowsConfirmed: boolean
  trades: number
  wins: number
  losses: number
  realized: number
  strategies: StatementStrategy[]
  tradeList: StatementTrade[]
  cashFlows: StatementFlow[]
  events: { at: string; text: string }[]
}

export type StatementTotal = { currency: string; accounts: number; opening: number | null; closing: number | null; deposits: number; withdrawals: number; change: number | null; realized: number }

export type Statement = {
  clientId: number
  client: string
  month: string
  from: string
  to: string
  /** The month has ended; false: the statement so far. */
  isComplete: boolean
  generatedAt: string
  accounts: AccountStatement[]
  totals: StatementTotal[]
}

export type StatementMonths = { clientId: number; client: string; months: string[] }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const str = (value: unknown) => (typeof value === 'string' ? value : null)
const list = (value: unknown) => (Array.isArray(value) ? value.filter(isObject) : [])

function readAccount(value: Record<string, unknown>): AccountStatement | null {
  if (typeof value.login !== 'string') return null
  return {
    login: value.login,
    currency: str(value.currency),
    opening: num(value.opening),
    openingAt: str(value.openingAt),
    closing: num(value.closing),
    closingAt: str(value.closingAt),
    deposits: num(value.deposits) ?? 0,
    withdrawals: num(value.withdrawals) ?? 0,
    change: num(value.change),
    return: num(value.return),
    cashFlowsConfirmed: value.cashFlowsConfirmed === true,
    trades: num(value.trades) ?? 0,
    wins: num(value.wins) ?? 0,
    losses: num(value.losses) ?? 0,
    realized: num(value.realized) ?? 0,
    strategies: list(value.strategies).map((s) => ({ name: str(s.name), trades: num(s.trades) ?? 0, wins: num(s.wins) ?? 0, losses: num(s.losses) ?? 0, result: num(s.result) ?? 0 })),
    tradeList: list(value.tradeList).flatMap((t) =>
      typeof t.closedAt === 'string' && typeof t.symbol === 'string'
        ? [{ openedAt: str(t.openedAt) ?? t.closedAt, closedAt: t.closedAt, symbol: t.symbol, side: str(t.side) ?? '', quantity: num(t.quantity) ?? 0, entryPrice: num(t.entryPrice) ?? 0, result: num(t.result), strategy: str(t.strategy) }]
        : [],
    ),
    cashFlows: list(value.cashFlows).flatMap((f) => (typeof f.at === 'string' && num(f.amount) !== null ? [{ at: f.at, amount: num(f.amount)!, note: str(f.note) }] : [])),
    events: list(value.events).flatMap((e) => (typeof e.at === 'string' && typeof e.text === 'string' ? [{ at: e.at, text: e.text }] : [])),
  }
}

export function parseStatement(result: CommandResult): Parsed<Statement> {
  const json = result.json
  if (!isObject(json) || typeof json.month !== 'string' || !Array.isArray(json.accounts)) return unreadable('No statement in the answer.')
  return parsed({
    clientId: num(json.clientId) ?? 0,
    client: str(json.client) ?? '',
    month: json.month,
    from: str(json.from) ?? `${json.month}-01T00:00:00Z`,
    to: str(json.to) ?? '',
    isComplete: json.isComplete === true,
    generatedAt: str(json.generatedAt) ?? '',
    accounts: list(json.accounts).map(readAccount).filter((account): account is AccountStatement => account !== null),
    totals: list(json.totals).flatMap((t) =>
      typeof t.currency === 'string'
        ? [{ currency: t.currency, accounts: num(t.accounts) ?? 0, opening: num(t.opening), closing: num(t.closing), deposits: num(t.deposits) ?? 0, withdrawals: num(t.withdrawals) ?? 0, change: num(t.change), realized: num(t.realized) ?? 0 }]
        : [],
    ),
  })
}

export function parseStatementMonths(result: CommandResult): Parsed<StatementMonths> {
  const json = result.json
  if (!isObject(json) || !Array.isArray(json.months)) return unreadable('No months in the answer.')
  return parsed({ clientId: num(json.clientId) ?? 0, client: str(json.client) ?? '', months: json.months.filter((m): m is string => typeof m === 'string') })
}

const clientArgs = (client?: number) => (client == null ? [] : ['--client', String(client)])

// A finished month changes only when a cash flow is entered for it later: kept for starting offline, read again now and then.
const READ = { staleTime: 5 * 60_000, persist: true } as const

/** The months there are statements for, newest first. `client`: staff's choice; a client's own when left out. */
export const useStatementMonths = (client?: number) => useCommand('statement', ['statement', '--list', ...clientArgs(client), '--json'], parseStatementMonths, READ)

/** `month`: null asks nothing (an address that is not a month). */
export const useStatement = (month: string | null, client?: number) =>
  useCommand('statement', month == null ? null : ['statement', '--month', month, ...clientArgs(client), '--json'], parseStatement, READ)

/** "October 2026" for "2026-10". */
export function monthName(month: string): string {
  const [year, number] = month.split('-').map(Number)
  if (!year || !number) return month
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** True for "2026-10": what a route's month must look like before it is sent to the bot. */
export const isMonth = (value: string | undefined): value is string => !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
