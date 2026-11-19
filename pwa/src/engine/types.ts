import type { KellyEstimate, SessionSizing } from '../api/types.ts'

/**
 * The browser engine's JSON (the bot's Core/Backtesting/BacktestEngine.cs, compiled to WebAssembly): what the app
 * asks for, and what it answers. Field names and meanings are the bot's own.
 */

type Iso = string

/** The candles of one market on this device, as columns: open times in Unix seconds, then prices and volumes. */
export type CandleColumns = { time: Float64Array; open: Float64Array; high: Float64Array; low: Float64Array; close: Float64Array; volume: Float64Array }

/**
 * The candles of a request's conversion hops (engine 2.8.0 on): open times in Unix seconds and closes, one hop after
 * another in `request.conversion.hops` order (the bot's ADR 0007). Empty without a conversion.
 */
export type ConversionColumns = { time: number[]; close: number[] }

/** A market's costs as the engine takes them: price units, `commission` in percent a side, swaps in percent a year (−4 charges 4 %). */
export type CostsRequest = { spread?: number; slippage?: number; commission?: number; swapLong?: number; swapShort?: number }

/** When a signal fills: at its candle's close (the default) or the next candle's open. */
export type FillAt = 'Close' | 'NextOpen'

/** One market of a conversion; `count` 0 (or left out) for the backtested market itself. */
export type ConversionHop = { symbol: string; interval?: string; count?: number }

/** What `PlanConversion` takes: the symbol, the currency to measure in, and the markets this device has candles of. */
export type ConversionPlanRequest = { symbol: string; currency: string; markets: string[] }

export type ConversionPlanStep = { symbol: string; divide: boolean; ownMarket: boolean }

export type DeviceConversionPlan = { ok: true; engine: string; from: string; to: string; steps: ConversionPlanStep[] }

export type EngineRequest = {
  strategy: string
  symbol: string
  /** Interval code, e.g. "1h". */
  interval: string
  parameters?: Record<string, number>
  /** The rules, in order; none means the strategy's defaults. */
  rules?: string[]
  /** As `--sizing` takes it; the bot's default (half the balance) when left out. */
  sizing?: string
  /** For Kelly sizing: the `kelly` part of the bot's `kelly … --json` answer, so the device sizes as live trading would. */
  kelly?: NonNullable<SessionSizing['kelly']> | null
  balance?: number
  /** UTC, without "Z" or with it; the first candle when left out. */
  from?: Iso | null
  /** UTC; the last candle's close when left out. */
  to?: Iso | null
  /** For `simulate`: how the alternative price histories are made. Every worker of one run gets the same seed. */
  scenarios?: { method: PathMethod; seed: number } | null
  /** What cash earns a year, in percent, taken off both returns for alpha; 0 when left out. */
  riskFree?: number
  /** Engine 2.8.0 on: what each fill and night costs; none when left out. */
  costs?: CostsRequest | null
  fill?: FillAt
  /** A live budget's money: replaces the balance and limits the positions open at once. */
  budget?: number | null
  /** The currency to measure in and the markets that convert into it, whose candles go in the conversion columns. */
  conversion?: { currency: string; hops: ConversionHop[] } | null
}

/** How a Monte Carlo makes its alternative price histories (the bot's Core/Backtesting/PricePaths.cs). */
export type PathMethod = 'Bootstrap' | 'BrownianMotion'

export type EquityPoint = { time: Iso; balance: number }

/** One simulated position from open to close. `return` is the price move in its favour per unit (0.012 is +1.2 %). */
export type DeviceTrade = {
  side: 'Buy' | 'Sell'
  openedAt: Iso
  closedAt: Iso
  entryPrice: number
  exitPrice: number
  quantity: number
  profitLoss: number
  return: number
  balanceAfter: number
  overlapped: boolean
  /** Engine 2.8.0 on: what its costs took, and its return before them. */
  costs?: number
  grossReturn?: number
}

/**
 * One scenario's backtest (the real history's is scenario -1): its figures and its balance at 51 evenly spaced times
 * from the window's start to its end, the last being the final balance.
 */
export type ScenarioResult = {
  scenario: number
  finalBalance: number
  returnPercent: number
  /** Zero or negative. */
  maxDrawdownPercent: number
  trades: number
  winRate: number
  points: number[]
  /** The deepest fall of the equity marked at every candle (zero or negative); 0 from engines before 2.7.0. */
  equityDrawdownPercent?: number
  /** The Sharpe ratio a year; null without one, absent from engines before 2.7.0. */
  sharpe?: number | null
}

/** The closes of one scenario's path at the real answer's `priceTimes`. */
export type ScenarioPrices = { scenario: number; closes: number[] }

