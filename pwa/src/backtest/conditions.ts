import type { MarketRow } from '../api/parse/markets.ts'
import type { ConversionHop, ConversionPlanStep, CostsRequest, FillAt } from '../engine/types.ts'

/**
 * How much like the broker a backtest trades (the bot's ADR 0006, engine 2.8.0 on): the market's costs, when a signal
 * fills, whether it holds no more positions than a live budget would, and the currency it is measured in. The form keeps
 * what was typed; {@link conditionsRequest} turns it into the engine's request fields.
 */
export type ConditionsForm = {
  /** In the market's price units (0.30 for gold). */
  spread: string
  slippage: string
  /** Percent of the notional on each side. */
  commission: string
  /** Percent a year of the notional, signed as brokers publish it: −4 charges 4 %. */
  swapLong: string
  swapShort: string
  fill: FillAt
  /** Trade like a live budget of the starting balance: no more positions at once than it has room for. */
  budgeted: boolean
  /** The currency to measure in; '' for the market's own. */
  currency: string
}

/** A market's costs as this device remembers them, typed as they were. */
export type MarketCosts = Pick<ConditionsForm, 'spread' | 'slippage' | 'commission' | 'swapLong' | 'swapShort'>

export const NO_COSTS: MarketCosts = { spread: '', slippage: '', commission: '', swapLong: '', swapShort: '' }

/** No conditions: how every backtest ran before engine 2.8.0, and gives the same figures. */
export const NO_CONDITIONS: ConditionsForm = { ...NO_COSTS, fill: 'Close', budgeted: false, currency: '' }

/** The currencies a run can be measured in, besides the market's own. */
export const CURRENCIES = ['EUR', 'USD', 'PLN', 'GBP', 'CHF'] as const

export type ConditionErrors = Partial<Record<keyof MarketCosts, string>>

/**
 * A number as people type it: a decimal comma or point, spaces between thousands, a minus sign or the typographic one.
 * Empty is 0; anything else unreadable is null.
 */
export function readNumber(text: string): number | null {
  const cleaned = text.trim().replace(/\s/g, '').replace('−', '-').replace(',', '.')
  if (!cleaned) return 0
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null
  return Number(cleaned)
}

/** What is wrong with the costs typed, in the bot's words and ranges (Core/Backtesting/TradingCosts.cs). */
export function conditionErrors(form: MarketCosts): ConditionErrors {
  const errors: ConditionErrors = {}
  const check = (key: keyof MarketCosts, ok: (value: number) => boolean, message: string) => {
    const value = readNumber(form[key])
    if (value == null) errors[key] = 'Type a number, e.g. 0.3.'
    else if (!ok(value)) errors[key] = message
  }
  check('spread', (value) => value >= 0, 'The spread is a price distance, 0 or more.')
  check('slippage', (value) => value >= 0, 'The slippage is a price distance, 0 or more.')
  check('commission', (value) => value >= 0 && value <= 10, 'The commission is a percent of the notional on each side, from 0 to 10.')
  check('swapLong', (value) => value >= -100 && value <= 100, 'A swap is a percent a year, from −100 to 100.')
  check('swapShort', (value) => value >= -100 && value <= 100, 'A swap is a percent a year, from −100 to 100.')
  return errors
}

/** The costs as the engine takes them; null when every one is 0, so the request stays as it was before 2.8.0. */
export function costsOf(form: MarketCosts): CostsRequest | null {
  const costs = {
    spread: readNumber(form.spread) ?? 0,
    slippage: readNumber(form.slippage) ?? 0,
    commission: readNumber(form.commission) ?? 0,
    swapLong: readNumber(form.swapLong) ?? 0,
    swapShort: readNumber(form.swapShort) ?? 0,
  }
  return Object.values(costs).some((value) => value !== 0) ? costs : null
}

/** The costs part of a form. */
export const costsPart = ({ spread, slippage, commission, swapLong, swapShort }: MarketCosts): MarketCosts => ({ spread, slippage, commission, swapLong, swapShort })

