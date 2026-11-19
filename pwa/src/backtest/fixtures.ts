import type { BacktestAnalysis, DeviceBacktest, DeviceScenarios, DeviceSummary, DeviceTrade, ReturnStats, ScenarioResult } from '../engine/types.ts'

/** Test data: engine answers as the bot's BacktestEngine.cs writes them. */

const trade = (ret: number, overlapped = false): DeviceTrade => ({
  side: 'Buy', openedAt: '2025-01-06T00:00:00Z', closedAt: '2025-01-06T01:00:00Z', entryPrice: 100, exitPrice: 100 * (1 + ret),
  quantity: 5, profitLoss: 500 * ret, return: ret, balanceAfter: 1000, overlapped,
})

const START = Date.parse('2025-01-06T00:00:00Z')
const HOUR = 3_600_000
/** The 51 times of the balance paths: two hours apart. */
const POINT_TIMES = Array.from({ length: 51 }, (_, point) => new Date(START + point * 2 * HOUR).toISOString())
const rising = (from: number, to: number) => Array.from({ length: 51 }, (_, point) => from + ((to - from) * point) / 50)

/** A scenario that ends at `final`, its balance rising (or falling) evenly to it. */
export const scenarioResult = (scenario: number, final: number): ScenarioResult => ({
  scenario, finalBalance: final, returnPercent: (final - 1000) / 10, maxDrawdownPercent: final < 1000 ? (final - 1000) / 10 : -0.5, trades: 2, winRate: 50, points: rising(1000, final),
})

/** The Sharpe ratio and its companions of the plan's eight-day worked example (docs/backtest-engine-plan.md, §B4). */
export const returnStats = (overrides: Partial<ReturnStats> = {}): ReturnStats => ({
  days: 8, daysPerYear: 261, riskFree: 0, meanExcess: 0.00175, sharpePerDay: 0.35775, sharpe: 5.78, sharpeError: 5.53, sharpeLow: -5.06, sharpeHigh: 16.62,
  psr: 0.836, psrEvidence: 'Promising', sortino: 13.52, volatility: 0.079, skew: 0.28, kurtosis: 2.17, lagOneAutocorrelation: -0.74, sharpeApproximate: true,
  valueAtRisk: -0.0043, expectedShortfall: -0.005,
  ...overrides,
})

/** An analysis as BacktestAnalysis.cs writes it: the eight days, a held loser, two trades. */
export const analysis = (overrides: Partial<BacktestAnalysis> = {}): BacktestAnalysis => ({
  returns: returnStats(),
  returnsMissing: null,
  cagr: 0.031,
  calmar: 0.62,
  checks: {
    lagged: null, firstHalf: null, secondHalf: null, informationRatio: 52.55,
    rolling: [{ day: '2025-04-05', beta: 0.6, sharpe: 1.1 }, { day: '2025-04-10', beta: 0.7, sharpe: 0.9 }],
    buyAndHold: { returnPercent: 8.9, maxDrawdownPercent: -10, sharpe: 0.4 },
  },
  trades: {
    trades: 2, tradesPerYear: 150, averageHoldingDays: 0.04, profitFactor: 1.98, expectancyReturn: 0.005, winConcentration: null, lossConcentration: null,
    longProfitLoss: 4.95, shortProfitLoss: 0, impliedPrecision: 0.639, chanceBelowPrecision: 0.45,
  },
  drawdowns: {
    maxDrawdown: -50, maxDrawdownPercent: -5,
    deepest: [{ peak: '2025-01-06T00:00:00Z', trough: '2025-01-07T00:00:00Z', recovered: '2025-01-09T00:00:00Z', depth: -50, depthPercent: -5, underwaterDays: 3 }],
    longest: { peak: '2025-01-06T00:00:00Z', trough: '2025-01-07T00:00:00Z', recovered: '2025-01-09T00:00:00Z', depth: -50, depthPercent: -5, underwaterDays: 3 },
  },
  exposure: { mostOpenAtOnce: 2, averageLeverage: 0.4, maxLeverage: 1, averageOpenWhenInMarket: 1.2, inMarketPercent: 60 },
  underwater: [{ day: '2025-01-06', percent: 0 }, { day: '2025-01-07', percent: -5 }, { day: '2025-01-08', percent: 0 }],
  daysPerYear: 261,
  ...overrides,
})