/** What one `simulate` call backtested: its share of the scenario numbers. */
export type DeviceScenarios = {
  ok: true
  engine: string
  method: PathMethod
  seed: number
  /** The bootstrap's mean block length, in candles; null for Brownian motion. */
  meanBlockLength: number | null
  /** Brownian motion's mean log return per candle; null for the bootstrap. */
  drift: number | null
  /** Brownian motion's spread of the log returns per candle; null for the bootstrap. */
  volatility: number | null
  results: ScenarioResult[]
  /** Scenarios 0 to 19 only, for the price-paths chart. */
  prices: ScenarioPrices[]
  computedMs: number
}

/** At `percentile` %, each column sorted on its own (a row is not one scenario); drawdowns are zero or negative. */
export type ScenarioPercentile = {
  percentile: number
  finalBalance: number
  returnPercent: number
  maxDrawdownPercent: number
  /** Engine 2.7.0 on. */
  equityDrawdownPercent?: number
  /** Engine 2.7.0 on; null when no scenario has a Sharpe ratio. */
  sharpe?: number | null
}

export type ScenarioSummary = {
  scenarios: number
  initialBalance: number
  endedAboveStart: number
  endedAboveStartPercent: number
  meanFinal: number
  medianFinal: number
  percentiles: ScenarioPercentile[]
  /** The share of scenarios whose final balance is below the real history's. */
  realBeatPercent: number
  /** The average balance over the scenarios at each of the 51 times. */
  meanPath: number[]
}

export type SummaryRequest = { initialBalance: number; real: ScenarioResult; results: ScenarioResult[] }

export type DeviceSummary = { ok: true; engine: string; summary: ScenarioSummary }

/** One day's dot: the market's return and the strategy's (its open positions valued at the close), as fractions. */
export type DayReturn = { day: string; asset: number; strategy: number; inMarket: boolean }

/**
 * How the strategy moved with its market: the least-squares line through one dot a day (the bot's
 * Core/Portfolio/MarketBeta.cs). Returns and rates are fractions; `alpha` is per day, `annualAlpha` × `daysPerYear`.
 */
/** How far alpha's t says it is more than luck (the bot's ADR 0008): |t| below 2, from 2, from 3. */
export type AlphaEvidence = 'Luck' | 'Suggestive' | 'Strong'

/** How far a probability that a Sharpe ratio is real convinces: below 0.80, from 0.80, from 0.95. */
export type SharpeEvidence = 'NotEvidence' | 'Promising' | 'Convincing'

export type MarketBeta = {
  days: number
  beta: number
  alpha: number
  annualAlpha: number
  rSquared: number
  correlation: number
  betaError: number
  alphaError: number
  /** Alpha ÷ its standard error; null when the line fits exactly. */
  alphaT: number | null
  daysPerYear: number
  inMarketPercent: number
  riskFree: number
  /** The 95 % intervals (engine 2.7.0 on): beta, and alpha a year. */
  betaLow?: number
  betaHigh?: number
  annualAlphaLow?: number
  annualAlphaHigh?: number
  /** Null when there is no t. */
  alphaEvidence?: AlphaEvidence | null
}

/**
 * The Sharpe ratio and the other figures of the daily returns (the bot's Core/Portfolio/ReturnStats.cs). Ratios are a
 * year, returns fractions (0.012 is +1.2 %).
 */
export type ReturnStats = {
  days: number
  daysPerYear: number
  riskFree: number
  meanExcess: number
  sharpePerDay: number
  sharpe: number
  sharpeError: number
  sharpeLow: number
  sharpeHigh: number
  /** The probability that the true Sharpe ratio is above 0. */
  psr: number
  psrEvidence: SharpeEvidence
  /** Null without a day below 0. */
  sortino: number | null
  volatility: number
  skew: number
  kurtosis: number
  lagOneAutocorrelation: number
  /** One day's return follows the day before's, so the yearly Sharpe ratio is approximate. */
  sharpeApproximate: boolean
  /** A bad day in 20 loses about this much (negative). */
  valueAtRisk: number
  expectedShortfall: number
}

export type RollingPoint = { day: string; beta: number | null; sharpe: number | null }

export type BuyAndHold = { returnPercent: number; maxDrawdownPercent: number; sharpe: number | null }

/** How far to trust beta and alpha (Core/Portfolio/MarketChecks.cs). */
export type MarketChecks = {
  /** Against the market the day before: a beta that survives points to look-ahead or stale prices. */
  lagged: MarketBeta | null
  firstHalf: MarketBeta | null
  secondHalf: MarketBeta | null
  informationRatio: number | null
  /** Beta and Sharpe over 90 days, every 5th day. */
  rolling: RollingPoint[]
  buyAndHold: BuyAndHold | null
}

/** What the closed trades say (Core/Backtesting/TradeStats.cs). */
export type TradeStats = {
  trades: number
  tradesPerYear: number
  averageHoldingDays: number
  profitFactor: number | null
  /** The mean trade return per unit of position value. */
  expectancyReturn: number
  winConcentration: number | null
  lossConcentration: number | null
  longProfitLoss: number
  shortProfitLoss: number
  /** The win rate a Sharpe ratio of 1 needs. */
  impliedPrecision: number | null
  chanceBelowPrecision: number | null
}

