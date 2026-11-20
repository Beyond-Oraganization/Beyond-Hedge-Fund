import type { StrategyInput } from '../api/commands.ts'
import type { StrategyParameter } from '../api/parse/strategies.ts'
import type { EngineRequest, MarketSweepSummary, SweepAxis, SweepObjective, SweepProblem, SweepRequest, SweepSummary, SweepTrial, SweepVerdict } from '../engine/types.ts'
import { db } from '../state/db.ts'
import { conditionsRequest, readNumber, type ConditionsForm } from './conditions.ts'
import type { PreparedConversion } from './prepare.ts'

/**
 * A parameter sweep on this device (the bot's plan, Appendix A Part D; engine 2.10.0 on): one setup backtested with its
 * parameters varied, then summed up by the engine. This module is the screen's logic without React.
 */

export const MAX_TRIALS = 1000

/** How one parameter is varied: a list of values, or from, to and a step. Off leaves it at the setup's value. */
export type VaryForm = { on: boolean; mode: 'list' | 'range'; list: string; from: string; to: string; step: string }

export const NO_VARY: VaryForm = { on: false, mode: 'range', list: '', from: '', to: '', step: '' }

/** A sweep's own settings beside its base setup (the strategy form), its costs and its rule sets. */
export type SweepForm = {
  balance: string
  from: string
  to: string
  /** The share of the days held out, 10 to 50; ignored when `holdOutFrom` is set. */
  holdOutPercent: number
  holdOutFrom: string
  objective: SweepObjective
  minimumTrades: string
  /** The deepest fall allowed in sample, as a size (25 is −25 %); empty for none. */
  maxDrawdown: string
  /** Require gross profits above gross losses in sample, after costs. */
  profitFactor: boolean
  /** Count the trials of earlier sweeps of this setup's strategy and market in N. */
  countEarlier: boolean
}

export const DEFAULT_SWEEP: SweepForm = { balance: '1000', from: '', to: '', holdOutPercent: 30, holdOutFrom: '', objective: 'Sharpe', minimumTrades: '30', maxDrawdown: '', profitFactor: true, countEarlier: true }

export const OBJECTIVES: { value: SweepObjective; label: string }[] = [
  { value: 'Sharpe', label: 'Sharpe' },
  { value: 'Sortino', label: 'Sortino' },
  { value: 'Calmar', label: 'Calmar' },
  { value: 'AlphaT', label: 'Alpha’s t' },
]

/** A list of numbers as people type them: commas, semicolons or spaces between them. */
const listOf = (text: string) => text.split(/[\s,;]+/).filter(Boolean)

/** The values a varied parameter takes, checked against its range and whole-number rule; or what is wrong. */
export function valuesOf(vary: VaryForm, parameter: StrategyParameter): { values: number[] } | { error: string } {
  let values: number[]
  if (vary.mode === 'list') {
    const read = listOf(vary.list).map((text) => readNumber(text))
    if (!read.length) return { error: 'Give the values, e.g. 10, 20, 30.' }
    if (read.some((value) => value == null)) return { error: 'Type numbers, e.g. 10, 20, 30.' }
    values = read as number[]
  } else {
    const [from, to, step] = [readNumber(vary.from), readNumber(vary.to), readNumber(vary.step)]
    if (from == null || to == null || step == null || !vary.from.trim() || !vary.to.trim() || !vary.step.trim()) return { error: 'Give from, to and a step.' }
    if (!(step > 0)) return { error: 'The step must be above 0.' }
    if (to < from) return { error: '“To” must be at least “from”.' }
    const count = Math.floor((to - from) / step + 1e-9) + 1
    if (count > MAX_TRIALS) return { error: `That is ${count} values; a sweep runs at most ${MAX_TRIALS} trials.` }
    // Rounded to the step's decimals, so 0.1 steps do not drift to 0.30000000000000004.
    const decimals = (vary.step.split(/[.,]/)[1] ?? '').length
    values = Array.from({ length: count }, (_, i) => Number((from + i * step).toFixed(decimals)))
  }
  const outside = values.find((value) => value < parameter.min || value > parameter.max)
  if (outside != null) return { error: `${parameter.name} takes ${parameter.min} to ${parameter.max}; ${outside} is outside.` }
  if (parameter.whole && values.some((value) => !Number.isInteger(value))) return { error: `${parameter.name} takes whole numbers.` }
  if (new Set(values).size !== values.length) return { error: 'A value is there twice.' }
  return { values }
}

