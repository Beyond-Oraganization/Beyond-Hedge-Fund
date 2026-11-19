import { useCommand } from '../../api/bot.ts'
import { plainNumber, type StrategyInput } from '../../api/commands.ts'
import { parsed, unreadable, type Parsed } from '../../api/parse/blocks.ts'
import type { StrategyDefinition } from '../../api/parse/strategies.ts'
import type { CommandResult } from '../../api/types.ts'
import type { DeviceResult } from '../../backtest/runs.ts'
import { fmtCount, fmtPercent, fmtSignedPercent } from '../../format.ts'
import type { MenuSetup } from '../menu/menu.ts'

/**
 * Published backtests (`published list --json`, bot 2.4.0; Fund/PublishedBacktests.cs in Beyond-Bot-Bybit): the figures
 * staff showed everyone of how a menu setup was tested. `strategy` and `strategySetup` are empty for a client the fund
 * does not trust with its strategies.
 */
export type PublishedBacktest = {
  id: number
  setupId: number | null
  setupName: string | null
  title: string
  note: string | null
  strategy: string
  market: string
  strategySetup: string
  sizing: string
  from: string
  to: string
  candles: number | null
  initialBalance: number
  finalBalance: number
  returnPercent: number
  trades: number
  wins: number
  losses: number
  winRate: number
  maxDrawdownPercent: number
  backtestId: number | null
  publishedBy: string
  publishedAt: string
  updatedAt: string
  /** Sharpe, beta, alpha (a fraction a year) and the marked drawdown, bot 2.7.0 on; null when none was given. */
  measures: PublishedMeasures | null
}

export type PublishedMeasures = { sharpe: number | null; psr: number | null; beta: number | null; annualAlpha: number | null; alphaT: number | null; equityDrawdownPercentage: number | null }

