import type { StrategyInput } from '../api/commands.ts'
import type { SessionSizing } from '../api/types.ts'
import type {
  BundleMarket,
  CandleColumns,
  CombinedResult,
  CombinedSimulateRequest,
  CombineRequest,
  DeviceBacktest,
  DeviceCombinedScenarios,
  EngineRequest,
  PathMethod,
  ScenarioSummary,
  SplitRule,
} from '../engine/types.ts'
import { fmtPercent } from '../format.ts'
import { db } from '../state/db.ts'
import type { StrategyConfig } from '../strategy/config.ts'
import { conditionErrors, conditionsRequest, quoteOf, readNumber, type ConditionErrors, type ConditionsForm } from './conditions.ts'
import type { PreparedConversion } from './prepare.ts'
import { dayTime } from './runs.ts'

/**
 * A combined backtest on this device (the bot's plan, Appendix A Part C; engine 2.9.0 on): several strategies, each on its
 * market with its own budget, backtested one by one in one currency and then added up by the engine's `Combine`. This
 * module is the screen's logic without React: the form, the requests, what a run keeps, and how it reads.
 */

export const MIN_LEGS = 2
export const MAX_LEGS = 8

/** One leg as the form holds it: a strategy setup, its budget, and its costs and fill (the currency is the combined one). */
export type LegForm = { id: string; label: string; config: StrategyConfig; budget: string; conditions: ConditionsForm }

/** How many alternative histories the combined Monte Carlo backtests the legs on; '0' is none. */
export const COMBINED_SCENARIOS = ['0', '100', '200', '500', '1000'] as const

/** The combined run's own settings; runs saved before engine 2.11.0 have no Monte Carlo fields. */
export type CombinedForm = { currency: string; riskFree: string; from: string; to: string; scenarios?: (typeof COMBINED_SCENARIOS)[number]; method?: PathMethod }

export const DEFAULT_COMBINED: Required<CombinedForm> = { currency: 'EUR', riskFree: '', from: '', to: '', scenarios: '0', method: 'Bootstrap' }

/** A saved form as the screen takes it: the fields a run saved before 2.11.0 lacks, at their defaults. */
export const formOf = (form: CombinedForm): Required<CombinedForm> => ({ ...DEFAULT_COMBINED, ...form })

/** "sample on XAUUSD 1h", or the name given. */
export const legName = (leg: LegForm) => leg.label.trim() || `${leg.config.strategy} on ${leg.config.market}`

export type LegErrors = ConditionErrors & { budget?: string; label?: string }

/** What is wrong with a leg beyond its strategy setup: its budget, its costs, a name another leg has. */
export function legErrors(leg: LegForm, others: LegForm[]): LegErrors {
  const errors: LegErrors = { ...conditionErrors(leg.conditions) }
  const budget = readNumber(leg.budget)
  if (budget == null || !(budget > 0)) errors.budget = 'The budget must be above 0.'
  if (others.some((other) => other.id !== leg.id && legName(other).toLowerCase() === legName(leg).toLowerCase())) errors.label = 'Another leg has this name; give this one its own.'
  return errors
}

/** What is wrong with the combined settings. */
export function combinedErrors(form: CombinedForm, legs: LegForm[]): Partial<Record<keyof CombinedForm | 'legs', string>> {
  const errors: Partial<Record<keyof CombinedForm | 'legs', string>> = {}
  if (legs.length < MIN_LEGS) errors.legs = `Add at least ${MIN_LEGS} legs to combine.`
  const riskFree = readNumber(form.riskFree)
  if (riskFree == null || riskFree < 0 || riskFree >= 100) errors.riskFree = 'A yearly percent from 0 to under 100.'
  if (form.from && form.to && form.from >= form.to) errors.to = 'The end must be after the start.'
  return errors
}

/** A UTC day ("2025-01-06") as the engine reads it, without "Z". */
const utcDay = (day: string) => (day ? `${day}T00:00:00` : null)

/** One leg's engine request: its setup, its budget as its starting money, its costs and fill, in the combined currency. */
export function legRequest(leg: LegForm, input: StrategyInput, kelly: SessionSizing['kelly'], form: CombinedForm, conversion: PreparedConversion['conversion']): EngineRequest {
  const budget = readNumber(leg.budget) ?? 0
  return {
    strategy: input.strategy,
    symbol: input.symbol,
    interval: input.interval,
    parameters: input.params,
    rules: input.rules,
    sizing: input.sizing,
    kelly,
    balance: budget,
    from: utcDay(form.from),
    to: utcDay(form.to),
    riskFree: readNumber(form.riskFree) ?? 0,
    ...conditionsRequest({ ...leg.conditions, currency: '' }, budget),
    ...(conversion ? { conversion } : {}),
  }
}