/** The varied parameters, in the strategy's order, and what is wrong with any of them. */
export function axesOf(vary: Record<string, VaryForm>, parameters: StrategyParameter[]): { axes: SweepAxis[]; errors: Record<string, string> } {
  const axes: SweepAxis[] = []
  const errors: Record<string, string> = {}
  for (const parameter of parameters) {
    const form = vary[parameter.name]
    if (!form?.on) continue
    const read = valuesOf(form, parameter)
    if ('error' in read) errors[parameter.name] = read.error
    else axes.push({ name: parameter.name, values: read.values })
  }
  return { axes, errors }
}

/** How many trials the axes and rule sets make. */
export const trialCount = (axes: SweepAxis[], ruleSets: number) => axes.reduce((count, axis) => count * axis.values.length, Math.max(1, ruleSets))

/** What is wrong with the sweep's own settings. */
export function sweepErrors(form: SweepForm, axes: SweepAxis[], ruleSets: number): Partial<Record<keyof SweepForm | 'vary', string>> {
  const errors: Partial<Record<keyof SweepForm | 'vary', string>> = {}
  if (!axes.length && ruleSets < 2) errors.vary = 'Vary a parameter, or try another rule set.'
  const trials = trialCount(axes, ruleSets)
  if (trials > MAX_TRIALS) errors.vary = `That is ${trials.toLocaleString('en')} trials; a sweep runs at most ${MAX_TRIALS.toLocaleString('en')}.`
  if (!((readNumber(form.balance) ?? 0) > 0)) errors.balance = 'The starting balance must be above 0.'
  if (form.from && form.to && form.from >= form.to) errors.to = 'The end must be after the start.'
  const trades = readNumber(form.minimumTrades)
  if (trades == null || trades < 0 || !Number.isInteger(trades)) errors.minimumTrades = 'A whole number of trades, 0 or more.'
  const drawdown = readNumber(form.maxDrawdown)
  if (form.maxDrawdown.trim() && (drawdown == null || drawdown <= 0 || drawdown > 100)) errors.maxDrawdown = 'A percent from above 0 to 100, e.g. 25.'
  return errors
}

/** The sweep as the engine takes it, over one market. */
export function sweepRequest(
  form: SweepForm,
  input: StrategyInput,
  conditions: ConditionsForm,
  axes: SweepAxis[],
  ruleSets: string[][],
  conversion: PreparedConversion['conversion'],
  earlierTrials: number,
  heatMap: { x: string; y: string } | null,
): SweepRequest {
  const balance = readNumber(form.balance) ?? 1000
  const base: EngineRequest = {
    strategy: input.strategy,
    symbol: input.symbol,
    interval: input.interval,
    parameters: input.params,
    rules: input.rules,
    sizing: input.sizing,
    balance,
    from: form.from ? `${form.from}T00:00:00` : null,
    to: form.to ? `${form.to}T00:00:00` : null,
    ...conditionsRequest({ ...conditions, currency: '' }, balance),
    ...(conversion ? { conversion } : {}),
  }
  const drawdown = form.maxDrawdown.trim() ? readNumber(form.maxDrawdown) : null
  return {
    base,
    vary: axes,
    ...(ruleSets.length > 1 ? { ruleSets } : {}),
    holdOut: form.holdOutFrom ? { from: form.holdOutFrom } : { sharePercent: form.holdOutPercent },
    objective: form.objective,
    constraints: { minimumTrades: readNumber(form.minimumTrades) ?? 30, maxDrawdownPercent: drawdown, profitFactorAboveOne: form.profitFactor },
    earlierTrials,
    heatMap,
  }
}

/**
 * About how long the trials take on this device: a trial replays its candles, about 0.34 s for 45,000 in one worker
 * (measured with engine 2.10.0), and the workers run them side by side.
 */
export const estimateSeconds = (trials: number, candles: number, workers: number, secondsPer45k = 0.34) =>
  Math.max(1, Math.round((trials * (candles / 45_000) * secondsPer45k) / Math.max(1, workers)))