function measuresOf(value: unknown): PublishedMeasures | null {
  if (!isObject(value)) return null
  const m = { sharpe: num(value.sharpe), psr: num(value.psr), beta: num(value.beta), annualAlpha: num(value.annualAlpha), alphaT: num(value.alphaT), equityDrawdownPercentage: num(value.equityDrawdownPercentage) }
  return Object.values(m).some((v) => v != null) ? m : null
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const str = (value: unknown) => (typeof value === 'string' ? value : null)

export function parsePublished(result: CommandResult): Parsed<PublishedBacktest[]> {
  if (!Array.isArray(result.json)) return unreadable('No published backtests in the answer.')
  return parsed(
    result.json.filter(isObject).flatMap((p) =>
      typeof p.id === 'number' && typeof p.title === 'string' && typeof p.from === 'string' && typeof p.to === 'string'
        ? [{
            id: p.id, setupId: num(p.setupId), setupName: str(p.setupName), title: p.title, note: str(p.note), strategy: str(p.strategy) ?? '',
            market: str(p.market) ?? '', strategySetup: str(p.strategySetup) ?? '', sizing: str(p.sizing) ?? '', from: p.from, to: p.to,
            candles: num(p.candles), initialBalance: num(p.initialBalance) ?? 0, finalBalance: num(p.finalBalance) ?? 0, returnPercent: num(p.returnPercent) ?? 0,
            trades: num(p.trades) ?? 0, wins: num(p.wins) ?? 0, losses: num(p.losses) ?? 0, winRate: num(p.winRate) ?? 0,
            maxDrawdownPercent: num(p.maxDrawdownPercent) ?? 0, backtestId: num(p.backtestId), publishedBy: str(p.publishedBy) ?? '',
            publishedAt: str(p.publishedAt) ?? '', updatedAt: str(p.updatedAt) ?? '', measures: measuresOf(p.measures),
          }]
        : [],
    ),
  )
}

/** Every published backtest, newest first: everyone reads them, clients too. */
export const usePublished = () => useCommand('published', ['published', 'list', '--json'], parsePublished, { staleTime: 30_000, persist: true })

/** The newest published backtest of each menu setup, by its id. */
export function newestBySetup(published: PublishedBacktest[]): Map<number, PublishedBacktest> {
  const bySetup = new Map<number, PublishedBacktest>()
  for (const backtest of published) if (backtest.setupId != null && !bySetup.has(backtest.setupId)) bySetup.set(backtest.setupId, backtest)
  return bySetup
}

const day = (iso: string) => iso.slice(0, 10)

/** "Tested from 2024-01-01 to 2026-11-01: +41.20%, 86 trades, 59.3% of them won, deepest fall 9.4%." A client's words. */
export const testedWords = (p: PublishedBacktest) =>
  `Tested from ${day(p.from)} to ${day(p.to)}: ${fmtSignedPercent(p.returnPercent)}, ${fmtCount(p.trades)} trades, ${fmtPercent(p.winRate, 1)} of them won, deepest fall ${fmtPercent(p.maxDrawdownPercent, 1)}.`

const sameNumbers = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys({ ...a, ...b }).every((name) => a[name] === b[name])

/**
 * Whether a backtest on this device ran exactly what the menu setup trades: its strategy and market, its parameters and
 * rules (the strategy's defaults for any left out) and its sizing. Only then may its figures stand for the setup.
 */
export function ranSetup(input: StrategyInput, setup: MenuSetup, definition: StrategyDefinition | undefined): boolean {
  if (input.strategy.toLowerCase() !== setup.strategy.toLowerCase()) return false
  if (`${input.symbol} ${input.interval}`.toUpperCase() !== setup.market.toUpperCase()) return false
  const defaults = Object.fromEntries((definition?.parameters ?? []).map((p) => [p.name, p.default]))
  if (!sameNumbers({ ...defaults, ...setup.parameters }, { ...defaults, ...input.params })) return false
  const defaultRules = definition?.rules?.defaults ?? []
  const rules = (list: string[] | undefined) => (list?.length ? list : defaultRules).map((rule) => rule.trim())
  if (rules(setup.rules).join('\n') !== rules(input.rules).join('\n')) return false
  return (input.sizing ?? definition?.sizing?.default ?? '') === setup.sizing
}

const utcText = (iso: string) => iso.replace(/(\.\d+)?Z$/, '')

/** `published add` with a device backtest's figures, for a menu setup it ran exactly. */
export function publishArgs(setupId: number, result: DeviceResult, words: { title: string; note: string }): string[] {
  return [
    'published', 'add', '--setup', String(setupId), '--title', words.title,
    ...(words.note.trim() ? ['--note', words.note.trim()] : []),
    // Without the "Z": the bot reads these times as UTC, and .NET would turn a "Z" into the server's local time first.
    '--from', utcText(result.start), '--to', utcText(result.end), '--candles', String(result.candles),
    '--initial', plainNumber(result.initialBalance), '--final', plainNumber(result.finalBalance),
    '--trades', String(result.closedTrades), '--wins', String(result.won), '--losses', String(result.lost),
    '--drawdown', plainNumber(Math.round(result.maxDrawdownPercent * 10_000) / 10_000),
    ...measureArgs(result),
    '--json',
  ]
}

/** Sharpe, beta and alpha of a run from engine 2.7.0 on, as `published add` takes them (bot 2.7.0 on); none for older runs. */
function measureArgs(result: DeviceResult): string[] {
  const returns = result.analysis?.returns
  const beta = result.marketBeta
  const round = (value: number) => plainNumber(Math.round(value * 1e6) / 1e6)
  return [
    ...(returns ? ['--sharpe', round(returns.sharpe), '--psr', round(returns.psr)] : []),
    ...(beta ? ['--beta', round(beta.beta), '--alpha', round(beta.annualAlpha * 100), ...(beta.alphaT == null ? [] : ['--alpha-t', round(beta.alphaT)])] : []),
    ...(result.analysis ? ['--equity-drawdown', round(result.analysis.drawdowns.maxDrawdownPercent)] : []),
    ...(beta || returns ? ['--risk-free', round((beta?.riskFree ?? returns?.riskFree ?? 0) * 100)] : []),
  ]
}

/** `published update` of the words people read: the title, and the note (removed when empty). */
export const renameArgs = (id: number, words: { title: string; note: string }) => [
  'published', 'update', String(id), '--title', words.title.trim(), ...(words.note.trim() ? ['--note', words.note.trim()] : ['--no-note']), '--json',
]
