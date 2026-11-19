import { describe, expect, it } from 'vitest'
import { deviceAnswer, scenariosAnswer, summaryAnswer } from './fixtures.ts'
import { figuresOf } from './figures.ts'
import { curveByTime, endedAbove, keep, keepScenarios, kellyShare, type DeviceRun } from './runs.ts'

const run = (answer = deviceAnswer()): DeviceRun => ({
  kind: 'device', id: '1', at: 0, input: { strategy: 'sample', symbol: 'XAUUSD', interval: '1h', params: {} }, balance: 1000, from: null, to: null, scenarios: 3, method: 'Bootstrap', result: keep(answer),
})

describe('a device backtest as the page keeps it', () => {
  it('keeps each trade’s return, how many overlapped, and the balance curve in milliseconds', () => {
    const kept = keep(deviceAnswer())

    expect(kept.tradeReturns).toEqual([0.02, -0.01])
    expect(kept.overlappingTrades).toBe(1)
    expect(kept.curve[0]).toEqual([Date.parse('2025-01-06T05:00:00Z'), 1010])
  })

  it('keeps a Monte Carlo’s summary, each scenario’s final balance, and the real history’s path and prices beside its details', () => {
    const kept = keepScenarios(deviceAnswer(), scenariosAnswer(), summaryAnswer().summary)

    expect(kept.finals).toEqual([1020.1, 1004.9, 994.98])
    expect([kept.times.length, kept.real.length, kept.real.at(-1)]).toEqual([51, 51, 1004.95])
    expect([kept.priceTimes.length, kept.realPrices]).toEqual([3, [2000, 2010, 2005]])
    expect(kept.details?.paths).toHaveLength(3)
    expect(kept.details?.prices[0]).toEqual([2000, 2020, 2030])
  })

  it('says how many scenarios ended above the start, and by which method, for runs from before 2.2.0 too', () => {
    const now = { ...run(), monteCarlo: keepScenarios(deviceAnswer(), scenariosAnswer(), summaryAnswer().summary) }
    const before = { ...run(), result: { ...keep(deviceAnswer()), monteCarlo: { paths: 1000, endedAboveStartPercent: 61.2 } } }

    expect(endedAbove(now)).toEqual({ percent: 66.66666666666667, of: 3, method: 'bootstrap' })
    expect(endedAbove(before)).toEqual({ percent: 61.2, of: 1000, method: 'trade resampling' })
    expect(endedAbove(run())).toBeNull()
  })

  it('draws one point per time, the last balance when two trades closed on the same candle', () => {
    expect(curveByTime(keep(deviceAnswer()).curve)).toEqual([{ time: Date.parse('2025-01-06T05:00:00Z'), value: 1004.95 }])
  })

  it('reads how much of Kelly a sizing asks for', () => {
    expect([kellyShare('kelly'), kellyShare('kelly:50'), kellyShare('percent:50'), kellyShare(undefined)]).toEqual([100, 50, null, null])
  })
})

describe('the analysis as the page keeps it (2.7.0 on)', () => {
  it('keeps the analysis, and the marked equity and distance below the peak as [ms, value] pairs', () => {
    const kept = keep(deviceAnswer())

    expect(kept.analysis?.returns?.sharpe).toBe(5.78)
    expect(kept.finalEquity).toBe(1004.95)
    expect(kept.equityDays?.[1]).toEqual([Date.parse('2025-01-07T00:00:00Z'), 950])
    expect(kept.underwater?.[1]).toEqual([Date.parse('2025-01-07T00:00:00Z'), -5])
    expect(kept).not.toHaveProperty('dailyEquity')
    expect(kept.analysis).not.toHaveProperty('underwater')
  })
})

