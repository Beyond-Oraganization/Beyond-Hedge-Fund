import { useCommand } from '../../api/bot.ts'
import { plainNumber, type StrategyInput } from '../../api/commands.ts'
import { parsed, unreadable, type Parsed } from '../../api/parse/blocks.ts'
import { parseStrategies } from '../../api/session.ts'
import type { CommandResult } from '../../api/types.ts'
import { configFromInput, type StrategyConfig } from '../../strategy/config.ts'

/**
 * The fund's strategy menu and each client's limits (`menu list --json`, `clients limits --json`; Fund/Menu.cs in
 * Beyond-Bot-Bybit). A setup is one strategy on one market with everything but the budget fixed, under a plain name.
 */
export type Risk = 'careful' | 'steady' | 'bold'
export type MenuSetup = {
  id: number
  name: string
  description: string
  risk: Risk
  strategy: string
  /** "XAUUSD 1h" */
  market: string
  parameters: Record<string, number>
  rules: string[]
  sizing: string
  backtestId: number | null
  withdrawn: boolean
  createdAt: string
}
/** A null limit is no limit; `updatedAt` is null when no limits were set (then the client may start nothing). */
export type ClientLimits = { client: number; setups: number[]; maxBudget: number | null; maxBudgetPercent: number | null; maxSessions: number | null; liveAllowed: boolean; updatedAt: string | null }

export const RISKS: { value: Risk; words: string }[] = [
  { value: 'careful', words: 'Careful: small positions, small swings' },
  { value: 'steady', words: 'Steady: moderate positions' },
  { value: 'bold', words: 'Bold: larger positions, larger swings' },
]
export const riskWord = (risk: string) => risk.charAt(0).toUpperCase() + risk.slice(1)

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const str = (value: unknown) => (typeof value === 'string' ? value : null)

export function parseMenu(result: CommandResult): Parsed<MenuSetup[]> {
  if (!Array.isArray(result.json)) return unreadable('No menu in the answer.')
  return parsed(
    result.json.filter(isObject).flatMap((s) =>
      typeof s.id === 'number' && typeof s.name === 'string'
        ? [{
            id: s.id, name: s.name, description: str(s.description) ?? '', risk: (['careful', 'steady', 'bold'].includes(s.risk as string) ? s.risk : 'steady') as Risk,
            strategy: str(s.strategy) ?? '', market: str(s.market) ?? '', parameters: isObject(s.parameters) ? (s.parameters as Record<string, number>) : {},
            rules: Array.isArray(s.rules) ? s.rules.filter((r): r is string => typeof r === 'string') : [], sizing: str(s.sizing) ?? '', backtestId: num(s.backtestId),
            withdrawn: s.withdrawn === true, createdAt: str(s.createdAt) ?? '',
          }]
        : [],
    ),
  )
}

export function parseLimits(result: CommandResult): Parsed<ClientLimits> {
  const j = result.json
  if (!isObject(j) || typeof j.client !== 'number') return unreadable('No limits in the answer.')
  return parsed({
    client: j.client, setups: Array.isArray(j.setups) ? j.setups.filter((id): id is number => typeof id === 'number') : [], maxBudget: num(j.maxBudget),
    maxBudgetPercent: num(j.maxBudgetPercent), maxSessions: num(j.maxSessions), liveAllowed: j.liveAllowed === true, updatedAt: str(j.updatedAt),
  })
}

export const useMenu = (all = false) => useCommand(all ? 'menu-all' : 'menu', ['menu', 'list', ...(all ? ['--all'] : []), '--json'], parseMenu, { staleTime: 10_000, persist: true })
export const useLimits = (client: number) => useCommand('limits', ['clients', 'limits', String(client), '--json'], parseLimits, { staleTime: 10_000 })
/** What trades on the account now (a client reads their own: `session strategies`). */
export const useMySessions = () => useCommand('my-sessions', ['session', 'strategies', '--json'], parseStrategies, { refetchInterval: 30_000, staleTime: 10_000, persist: true })

/** `menu add`: a setup from a strategy as the app's forms make it, with the words clients read. */
export function menuAddArgs(input: StrategyInput, words: { name: string; description: string; risk: Risk }): string[] {
  return [
    'menu', 'add', input.strategy, '--symbol', input.symbol, '--interval', input.interval,
    ...Object.entries(input.params).flatMap(([name, value]) => ['--set', `${name}=${plainNumber(value)}`]),
    ...(input.rules ?? []).flatMap((rule) => ['--rule', rule]),
    ...(input.sizing ? ['--sizing', input.sizing] : []),
    '--name', words.name, '--description', words.description, '--risk', words.risk,
  ]
}

/** A setup's sizing in words: "25% of the budget per position". */
export function sizingWords(sizing: string): string {
  const [method, value] = sizing.split(':')
  if (method === 'percent') return `${value}% of the budget per position`
  if (method === 'fixed') return `${value} per position`
  if (method === 'kelly') return `Kelly sizing${value ? ` (${value}% of it)` : ''}`
  return sizing
}

/** A backtest's setup handed over by Backtest's "Offer to clients" (`#/menu?offer=…`, its StrategyInput as base64url JSON). */
export const offerLink = (input: StrategyInput) => `/menu?offer=${btoa(JSON.stringify(input)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`

export function offered(param: string | null): StrategyConfig | null {
  if (!param) return null
  try {
    return configFromInput(JSON.parse(atob(param.replace(/-/g, '+').replace(/_/g, '/'))) as StrategyInput)
  } catch {
    return null
  }
}
