import { arrow, fmtCount, fmtElapsed, fmtMoney, fmtPercent, fmtSignedMoney, fmtSignedPercent, fmtTime, tone } from '../format.ts'
import { kellyBasisWords, sizingWords } from '../words.ts'
import { isDeviceRun, type DeviceResult, type SavedRun } from './runs.ts'
import { alphaTone, alphaWords, sharpeTone } from './verdict.ts'

export type Headline = { label: string; value: string; sub?: string; tone?: 'gain' | 'loss' | 'warn' | 'mute' | null }
export type FigureGroup = { title: string; rows: [label: string, value: string][] }

/**
 * A run's numbers as the Backtest page shows them: the headline figures, always on screen, and every figure grouped in a
 * table that starts closed. From engine 2.7.0 the headline is return, Sharpe, beta, alpha and the marked drawdown; runs
 * saved before have the four figures they had, and runs saved before backtests moved to the device fewer still.
 */
export function figuresOf(run: SavedRun): { headline: Headline[]; groups: FigureGroup[] } {
  if (!isDeviceRun(run)) return legacyFigures(run)
  const r = run.result
  // Engine 2.8.0 on: every amount is in the currency the run was measured in, when it converted.
  const cur = r.analysis?.currency ?? ''
  const before = deviceFigures(r, cur)
  if (!r.analysis) return before
  const [result, trades, , market, sizing, about] = before.groups
  const costs = costRows(r, cur)
  return {
    headline: measuredHeadline(r, cur),
    groups: [
      result!,
      ...(costs.length ? [{ title: 'Costs', rows: costs }] : []),
      { title: 'Risk-adjusted', rows: riskAdjustedRows(r) },
      market!,
      { title: 'Risk', rows: riskRows(r, cur) },
      { ...trades!, rows: [...trades!.rows, ...tradeRows(r, cur)] },
      { ...sizing!, rows: [...sizing!.rows, ...kellyRows(r)] },
      { ...about!, rows: r.analysis.conditions ? [...about!.rows, ['Conditions', r.analysis.conditions]] : about!.rows },
    ],
  }
}

/** What the costs took and how much more the run could bear (engine 2.8.0 on); none without costs. */
function costRows(r: DeviceResult, cur: string): [label: string, value: string][] {
  const costs = r.analysis?.costs
  if (!costs) return []
  const sharpe = (value: number | null) => (value == null ? '–' : value.toFixed(2))
  return [
    ['Costs paid', `${fmtMoney(costs.paid, cur)} by the closed trades`],
    ['Before and after costs', `${fmtSignedMoney(costs.grossProfitLoss, cur)} before, ${fmtSignedMoney(costs.netProfitLoss, cur)} after`],
    ['Sharpe and the costs', `${sharpe(costs.sharpeWithout)} without costs, ${sharpe(costs.sharpe)} with these, ${sharpe(costs.sharpeAtTwice)} with twice`],
    [
      'Break-even',
      costs.breakEvenMultiple == null
        ? `none: ${costs.breakEvenMissing ?? ''}`
        : `the Sharpe ratio stays above 0 up to about ${costs.breakEvenMultiple.toFixed(1)}× these costs (approximate: the sizing does not follow them)`,
    ],
  ]
}

/** Kelly before costs next to after them, and per position open together (engine 2.8.0 on): what live sizing does not read. */
function kellyRows(r: DeviceResult): [label: string, value: string][] {
  const kelly = r.analysis?.kelly
  if (!kelly) return []
  const rows: [string, string][] = []
  if (r.analysis?.costs) rows.push(['Kelly before costs', kellyWords(kelly.gross)])
  if (kelly.openTogether >= 1.05 && kelly.concurrencyAdjustedPercent != null && !kelly.net.whyUnusable)
    rows.push([
      'Kelly per position',
      `${fmtPercent(kelly.concurrencyAdjustedPercent)} of the balance: Kelly over the ${kelly.openTogether.toFixed(1)} positions open together on average, which are nearly one bet`,
    ])
  return rows
}