describe('beta and alpha as the page keeps them', () => {
  it('keeps the figures and each day as a [market, strategy] pair', () => {
    const kept = keep(deviceAnswer())

    expect(kept.marketBeta?.beta).toBeCloseTo(0.646, 3)
    expect(kept.dayDots).toEqual([[0.01, 0.008], [-0.005, -0.002], [0.02, 0.015], [-0.01, -0.004], [0.005, 0.006]])
    expect(kept).not.toHaveProperty('dailyReturns')
  })

  it('groups them under “Against the market”, worded by direction', () => {
    const rows = Object.fromEntries(figuresOf(run(deviceAnswer())).groups.find((group) => group.title === 'Against the market')!.rows)

    expect(rows).toEqual({
      Beta: '0.65: it moved with 65% of the market’s daily move (95% between 0.59 and 0.71)',
      Alpha: '+73.64% a year, t 5.8 (95% between +48.58% and +98.70%)',
      Fit: 'R² 0.99 over 5 days',
      'In the market': '60% of days',
      'Information ratio': '52.55 a year',
      'Holding the market': '+8.90%, Sharpe 0.40, down -10.00% at most',
    })
    const short = deviceAnswer({ marketBeta: { ...deviceAnswer().marketBeta!, beta: -0.32 } })
    expect(Object.fromEntries(figuresOf(run(short)).groups.find((group) => group.title === 'Against the market')!.rows).Beta).toMatch(
      /^-0\.32: it moved against the market, by 32% of its daily move/,
    )
  })

  it('says why there are none, and asks a run saved before 2.6.0 to be run again', () => {
    const none = deviceAnswer({ marketBeta: null, marketBetaMissing: 'only 2 days to compare, and it needs at least 3', dailyReturns: [] })
    const rowsOf = (r: DeviceRun) => figuresOf(r).groups.find((group) => group.title === 'Against the market')!.rows

    expect(rowsOf(run(none))).toEqual([['Beta and alpha', 'none: only 2 days to compare, and it needs at least 3']])
    const { marketBeta: _beta, marketBetaMissing: _missing, dayDots: _dots, ...before } = keep(deviceAnswer())
    expect(rowsOf({ ...run(deviceAnswer()), result: before })).toEqual([['Beta and alpha', 'Run it again to see beta and alpha.']])
  })
})

describe('the figures of a run', () => {
  it('heads with return, Sharpe, beta, alpha and the marked drawdown, and groups the rest', () => {
    const { headline, groups } = figuresOf(run())

    expect(headline.map((figure) => figure.label)).toEqual(['Return', 'Sharpe a year', 'Beta to XAUUSD', 'Alpha a year', 'Drawdown, marked'])
    expect(groups.map((group) => group.title)).toEqual(['Result', 'Risk-adjusted', 'Against the market', 'Risk', 'Trades', 'Sizing', 'Run'])
  })

  it('heads a run saved before engine 2.7.0 with the four figures it had', () => {
    const { analysis: _analysis, ...before } = keep(deviceAnswer())
    const { headline, groups } = figuresOf({ ...run(), result: before })

    expect(headline.map((figure) => figure.label)).toEqual(['Profit / loss', 'Final balance', 'Win rate', 'Max drawdown'])
    expect(groups.map((group) => group.title)).toEqual(['Result', 'Trades', 'Risk', 'Against the market', 'Sizing', 'Run'])
  })

  it('says why this run’s Kelly cannot be used, and counts overlapping trades', () => {
    const rows = new Map(figuresOf(run()).groups.flatMap((group) => group.rows))

    expect(rows.get('Kelly of this run')).toBe('not usable: only 2 closed trades (it needs at least 20)')
    expect(rows.get('Overlapping')).toBe('1 of 2 trades were open at the same time as another')
  })

  it('names the bot’s backtest a Kelly sizing came from', () => {
    const kelly = { estimate: deviceAnswer().kelly, shareOfKelly: 50, backtestId: 7, backtestedAt: '2026-11-08T12:00:00Z', from: '2019-01-02T00:00:00Z', to: '2026-11-08T12:00:00Z' }
    const rows = new Map(figuresOf(run(deviceAnswer({ sizing: { method: 'Kelly', value: 12.5, kelly } }))).groups.flatMap((group) => group.rows))

    expect(rows.get('Kelly from')).toMatch(/^the bot’s backtest #7/)
  })
})