/** One fall of the equity below a peak; `recovered` is null when it had not got back. Percents are zero or negative. */
export type DrawdownEpisode = { peak: Iso; trough: Iso; recovered: Iso | null; depth: number; depthPercent: number; underwaterDays: number }

/** The equity's falls below its peak, marked at every candle, open losses included. */
export type DrawdownSummary = { maxDrawdown: number; maxDrawdownPercent: number; deepest: DrawdownEpisode[]; longest: DrawdownEpisode | null }

export type ExposureSummary = { mostOpenAtOnce: number; averageLeverage: number; maxLeverage: number; averageOpenWhenInMarket: number; inMarketPercent: number }

/** Everything a backtest is measured by after its replay (Core/Backtesting/BacktestAnalysis.cs, engine 2.7.0 on). */
export type BacktestAnalysis = {
  returns: ReturnStats | null
  returnsMissing: string | null
  /** Compound growth a year, a fraction; null for under a month. */
  cagr: number | null
  calmar: number | null
  checks: MarketChecks
  trades: TradeStats
  drawdowns: DrawdownSummary
  exposure: ExposureSummary
  /** Each day's distance below the peak so far, in percent (zero or negative). */
  underwater: { day: string; percent: number }[]
  daysPerYear: number
  /** Engine 2.8.0 on: what the costs did; null without costs. */
  costs?: CostSensitivity | null
  kelly?: KellyFigures | null
  /** Open signals a budget had no room for. */
  skippedOpens?: number
  /** The currency every amount is in when the run converts; null for the market's quote. */
  currency?: string | null
  /** The run's conditions in one line; "" without any. */
  conditions?: string
}

/**
 * What a run's costs did (Core/Backtesting/BacktestAnalysis.cs): what they took, the Sharpe ratio at none, at these and at
 * twice them, and the multiple that brings it to 0 (approximate: the sizing does not follow the costs).
 */
export type CostSensitivity = {
  paid: number
  grossProfitLoss: number
  netProfitLoss: number
  sharpeWithout: number | null
  sharpe: number | null
  sharpeAtTwice: number | null
  breakEvenMultiple: number | null
  breakEvenMissing: string | null
}

/** Kelly before and after costs, and the net percent over the positions open together on average. */
export type KellyFigures = { gross: KellyEstimate; net: KellyEstimate; openTogether: number; concurrencyAdjustedPercent: number | null }

/** The equity at a day's end, its open positions valued at the day's last close. */
export type DailyEquityPoint = { day: string; equity: number; close: number; inMarket: boolean; costsToDate?: number; exposure?: number }

export type DeviceBacktest = {
  ok: true
  /** The engine’s version, e.g. "2.2.0". */
  engine: string
  strategy: string
  market: { symbol: string; interval: string }
  /** "length=20 spread=3 lines=2, rules: …", the bot's setup line. */
  setup: string
  parameters: Record<string, number>
  rules: string[]
  start: Iso
  end: Iso
  candles: number
  sizing: SessionSizing
  /** The Kelly criterion over this run's closed trades. */
  kelly: KellyEstimate
  initialBalance: number
  finalBalance: number
  profitLoss: number
  returnPercent: number
  closedTrades: number
  won: number
  lost: number
  winRate: number
  averagePerTrade: number
  bestTrade: number
  bestTradePercent: number
  maxDrawdown: number
  maxDrawdownPercent: number
  stillOpen: number
  equityCurve: EquityPoint[]
  trades: DeviceTrade[]
  /** The real history scored as the scenarios are, for ranking it among them. */
  realScenario: ScenarioResult
  /** The 51 times of every scenario's `points`. */
  pointTimes: Iso[]
  /** The candles the price-paths chart draws (at most 300), and the real closes at them. */
  priceTimes: Iso[]
  prices: number[]
  computedMs: number
  /** Beta and alpha against the market (engine 2.6.0 on); null when `marketBetaMissing` says why. */
  marketBeta: MarketBeta | null
  marketBetaMissing: string | null
  /** One dot a day after the first, for the scatter. */
  dailyReturns: DayReturn[]
  /** The final balance with the positions still open valued at the last close (engine 2.7.0 on). */
  finalEquity: number
  analysis: BacktestAnalysis
  dailyEquity: DailyEquityPoint[]
}

export type EngineFailure = { ok: false; engine: string; error: { message: string } }

/** The price levels a strategy's rules compare candles with (Core/Backtesting/BacktestEngine.cs Levels), times in Unix seconds. */
export type DeviceLevels = { ok: true; engine: string; strategy: string; lines: { name: string; points: { time: number; value: number }[] }[] }

export type LevelsAnswer = DeviceLevels | EngineFailure

export type EngineAnswer = DeviceBacktest | EngineFailure

export type SimulateAnswer = DeviceScenarios | EngineFailure

export type SummaryAnswer = DeviceSummary | EngineFailure

export type ConversionPlanAnswer = DeviceConversionPlan | EngineFailure