const kellyWords = (kelly: DeviceResult['kelly']) =>
  kelly.whyUnusable ? `not usable: ${kelly.whyUnusable}` : `${fmtPercent(kelly.percent)} of the balance (win rate ${fmtPercent(kelly.winProbability * 100, 1)}, payoff ${kelly.payoffRatio?.toFixed(2) ?? '–'})`

/** The five figures a run from engine 2.7.0 on heads with. */
function measuredHeadline(r: DeviceResult, cur: string): Headline[] {
  const returns = r.analysis?.returns
  const beta = r.marketBeta
  const drawdowns = r.analysis!.drawdowns
  const longest = drawdowns.longest ? `under water ${fmtCount(drawdowns.longest.underwaterDays)} days at most` : 'never below a peak'
  const costs = r.analysis!.costs
  return [
    { label: 'Return', value: `${arrow(r.profitLoss)}${fmtSignedPercent(r.returnPercent)}`, sub: `${fmtSignedMoney(r.profitLoss, cur)}, final equity ${fmtMoney(r.finalEquity ?? r.finalBalance, cur)}${costs ? `, after ${fmtMoney(costs.paid, cur)} of costs` : ''}`, tone: tone(r.profitLoss) },
    returns
      ? { label: 'Sharpe a year', value: returns.sharpe.toFixed(2), sub: `[${returns.sharpeLow.toFixed(2)}, ${returns.sharpeHigh.toFixed(2)}] · ${fmtPercent(returns.psr * 100, 0)} likely above 0`, tone: sharpeTone(returns.psrEvidence) }
      : { label: 'Sharpe a year', value: '–', sub: r.analysis?.returnsMissing ?? undefined, tone: 'mute' },
    beta
      ? { label: `Beta to ${r.market.symbol}`, value: beta.beta.toFixed(2), sub: `${interval(beta.betaLow, beta.betaHigh)}R² ${beta.rSquared.toFixed(2)}` }
      : { label: `Beta to ${r.market.symbol}`, value: '–', sub: r.marketBetaMissing ?? undefined, tone: 'mute' },
    beta
      ? { label: 'Alpha a year', value: fmtSignedPercent(beta.annualAlpha * 100), sub: beta.alphaT == null ? undefined : `t ${beta.alphaT.toFixed(2)} · ${alphaWords(beta.alphaEvidence)}`, tone: alphaTone(beta.annualAlpha, beta.alphaEvidence) }
      : { label: 'Alpha a year', value: '–', tone: 'mute' },
    { label: 'Drawdown, marked', value: fmtPercent(drawdowns.maxDrawdownPercent), sub: longest, tone: drawdowns.maxDrawdownPercent < 0 ? 'loss' : null },
  ]
}

const interval = (low: number | undefined, high: number | undefined) => (low == null || high == null ? '' : `[${low.toFixed(2)}, ${high.toFixed(2)}] · `)

/** The Sharpe ratio and its companions. */
function riskAdjustedRows(r: DeviceResult): [label: string, value: string][] {
  const a = r.analysis!
  const returns = a.returns
  const rows: [string, string][] = []
  if (returns) {
    rows.push(
      ['Sharpe a year', `${returns.sharpe.toFixed(2)}, 95% between ${returns.sharpeLow.toFixed(2)} and ${returns.sharpeHigh.toFixed(2)}${returns.sharpeApproximate ? ' (approximate: one day’s return follows the day before’s)' : ''}`],
      ['Likely above 0', `${fmtPercent(returns.psr * 100, 1)} (the probabilistic Sharpe ratio, over ${fmtCount(returns.days)} days)`],
      ['Sortino a year', returns.sortino == null ? '– (no day below 0)' : returns.sortino.toFixed(2)],
      ['Volatility a year', fmtPercent(returns.volatility * 100)],
      ['Skew and kurtosis', `${returns.skew.toFixed(2)} and ${returns.kurtosis.toFixed(2)} (a normal spread has 0 and 3)`],
      ['A bad day in 20', `${fmtSignedPercent(returns.valueAtRisk * 100)} or worse; those days average ${fmtSignedPercent(returns.expectedShortfall * 100)}`],
    )
  } else rows.push(['Sharpe ratio', `none: ${a.returnsMissing ?? ''}`])
  rows.push(['Growth a year', a.cagr == null ? '– (under a month)' : fmtSignedPercent(a.cagr * 100)], ['Calmar', a.calmar == null ? '–' : a.calmar.toFixed(2)])
  return rows
}