/** What `Combine` adds up: each leg's own backtest, its daily equity in the combined currency. */
export function combineRequest(form: CombinedForm, legs: LegForm[], answers: DeviceBacktest[]): CombineRequest {
  return {
    currency: form.currency,
    riskFree: readNumber(form.riskFree) ?? 0,
    legs: answers.map((answer, index) => ({
      label: legName(legs[index]!),
      symbol: answer.market.symbol,
      currency: answer.analysis.currency ?? quoteOf(answer.market.symbol) ?? form.currency,
      budget: answer.initialBalance,
      sizing: answer.sizing.method,
      dailyEquity: answer.dailyEquity,
    })),
  }
}

/** A leg's own figures, from its own backtest: what the combined report shows next to its shares. */
export type LegSummary = {
  name: string
  market: string
  setup: string
  conditions: string
  returnPercent: number
  sharpe: number | null
  sharpeLow: number | null
  sharpeHigh: number | null
  psr: number | null
  beta: number | null
  betaLow: number | null
  betaHigh: number | null
  rSquared: number | null
  annualAlpha: number | null
  alphaT: number | null
  /** The marked drawdown, zero or negative. */
  drawdownPercent: number
  costsPaid: number | null
  /** Each day's [time in ms, equity]. */
  equityDays: [number, number][]
}

export function legSummary(name: string, answer: DeviceBacktest): LegSummary {
  const returns = answer.analysis.returns
  const beta = answer.marketBeta
  return {
    name,
    market: `${answer.market.symbol} ${answer.market.interval}`,
    setup: answer.setup,
    conditions: answer.analysis.conditions ?? '',
    returnPercent: answer.finalEquity / answer.initialBalance * 100 - 100,
    sharpe: returns?.sharpe ?? null,
    sharpeLow: returns?.sharpeLow ?? null,
    sharpeHigh: returns?.sharpeHigh ?? null,
    psr: returns?.psr ?? null,
    beta: beta?.beta ?? null,
    betaLow: beta?.betaLow ?? null,
    betaHigh: beta?.betaHigh ?? null,
    rSquared: beta?.rSquared ?? null,
    annualAlpha: beta?.annualAlpha ?? null,
    alphaT: beta?.alphaT ?? null,
    drawdownPercent: answer.analysis.drawdowns.maxDrawdownPercent,
    costsPaid: answer.analysis.costs?.paid ?? null,
    equityDays: answer.dailyEquity.map((day) => [dayTime(day.day), day.equity]),
  }
}

/** One market's candles, to go in a column bundle. */
export type BundledMarket = { symbol: string; interval: string; candles: CandleColumns }

/**
 * Every market as one column bundle (the bot's ADR 0007): each column the markets' values one after another, and each
 * market's count, in the same order. A market given twice (two legs on XAUUSD 1h, or a leg's market that another leg
 * converts through) goes in once.
 */
export function bundleOf(markets: BundledMarket[]): { markets: BundleMarket[]; candles: CandleColumns } {
  const unique = markets.filter((market, index) => markets.findIndex((other) => other.symbol === market.symbol && other.interval === market.interval) === index)
  const total = unique.reduce((sum, market) => sum + market.candles.time.length, 0)
  const column = (name: keyof CandleColumns) => {
    const values = new Float64Array(total)
    let offset = 0
    for (const market of unique) {
      values.set(market.candles[name], offset)
      offset += market.candles[name].length
    }
    return values
  }
  return {
    markets: unique.map((market) => ({ symbol: market.symbol, interval: market.interval, count: market.candles.time.length })),
    candles: { time: column('time'), open: column('open'), high: column('high'), low: column('low'), close: column('close'), volume: column('volume') },
  }
}

/** What `SimulateCombined` runs: each leg's own request, as its backtest ran, over the bundle's markets. */
export function simulateRequest(form: CombinedForm, legs: LegForm[], requests: EngineRequest[], markets: BundleMarket[], seed: number): CombinedSimulateRequest {
  return {
    currency: form.currency,
    riskFree: readNumber(form.riskFree) ?? 0,
    legs: requests.map((request, index) => ({ label: legName(legs[index]!), request })),
    markets,
    scenarios: { method: formOf(form).method, seed },
  }
}

