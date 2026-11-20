import { cmd, type StrategyInput } from '../api/commands.ts'
import type { SessionSizing } from '../api/types.ts'
import { readCopy, updateCopy, type Ask, type CopyInfo } from '../data/candles.ts'
import { fmtCount, fmtTime } from '../format.ts'
import type { Engine } from '../engine/engine.ts'
import type { CandleColumns, ConversionColumns, ConversionHop } from '../engine/types.ts'
import { hopsFor, requestHops, type PlannedHop, type StoredMarket } from './conditions.ts'
import { kellyShare } from './runs.ts'

/**
 * What a backtest needs before the engine runs, from the bot and this device: the market's candles brought up to date,
 * the Kelly basis the bot trades with when the sizing asks for Kelly, and a conversion's markets and their candles. One
 * backtest and every leg of a combined one get them the same way.
 */

/** What preparing is doing, for the screen's status line. */
export type PreparePhase = { step: 'candles'; market: string; info: CopyInfo | null } | { step: 'kelly'; market: string }

type Options = { signal?: AbortSignal; onPhase?: (phase: PreparePhase) => void }

/** "Copying XAUUSD 1h candles from the bot: 12,000, up to …", for the status line. */
export function prepareWords(phase: PreparePhase): string {
  if (phase.step === 'kelly') return 'Asking the bot for the Kelly sizing it would trade with…'
  return phase.info
    ? `Copying ${phase.market} candles from the bot: ${fmtCount(phase.info.count)}, up to ${fmtTime(phase.info.newest)} UTC…`
    : `Bringing this device’s ${phase.market} candles up to date…`
}

/** This device's copy of `market` ("XAUUSD 1h"), brought up to date with the bot first. */
export async function prepareCandles(connectionId: string, market: string, ask: Ask, { signal, onPhase }: Options = {}): Promise<CandleColumns> {
  onPhase?.({ step: 'candles', market, info: null })
  await updateCopy(connectionId, market, ask, { signal, onProgress: (info) => onPhase?.({ step: 'candles', market, info }) })
  const candles = await readCopy(connectionId, market)
  if (!candles) throw new Error(`This device has no ${market} candles.`)
  return candles
}

/** The Kelly basis the bot would trade the setup with (`kelly … --json`), when the sizing is Kelly; null otherwise. */
export async function prepareKelly(input: StrategyInput, ask: Ask, { signal, onPhase }: Options = {}): Promise<SessionSizing['kelly']> {
  const share = kellyShare(input.sizing)
  if (share == null) return null
  onPhase?.({ step: 'kelly', market: `${input.symbol} ${input.interval}` })
  const kelly = ((await ask(cmd.kelly(input, share), signal)).json as SessionSizing | null)?.kelly ?? null
  if (!kelly) throw new Error('The bot’s Kelly sizing could not be read.')
  return kelly
}

/**
 * The stored markets that turn the symbol's quote currency into `currency`, as the engine plans them, or why there are
 * none. The engine plans; this picks each market's shortest stored interval.
 */
export async function planRoute(engine: Engine, symbol: string, currency: string, stored: StoredMarket[], signal?: AbortSignal): Promise<{ hops: PlannedHop[] } | { error: string }> {
  const plan = await engine.planConversion({ symbol, currency, markets: [...new Set(stored.map((market) => market.symbol))] }, signal)
  if (!plan.ok) return { error: plan.error.message }
  const hops = hopsFor(plan.steps, stored)
  return hops ? { hops } : { error: `No stored market converts ${plan.from} into ${plan.to}.` }
}

export type PreparedConversion = {
  conversion: { currency: string; hops: ConversionHop[] } | null
  columns: ConversionColumns | undefined
  /** Each hop market's whole candles, apart from the leg's own: what a combined Monte Carlo bundles. */
  markets: { symbol: string; interval: string; candles: CandleColumns }[]
}

/**
 * The conversion of a run into `currency` (none for the market's own, or ''): the engine's plan, each hop's market copied up
 * to date on this device, and their candles one after another as the engine takes them.
 */
export async function prepareConversion(
  engine: Engine,
  connectionId: string,
  ask: Ask,
  symbol: string,
  currency: string,
  stored: StoredMarket[],
  { signal, onPhase }: Options = {},
): Promise<PreparedConversion> {
  if (!currency) return { conversion: null, columns: undefined, markets: [] }
  const planned = await planRoute(engine, symbol, currency, stored, signal)
  if ('error' in planned) throw new Error(planned.error)
  if (!planned.hops.length) return { conversion: null, columns: undefined, markets: [] }
  const columns: ConversionColumns = { time: [], close: [] }
  const counts: number[] = []
  const markets: PreparedConversion['markets'] = []
  for (const hop of planned.hops) {
    if (hop.market === 'own') {
      counts.push(0)
      continue
    }
    const copy = await prepareCandles(connectionId, `${hop.market.symbol} ${hop.market.interval}`, ask, { signal, onPhase })
    columns.time.push(...copy.time)
    columns.close.push(...copy.close)
    counts.push(copy.time.length)
    markets.push({ symbol: hop.market.symbol, interval: hop.market.interval, candles: copy })
  }
  return { conversion: { currency, hops: requestHops(planned.hops, counts) }, columns, markets }
}