/** The marked drawdowns and what was held. */
function riskRows(r: DeviceResult, cur: string): [label: string, value: string][] {
  const { drawdowns, exposure } = r.analysis!
  return [
    ['Drawdown, marked', `${fmtSignedMoney(drawdowns.maxDrawdown, cur)} (${fmtPercent(drawdowns.maxDrawdownPercent)}), open positions valued at every candle’s close`],
    ['Drawdown, closed', `${fmtSignedMoney(r.maxDrawdown, cur)} (${fmtPercent(r.maxDrawdownPercent)}), measured at the closes only`],
    ...drawdowns.deepest.map((episode, index): [string, string] => [
      `Fall ${index + 1}`,
      `${fmtPercent(episode.depthPercent)} from ${fmtTime(Date.parse(episode.peak))}, ${episode.recovered ? `back after ${fmtCount(episode.underwaterDays)} days` : `not back after ${fmtCount(episode.underwaterDays)} days`}`,
    ]),
    ['Held at once', `${fmtCount(exposure.mostOpenAtOnce)} positions at most; ${exposure.maxLeverage.toFixed(2)}× the equity at most, ${exposure.averageLeverage.toFixed(2)}× on average`],
  ]
}

/** What the closed trades say beyond the win rate. */
function tradeRows(r: DeviceResult, cur: string): [label: string, value: string][] {
  const t = r.analysis!.trades
  const rows: [string, string][] = [
    ['Profit factor', t.profitFactor == null ? '– (no loss)' : t.profitFactor.toFixed(2)],
    ['Expectancy', `${fmtSignedPercent(t.expectancyReturn * 100)} a trade, per position`],
    ['Long and short', `${fmtSignedMoney(t.longProfitLoss, cur)} long, ${fmtSignedMoney(t.shortProfitLoss, cur)} short`],
  ]
  if (r.analysis!.skippedOpens) rows.push(['Skipped opens', `${fmtCount(r.analysis!.skippedOpens)} open signals found no room in the budget`])
  if (t.impliedPrecision != null)
    rows.push([
      'Win rate needed',
      `${fmtPercent(t.impliedPrecision * 100, 1)} for a Sharpe of 1 at this payoff and ${fmtCount(t.tradesPerYear)} trades a year${t.chanceBelowPrecision == null ? '' : `; ${fmtPercent(t.chanceBelowPrecision * 100, 0)} chance the true one is below it`}`,
    ])
  return rows
}