/** The combined Monte Carlo as this device keeps it. */
export type CombinedScenarios = {
  method: PathMethod
  seed: number
  meanBlockDays: number | null
  /** Brownian motion's correlations, with the markets they are between; null for the bootstrap. */
  correlations: { markets: string[]; values: number[][] } | null
  notes: string[]
  summary: ScenarioSummary
  /** The 51 times of the balance paths, in milliseconds. */
  times: number[]
  /** The real history's combined balance at those times. */
  real: number[]
  /** Every scenario's final balance, in scenario order. */
  finals: number[]
  /** Every scenario's balance at the 51 times; null where not kept (a browser keeps the summary only). */
  paths: number[][] | null
}

/** The engine's scenarios and their summary, as a run keeps them. */
export function keepCombinedScenarios(answer: DeviceCombinedScenarios, summary: ScenarioSummary, markets: BundleMarket[]): CombinedScenarios {
  return {
    method: answer.method,
    seed: answer.seed,
    meanBlockDays: answer.meanBlockDays,
    correlations: answer.correlations ? { markets: markets.map((market) => `${market.symbol} ${market.interval}`), values: answer.correlations } : null,
    notes: answer.notes,
    summary,
    times: answer.pointTimes.map((time) => Date.parse(time)),
    real: answer.real?.points ?? [],
    finals: answer.results.map((result) => result.finalBalance),
    paths: answer.results.map((result) => result.points),
  }
}

/** A combined run as this device keeps it: what was asked, each leg's own figures, the engine's combined answer, and its Monte Carlo (2.11.0 on). */
export type CombinedRun = {
  kind: 'combined'
  id: string
  at: number
  form: CombinedForm
  legs: LegForm[]
  summaries: LegSummary[]
  combined: CombinedResult
  engine: string
  monteCarlo?: CombinedScenarios | null
}

const runKey = (connectionId: string, id: string) => `combined:${connectionId}:${id}`

/**
 * Keeps a run on this device, beside the others of the connection. Every scenario's path (up to 1,000 × 51 numbers) is
 * kept only where this device keeps everything (the desktop app); a browser keeps where they ended.
 */
export const saveCombined = (connectionId: string, run: CombinedRun, { keepEverything }: { keepEverything: boolean }) =>
  db.set(runKey(connectionId, run.id), keepEverything || !run.monteCarlo ? run : { ...run, monteCarlo: { ...run.monteCarlo, paths: null } })

/** The connection's combined runs, oldest first. */
export async function loadCombined(connectionId: string): Promise<CombinedRun[]> {
  return (await db.prefixed<CombinedRun>(`combined:${connectionId}:`)).map(([, run]) => run).sort((a, b) => a.at - b.at)
}

export const removeCombined = (connectionId: string, id: string) => db.del(runKey(connectionId, id))

export const SPLIT_NAMES: Record<SplitRule, string> = {
  AsSet: 'As set',
  EqualMoney: 'Equal money',
  InverseVolatility: 'Equal risk (inverse volatility)',
  Hrp: 'Hierarchical risk parity',
}

/**
 * The combined backtest in plain sentences: how sure its Sharpe ratio is, how much the legs offset each other, and a leg
 * that carries far more of the risk than of the money.
 */
export function combinedVerdict(result: CombinedResult): string {
  const parts: string[] = []
  const returns = result.returns
  parts.push(
    returns
      ? `Sharpe ${returns.sharpe.toFixed(2)} [${returns.sharpeLow.toFixed(2)}, ${returns.sharpeHigh.toFixed(2)}], ${fmtPercent(returns.psr * 100, 0)} likely above 0.`
      : `No Sharpe ratio: ${result.returnsMissing ?? 'too few days'}.`,
  )
  const ratio = result.diversificationRatio
  if (ratio != null)
    parts.push(
      ratio >= 1.2
        ? `The legs offset each other’s swings: diversification ${ratio.toFixed(2)}.`
        : ratio >= 1.05
          ? `Some diversification (${ratio.toFixed(2)}).`
          : `Little diversification (${ratio.toFixed(2)}): the legs move together.`,
    )
  const heaviest = [...result.legs].filter((leg) => leg.riskShare != null).sort((a, b) => b.riskShare! - a.riskShare!)[0]
  if (heaviest && heaviest.riskShare! - heaviest.weight > 0.15)
    parts.push(`${heaviest.label[0]!.toUpperCase()}${heaviest.label.slice(1)} carries ${fmtPercent(heaviest.riskShare! * 100, 0)} of the risk with ${fmtPercent(heaviest.weight * 100, 0)} of the money.`)
  return parts.join(' ')
}