/** "30 trials · about 25 s", or minutes when it takes longer. */
export function estimateWords(trials: number, seconds: number | null): string {
  const count = `${trials.toLocaleString('en')} ${trials === 1 ? 'trial' : 'trials'}`
  if (seconds == null) return count
  return `${count} · about ${seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`}`
}

/** Where the trials run so far for a strategy on a market are counted: what makes the deflated Sharpe ratio honest. */
const logKey = (connectionId: string, strategy: string, market: string) => `trial-log:${connectionId}:${strategy}:${market}`

export const readTrialLog = async (connectionId: string, strategy: string, market: string) => (await db.get<number>(logKey(connectionId, strategy, market))) ?? 0

export const addToTrialLog = async (connectionId: string, strategy: string, market: string, trials: number) =>
  db.set(logKey(connectionId, strategy, market), (await readTrialLog(connectionId, strategy, market)) + trials)

/** A trial as a saved sweep keeps it: without its daily returns, which only the summary reads. */
export type KeptTrial = Omit<SweepTrial, 'returns'>

/** A sweep as this device keeps it: what was asked, every market's trials, and the summary. */
export type SavedSweep = {
  kind: 'sweep'
  id: string
  at: number
  engine: string
  strategy: string
  request: SweepRequest
  axes: SweepAxis[]
  markets: { label: string; days: number; holdOutStart: number; trials: KeptTrial[]; problems: SweepProblem[] }[]
  summary: SweepSummary
}

/** A browser keeps the last 10 sweeps of a connection. */
export const KEPT_SWEEPS = 10

const sweepKey = (connectionId: string, id: string) => `sweeps:${connectionId}:${id}`

export const keepTrial = ({ returns: _returns, ...kept }: SweepTrial): KeptTrial => kept

export async function saveSweep(connectionId: string, sweep: SavedSweep): Promise<SavedSweep[]> {
  await db.set(sweepKey(connectionId, sweep.id), sweep)
  const all = await loadSweeps(connectionId)
  for (const old of all.slice(0, Math.max(0, all.length - KEPT_SWEEPS))) await db.del(sweepKey(connectionId, old.id))
  return all.slice(-KEPT_SWEEPS)
}

/** The connection's sweeps, oldest first. */
export async function loadSweeps(connectionId: string): Promise<SavedSweep[]> {
  return (await db.prefixed<SavedSweep>(`sweeps:${connectionId}:`)).map(([, sweep]) => sweep).sort((a, b) => a.at - b.at)
}

export const VERDICTS: Record<SweepVerdict, { title: string; tone: 'gain' | 'warn' | 'loss' | 'mute' }> = {
  Robust: { title: 'Robust', tone: 'gain' },
  Promising: { title: 'Promising, not proven', tone: 'warn' },
  LikelyOverfitted: { title: 'Likely overfitted', tone: 'loss' },
  NoEligibleTrial: { title: 'No trial qualified', tone: 'mute' },
}

/** "depth=23 deviation=2", the values a trial varied. */
export const trialWords = (trial: KeptTrial, axes: SweepAxis[]) => axes.map((axis) => `${axis.name}=${trial.parameters[axis.name] ?? '–'}`).join(' ')

const cell = (value: string | number | boolean | null | undefined) => {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Every trial of a market as CSV: its values, rule set, and figures in sample and in the hold-out. */
export function trialsCsv(trials: KeptTrial[], axes: SweepAxis[]): string {
  const figures = ['returnPercent', 'sharpe', 'psr', 'sortino', 'calmar', 'maxDrawdownPercent', 'trades', 'winRate', 'profitFactor', 'beta', 'alphaT'] as const
  const header = ['trial', ...axes.map((axis) => axis.name), 'ruleSet', ...figures.map((f) => `inSample.${f}`), ...figures.map((f) => `outOfSample.${f}`), 'eligible', 'notEligibleBecause']
  const rows = trials.map((trial) => [
    trial.index,
    ...axes.map((axis) => trial.parameters[axis.name]),
    trial.ruleSet + 1,
    ...figures.map((f) => trial.inSample[f]),
    ...figures.map((f) => trial.outOfSample[f]),
    trial.eligible,
    trial.notEligibleBecause,
  ])
  return [header, ...rows].map((row) => row.map(cell).join(',')).join('\n') + '\n'
}

/** The chosen trial of a market's summary, among its trials; null without one. */
export const chosenOf = (market: MarketSweepSummary, trials: KeptTrial[]) => (market.chosen ? (trials.find((trial) => trial.index === market.chosen!.index) ?? null) : null)

/** Trials sorted for the table: by an in-sample or hold-out figure, best first; ties by number. */
export function sortTrials(trials: KeptTrial[], by: 'inSample' | 'outOfSample' | 'index', objective: SweepObjective): KeptTrial[] {
  if (by === 'index') return [...trials].sort((a, b) => a.index - b.index)
  const value = (trial: KeptTrial) => {
    const figures = trial[by]
    const v = objective === 'Sharpe' ? figures.sharpe : objective === 'Sortino' ? figures.sortino : objective === 'Calmar' ? figures.calmar : figures.alphaT
    return v ?? Number.NEGATIVE_INFINITY
  }
  return [...trials].sort((a, b) => value(b) - value(a) || a.index - b.index)
}