/** The figures of a device run, as they were before engine 2.7.0 measured more. */
function deviceFigures(r: DeviceResult, cur = ''): { headline: Headline[]; groups: FigureGroup[] } {
  const signedPercent = (fraction: number) => fmtSignedPercent(fraction * 100)
  const kelly = kellyWords(r.kelly)
  const basis = kellyBasisWords(r.sizing)

  return {
    headline: [
      { label: 'Profit / loss', value: `${arrow(r.profitLoss)}${fmtSignedMoney(r.profitLoss, cur)}`, sub: fmtSignedPercent(r.returnPercent), tone: tone(r.profitLoss) },
      { label: 'Final balance', value: fmtMoney(r.finalBalance, cur), sub: `from ${fmtMoney(r.initialBalance, cur)}` },
      { label: 'Win rate', value: fmtPercent(r.winRate, 1), sub: `${fmtCount(r.closedTrades)} trades: ${fmtCount(r.won)} won, ${fmtCount(r.lost)} lost` },
      { label: 'Max drawdown', value: fmtPercent(r.maxDrawdownPercent), sub: fmtSignedMoney(r.maxDrawdown, cur), tone: r.maxDrawdown < 0 ? 'loss' : null },
    ],
    groups: [
      {
        title: 'Result',
        rows: [
          ['Starting balance', fmtMoney(r.initialBalance, cur)],
          ['Final balance', fmtMoney(r.finalBalance, cur)],
          ['Profit / loss', `${fmtSignedMoney(r.profitLoss, cur)} (${fmtSignedPercent(r.returnPercent)})`],
        ],
      },
      {
        title: 'Trades',
        rows: [
          ['Closed', `${fmtCount(r.closedTrades)}: ${fmtCount(r.won)} won, ${fmtCount(r.lost)} lost`],
          ['Win rate', fmtPercent(r.winRate, 1)],
          ['Average per trade', fmtSignedMoney(r.averagePerTrade, cur)],
          ['Best trade', `${fmtSignedMoney(r.bestTrade, cur)} (${fmtPercent(r.bestTradePercent)} of the balance)`],
          ['Average win', r.kelly.wins ? `${signedPercent(r.kelly.averageWin)} per position` : '–'],
          ['Average loss', r.kelly.losses ? `${signedPercent(-r.kelly.averageLoss)} per position` : '–'],
          ...(r.stillOpen ? ([['Still open', `${fmtCount(r.stillOpen)}, not counted in the balance`]] as [string, string][]) : []),
          ...(r.overlappingTrades ? ([['Overlapping', `${fmtCount(r.overlappingTrades)} of ${fmtCount(r.closedTrades)} trades were open at the same time as another`]] as [string, string][]) : []),
        ],
      },
      { title: 'Risk', rows: [['Max drawdown', `${fmtSignedMoney(r.maxDrawdown, cur)} (${fmtPercent(r.maxDrawdownPercent)})`]] },
      { title: 'Against the market', rows: marketRows(r) },
      {
        title: 'Sizing',
        rows: [
          ['Sizing', sizingWords(r.sizing)],
          ...(basis ? ([['Kelly from', `the bot’s ${basis}`]] as [string, string][]) : []),
          ['Kelly of this run', kelly],
        ],
      },
      {
        title: 'Run',
        rows: [
          ['Period', `${fmtTime(Date.parse(r.start))} → ${fmtTime(Date.parse(r.end))} UTC`],
          ['Candles', fmtCount(r.candles)],
          ['Parameters', Object.entries(r.parameters).map(([name, value]) => `${name}=${value}`).join(' ')],
          ['Rules, tried in order', r.rules.join('; ')],
          ['Ran on', `this device, engine ${r.engine}, in ${fmtElapsed(r.computedMs)}`],
        ],
      },
    ],
  }
}

/** Beta, alpha and how far to trust them; why there are none; or, for a run saved before 2.6.0, how to get them. */
function marketRows(r: DeviceResult): [label: string, value: string][] {
  const m = r.marketBeta
  if (m) {
    const riskFree = m.riskFree ? `, after ${fmtPercent(m.riskFree * 100)} a year risk-free` : ''
    const betaRange = m.betaLow == null || m.betaHigh == null ? '' : ` (95% between ${m.betaLow.toFixed(2)} and ${m.betaHigh.toFixed(2)})`
    const alphaRange =
      m.annualAlphaLow == null || m.annualAlphaHigh == null ? '' : ` (95% between ${fmtSignedPercent(m.annualAlphaLow * 100)} and ${fmtSignedPercent(m.annualAlphaHigh * 100)})`
    return [
      ['Beta', `${m.beta.toFixed(2)}: ${betaWords(m.beta)}${betaRange}`],
      ['Alpha', `${fmtSignedPercent(m.annualAlpha * 100)} a year${m.alphaT == null ? '' : `, t ${m.alphaT.toFixed(1)}`}${riskFree}${alphaRange}`],
      ['Fit', `R² ${m.rSquared.toFixed(2)} over ${fmtCount(m.days)} days`],
      ['In the market', `${fmtPercent(m.inMarketPercent, 0)} of days`],
      ...checkRows(r),
    ]
  }
  if (r.marketBetaMissing) return [['Beta and alpha', `none: ${r.marketBetaMissing}`]]
  return [['Beta and alpha', 'Run it again to see beta and alpha.']]
}