/** An engine answer as BacktestEngine.cs writes it: two trades, the second closed on the first's candle. */
export function deviceAnswer(overrides: Partial<DeviceBacktest> = {}): DeviceBacktest {
  return {
    ok: true, engine: '2.2.0', strategy: 'sample', market: { symbol: 'XAUUSD', interval: '1h' },
    setup: 'length=23 spread=1 lines=2, rules: open long on cross up below 1; close long on cross down below 1',
    parameters: { length: 23, spread: 1, lines: 2 }, rules: ['open long on cross up below 1', 'close long on cross down below 1'],
    start: '2025-01-06T00:00:00Z', end: '2025-01-10T04:00:00Z', candles: 100,
    sizing: { method: 'Percent', value: 50, kelly: null },
    kelly: { trades: 2, wins: 1, losses: 1, averageWin: 0.02, averageLoss: 0.01, winProbability: 0.5, lossProbability: 0.5, payoffRatio: 2, percent: 25, whyUnusable: 'only 2 closed trades (it needs at least 20)' },
    initialBalance: 1000, finalBalance: 1004.95, profitLoss: 4.95, returnPercent: 0.495, closedTrades: 2, won: 1, lost: 1, winRate: 50,
    averagePerTrade: 2.475, bestTrade: 10, bestTradePercent: 1, maxDrawdown: -5.05, maxDrawdownPercent: -0.5, stillOpen: 0,
    equityCurve: [{ time: '2025-01-06T05:00:00Z', balance: 1010 }, { time: '2025-01-06T05:00:00Z', balance: 1004.95 }],
    trades: [trade(0.02), trade(-0.01, true)],
    realScenario: scenarioResult(-1, 1004.95),
    pointTimes: POINT_TIMES,
    priceTimes: POINT_TIMES.slice(0, 3),
    prices: [2000, 2010, 2005],
    computedMs: 12,
    // The bot's worked example (docs/market-beta-plan.md): five days, beta 0.646, alpha +0.202 % a day.
    marketBeta: {
      days: 5, beta: 0.645614, alpha: 0.00201754, annualAlpha: 0.736404, rSquared: 0.993252, correlation: 0.996621,
      betaError: 0.0307226, alphaError: 0.000350292, alphaT: 5.75961, daysPerYear: 365, inMarketPercent: 60, riskFree: 0,
      betaLow: 0.585398, betaHigh: 0.70583, annualAlphaLow: 0.485813, annualAlphaHigh: 0.986995, alphaEvidence: 'Strong',
    },
    marketBetaMissing: null,
    dailyReturns: [[0.01, 0.008], [-0.005, -0.002], [0.02, 0.015], [-0.01, -0.004], [0.005, 0.006]].map(([asset, strategy], day) => ({
      day: `2025-01-0${day + 7}`, asset: asset!, strategy: strategy!, inMarket: day % 2 === 0,
    })),
    finalEquity: 1004.95,
    analysis: analysis(),
    dailyEquity: [1000, 950, 1004.95].map((equity, day) => ({ day: `2025-01-0${day + 6}`, equity, close: 2000 + day, inMarket: day === 1 })),
    ...overrides,
  }
}

/** Three scenarios by bootstrap: two ended above the start of 1,000. */
export function scenariosAnswer(overrides: Partial<DeviceScenarios> = {}): DeviceScenarios {
  return {
    ok: true, engine: '2.2.0', method: 'Bootstrap', seed: 7, meanBlockLength: 4.6, drift: null, volatility: null,
    results: [scenarioResult(0, 1020.1), scenarioResult(1, 1004.9), scenarioResult(2, 994.98)],
    prices: [{ scenario: 0, closes: [2000, 2020, 2030] }, { scenario: 1, closes: [2000, 1990, 1985] }, { scenario: 2, closes: [2000, 2001, 1970] }],
    computedMs: 30,
    ...overrides,
  }
}

/** The summary of {@link scenariosAnswer}, as the engine sums it up: the real history beat one of three. */
export function summaryAnswer(): DeviceSummary {
  return {
    ok: true, engine: '2.2.0',
    summary: {
      scenarios: 3, initialBalance: 1000, endedAboveStart: 2, endedAboveStartPercent: 66.66666666666667, meanFinal: 1006.66, medianFinal: 1004.9,
      percentiles: [5, 25, 50, 75, 95].map((percentile) => ({ percentile, finalBalance: 1000, returnPercent: 0, maxDrawdownPercent: -1 })),
      realBeatPercent: 66.66666666666667, meanPath: rising(1000, 1006.66),
    },
  }
}