/**
 * The request fields of the conditions, only those that are not the default: a request without conditions is exactly
 * a 2.7.0 request. `budget` is the starting balance when the run trades like a budget.
 */
export function conditionsRequest(form: ConditionsForm, balance: number): { costs?: CostsRequest; fill?: FillAt; budget?: number } {
  const costs = costsOf(form)
  return {
    ...(costs ? { costs } : {}),
    ...(form.fill === 'NextOpen' ? { fill: 'NextOpen' as const } : {}),
    ...(form.budgeted ? { budget: balance } : {}),
  }
}

/** True when the form changes nothing about how the run trades. */
export const isPlain = (form: ConditionsForm) => !costsOf(form) && form.fill === 'Close' && !form.budgeted && !form.currency

/**
 * The currency a symbol is priced in, as its name spells it: six letters split three and three (XAUUSD is USD, EURPLN is
 * PLN), or a USDT or USDC ending. The engine reads it the same way (Core/Domain/CurrencyConversion.cs); null otherwise.
 */
export function quoteOf(symbol: string): string | null {
  const name = symbol.trim().toUpperCase()
  for (const quote of ['USDT', 'USDC']) if (name.length > quote.length && name.endsWith(quote)) return quote
  return /^[A-Z]{6}$/.test(name) ? name.slice(3) : null
}

/** A market this device can copy: its symbol and interval, and how long one of its candles is. */
export type StoredMarket = { symbol: string; interval: string; minutes: number }

/** How long a candle of an interval code is, in minutes ("15m", "4h", "1d", "1w"); unknown codes sort last. */
export function intervalMinutes(code: string): number {
  const match = /^(\d+)([mhdw])$/i.exec(code.trim())
  if (!match) return Number.POSITIVE_INFINITY
  return Number(match[1]) * { m: 1, h: 60, d: 1440, w: 10080 }[match[2]!.toLowerCase() as 'm' | 'h' | 'd' | 'w']
}

/** The bot's markets with an interval and candles, which this device can copy. */
export const storedMarkets = (rows: MarketRow[]): StoredMarket[] =>
  rows.filter((row) => row.interval && row.candles > 0).map((row) => ({ symbol: row.symbol, interval: row.interval!, minutes: intervalMinutes(row.interval!) }))

/** One hop of a planned conversion, with the stored market it reads ('own' for the backtested market itself). */
export type PlannedHop = { step: ConversionPlanStep; market: StoredMarket | 'own' }

/**
 * The stored market each step of the engine's plan reads: the backtested market itself, or the step's symbol at its
 * shortest stored interval, whose closes follow the rate most closely. Null when a step has no stored market.
 */
export function hopsFor(steps: ConversionPlanStep[], stored: StoredMarket[]): PlannedHop[] | null {
  const hops: PlannedHop[] = []
  for (const step of steps) {
    if (step.ownMarket) {
      hops.push({ step, market: 'own' })
      continue
    }
    const finest = stored.filter((market) => market.symbol.toUpperCase() === step.symbol.toUpperCase()).sort((a, b) => a.minutes - b.minutes)[0]
    if (!finest) return null
    hops.push({ step, market: finest })
  }
  return hops
}

/** The hops as the request names them, with how many candles of each the conversion columns hold. */
export const requestHops = (hops: PlannedHop[], counts: number[]): ConversionHop[] =>
  hops.map((hop, index) => (hop.market === 'own' ? { symbol: hop.step.symbol } : { symbol: hop.step.symbol, interval: hop.market.interval, count: counts[index] ?? 0 }))

/** "÷ EURUSD 4h", "÷ EURPLN (its own close)": how the rate is worked out, for the form's hint and the report. */
export const routeWords = (hops: PlannedHop[]) =>
  hops.map((hop) => `${hop.step.divide ? '÷' : '×'} ${hop.step.symbol}${hop.market === 'own' ? ' (its own close)' : ` ${hop.market.interval}`}`).join(' then ')

/** Where a market's costs are remembered on this device: per connection and symbol, since a broker prices a symbol the same on every interval. */
export const costsKey = (connectionId: string, symbol: string) => `costs:${connectionId}:${symbol.toUpperCase()}`