/** How far to trust beta and alpha: the lag check, the two halves, the information ratio and holding the market. */
function checkRows(r: DeviceResult): [label: string, value: string][] {
  const checks = r.analysis?.checks
  if (!checks) return []
  const rows: [string, string][] = []
  if (checks.lagged)
    rows.push(['Against the day before', `beta ${checks.lagged.beta.toFixed(2)}${Math.abs(checks.lagged.beta) > 0.2 && checks.lagged.rSquared > 0.1 ? ': look for look-ahead or stale prices' : ': none, as it should be'}`])
  if (checks.firstHalf && checks.secondHalf)
    rows.push(['Each half', `beta ${checks.firstHalf.beta.toFixed(2)} then ${checks.secondHalf.beta.toFixed(2)}; alpha ${fmtSignedPercent(checks.firstHalf.annualAlpha * 100)} then ${fmtSignedPercent(checks.secondHalf.annualAlpha * 100)} a year`])
  if (checks.informationRatio != null) rows.push(['Information ratio', `${checks.informationRatio.toFixed(2)} a year`])
  if (checks.buyAndHold)
    rows.push([
      'Holding the market',
      `${fmtSignedPercent(checks.buyAndHold.returnPercent)}, Sharpe ${checks.buyAndHold.sharpe?.toFixed(2) ?? '–'}, down ${fmtPercent(checks.buyAndHold.maxDrawdownPercent)} at most`,
    ])
  return rows
}

/** What a beta means in words: how much of the market's daily move the strategy moved with, or against. */
export function betaWords(beta: number): string {
  const share = fmtPercent(Math.abs(beta) * 100, 0)
  return beta < 0 ? `it moved against the market, by ${share} of its daily move` : `it moved with ${share} of the market’s daily move`
}

function legacyFigures(run: Exclude<SavedRun, { kind: 'device' }>): { headline: Headline[]; groups: FigureGroup[] } {
  const r = run.report
  return {
    headline: [
      { label: 'Profit / loss', value: `${arrow(r.profitLoss)}${fmtSignedMoney(r.profitLoss)}`, sub: fmtSignedPercent(r.returnPercent), tone: tone(r.profitLoss) },
      { label: 'Final balance', value: fmtMoney(r.finalBalance), sub: `from ${fmtMoney(r.initialBalance)}` },
      { label: 'Win rate', value: fmtPercent(r.winRate, 1), sub: `${fmtCount(r.trades)} trades: ${fmtCount(r.won)} won, ${fmtCount(r.lost)} lost` },
      { label: 'Max drawdown', value: fmtPercent(r.maxDrawdownPercent), sub: fmtSignedMoney(r.maxDrawdown), tone: r.maxDrawdown ? 'loss' : null },
    ],
    groups: [
      { title: 'Trades', rows: [['Average per trade', fmtSignedMoney(r.average)], ['Best trade', `${fmtSignedMoney(r.best)} (${fmtPercent(r.bestPercent)})`]] },
      { title: 'Sizing', rows: [['Sizing', r.sizing ?? '50% of the balance per position'], ...(r.kelly ? ([['Kelly', `${r.kelly.value} ${r.kelly.detail}`.trim()]] as [string, string][]) : [])] },
      {
        title: 'Run',
        rows: [
          ['Period', `${fmtTime(r.start)} → ${fmtTime(r.end)} UTC`],
          ['Candles', fmtCount(r.candles)],
          ['Parameters', r.parameters ?? ''],
          ['Rules, tried in order', r.rules.join('; ')],
          ['Ran on', `the bot${r.storedAs ? `, stored as backtest #${r.storedAs}` : ''}, in ${fmtElapsed(r.computedMs)}`],
        ],
      },
    ],
  }
}
