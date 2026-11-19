import { useMemo, useRef, useState } from 'react'
import { combinedVerdict, SPLIT_NAMES, type CombinedRun, type LegSummary } from '../../backtest/combined.ts'
import { dayTime } from '../../backtest/runs.ts'
import { alphaTone, alphaWords, sharpeTone } from '../../backtest/verdict.ts'
import type { CombinedLeg, CombinedResult } from '../../engine/types.ts'
import { arrow, fmtCount, fmtMoney, fmtPercent, fmtSignedMoney, fmtSignedPercent, tone } from '../../format.ts'
import { Chart } from '../Chart.tsx'
import { DataTable } from '../DataTable.tsx'
import { Segmented } from '../Field.tsx'
import { Callout, Figure } from '../ui.tsx'
import { ChartTip, useWidth } from './charting.tsx'

const ratio = (value: number | null | undefined, digits = 2) => (value == null ? '–' : value.toFixed(digits))
const share = (fraction: number | null | undefined) => (fraction == null ? '–' : fmtPercent(fraction * 100, 0))
const range = (low: number | null | undefined, high: number | null | undefined) =>
  low == null || high == null ? '' : ` [${low.toFixed(2)}, ${high.toFixed(2)}]`

/** The five figures a combined backtest heads with, and the sentence that reads them together. */
export function CombinedFigures({ run }: { run: CombinedRun }) {
  const c = run.combined
  const cur = c.currency
  const returns = c.returns
  const markets = c.markets
  return (
    <div className="stack-sm">
      <div className="figures">
        <Figure
          label="Return"
          value={`${arrow(c.profitLoss)}${fmtSignedPercent(c.returnPercent)}`}
          sub={`${fmtSignedMoney(c.profitLoss, cur)}, from ${fmtMoney(c.initialBalance, cur)}`}
          tone={tone(c.profitLoss)}
        />
        {returns ? (
          <Figure
            label="Sharpe a year"
            value={returns.sharpe.toFixed(2)}
            sub={`[${returns.sharpeLow.toFixed(2)}, ${returns.sharpeHigh.toFixed(2)}] · ${fmtPercent(returns.psr * 100, 0)} likely above 0`}
            tone={sharpeTone(returns.psrEvidence)}
          />
        ) : (
          <Figure label="Sharpe a year" value="–" sub={c.returnsMissing ?? undefined} tone="mute" />
        )}
        <Figure
          label="Diversification"
          value={ratio(c.diversificationRatio)}
          sub="Σ each leg’s swing ÷ the combined swing; 1 is none"
          tone={c.diversificationRatio == null ? 'mute' : null}
        />
        {markets ? (
          <Figure
            label="Alpha a year"
            value={fmtSignedPercent(markets.annualAlpha * 100)}
            sub={
              markets.alphaT == null
                ? 'after every market’s beta'
                : `t ${markets.alphaT.toFixed(2)} · ${alphaWords(markets.alphaEvidence)}, after every market’s beta`
            }
            tone={alphaTone(markets.annualAlpha, markets.alphaEvidence)}
          />
        ) : (
          <Figure label="Alpha a year" value="–" sub={c.marketsMissing ?? undefined} tone="mute" />
        )}
        <Figure
          label="Drawdown"
          value={fmtPercent(c.drawdowns.maxDrawdownPercent)}
          sub="at each day’s end"
          tone={c.drawdowns.maxDrawdownPercent < 0 ? 'loss' : null}
        />
      </div>
      <p className="p verdict">{combinedVerdict(c)}</p>
    </div>
  )
}

type LegRow = { summary: LegSummary; leg: CombinedLeg }

/** Each leg's own figures (from its own backtest) next to its shares of the combined one. */
export function LegsTable({ run }: { run: CombinedRun }) {
  const rows: LegRow[] = run.combined.legs.map((leg, index) => ({ leg, summary: run.summaries[index]! }))
  const cur = run.combined.currency
  return (
    <DataTable
      caption="The legs"
      rows={rows}
      rowKey={(row) => row.leg.label}
      columns={[
        {
          key: 'leg',
          header: 'Leg',
          card: 'title',
          wrap: true,
          render: (row) => (
            <span>
              <strong>{row.leg.label}</strong> <span className="hint">{row.summary.market}</span>
            </span>
          ),
        },
        {
          key: 'return',
          header: 'Return',
          card: 'sub',
          align: 'right',
          render: (row) => (
            <span className={tone(row.leg.profitLoss) ?? undefined}>{fmtSignedPercent(row.leg.returnPercent)}</span>
          ),
        },
        {
          key: 'sharpe',
          header: 'Sharpe [95%]',
          align: 'right',
          render: (row) => `${ratio(row.summary.sharpe)}${range(row.summary.sharpeLow, row.summary.sharpeHigh)}`,
        },
        { key: 'psr', header: 'Above 0', align: 'right', render: (row) => share(row.summary.psr) },
        {
          key: 'beta',
          header: 'Beta to own market',
          align: 'right',
          render: (row) => `${ratio(row.summary.beta)}${range(row.summary.betaLow, row.summary.betaHigh)}`,
        },
        {
          key: 'alpha',
          header: 'Alpha a year (t)',
          align: 'right',
          render: (row) =>
            row.summary.annualAlpha == null
              ? '–'
              : `${fmtSignedPercent(row.summary.annualAlpha * 100)}${row.summary.alphaT == null ? '' : ` (${row.summary.alphaT.toFixed(2)})`}`,
        },
        {
          key: 'drawdown',
          header: 'Drawdown, marked',
          align: 'right',
          render: (row) => fmtPercent(row.summary.drawdownPercent),
        },
        {
          key: 'costs',
          header: 'Costs paid',
          align: 'right',
          render: (row) => (row.summary.costsPaid == null ? '–' : fmtMoney(row.summary.costsPaid, cur)),
        },
        { key: 'money', header: 'Money', align: 'right', render: (row) => share(row.leg.weight) },
        { key: 'profit', header: 'Profit share', align: 'right', render: (row) => share(row.leg.profitShare) },
        { key: 'risk', header: 'Risk share', align: 'right', render: (row) => share(row.leg.riskShare) },
        {
          key: 'currency',
          header: 'Beta to its currency',
          align: 'right',
          render: (row) =>
            row.leg.currencyBeta ? `${row.leg.currencyBeta.beta.toFixed(2)} to ${row.leg.currencyBeta.name}` : '–',
        },
      ]}
    />
  )
}

/** The combined equity at each day's end, and each leg's beside it, one small chart each on the same days. */
export function CombinedEquity({ run }: { run: CombinedRun }) {
  const c = run.combined
  const points = useMemo(() => c.days.map((day) => ({ time: dayTime(day.day), value: day.equity })), [c.days])
  return (
    <div className="stack">
      <Chart
        lines={[{ name: 'Combined equity', points, width: 3 }]}
        label={`Combined equity at each day’s end, from ${fmtMoney(c.initialBalance, c.currency)} to ${fmtMoney(c.finalEquity, c.currency)}`}
        height={280}
      />
      <p className="hint">
        Each leg on its own, from its own first day; the combined line spans them all, a leg standing at its budget
        before it starts.
      </p>
      <div className="small-multiples">
        {run.summaries.map((leg) => (
          <figure key={leg.name} className="stack-sm">
            <figcaption className="label">{leg.name}</figcaption>
            <Chart
              lines={[{ name: leg.name, points: leg.equityDays.map(([time, value]) => ({ time, value })), width: 2 }]}
              label={`${leg.name}: equity from ${fmtMoney(leg.equityDays[0]?.[1], c.currency)} to ${fmtMoney(leg.equityDays.at(-1)?.[1], c.currency)}`}
              height={150}
            />
          </figure>
        ))}
      </div>
    </div>
  )
}

/** The combined daily return set against every traded market at once: one beta each, holding the others fixed. */
export function MarketBetas({ result }: { result: CombinedResult }) {
  const markets = result.markets
  if (!markets) return <p className="p">No betas: {result.marketsMissing}.</p>
  return (
    <div className="stack-sm">
      <DataTable
        caption="Beta to each market"
        rows={markets.loadings}
        rowKey={(row) => row.name}
        columns={[
          { key: 'market', header: 'Market', card: 'title', render: (row) => row.name },
          { key: 'beta', header: 'Beta', card: 'sub', align: 'right', render: (row) => row.beta.toFixed(2) },
          {
            key: 'range',
            header: '95% between',
            align: 'right',
            render: (row) => `${row.low.toFixed(2)} and ${row.high.toFixed(2)}`,
          },
          { key: 't', header: 't', align: 'right', render: (row) => ratio(row.t) },
        ]}
      />
      <p className="hint">
        Alpha after them {fmtSignedPercent(markets.annualAlpha * 100)} a year (95% between{' '}
        {fmtSignedPercent(markets.annualAlphaLow * 100)} and {fmtSignedPercent(markets.annualAlphaHigh * 100)}), R²{' '}
        {markets.rSquared.toFixed(2)} over {fmtCount(markets.days)} days.
      </p>
      {markets.merged.map((note) => (
        <p key={note} className="hint">
          {note}.
        </p>
      ))}
    </div>
  )
}

const CELL = 64
const HEAD = 26

/** A label cut to fit a chart's label column, whole when it fits. */
const cut = (label: string, characters: number) =>
  label.length > characters ? `${label.slice(0, characters - 1)}…` : label

/**
 * How the legs' daily returns moved together: one cell a pair, its value written in it, on a diverging scale (one hue
 * for moving together, another for moving apart, the page's own colour at 0). The worst days' matrix is a toggle away.
 */
export function CorrelationMatrix({ result }: { result: CombinedResult }) {
  const box = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const [which, setWhich] = useState<'all' | 'stress'>('all')
  const [hover, setHover] = useState<{ i: number; j: number; x: number; y: number } | null>(null)
  const correlation = result.correlation
  if (!correlation) return <p className="p">Too few days to measure how the legs moved together.</p>
  const values = which === 'stress' && correlation.stressValues ? correlation.stressValues : correlation.values
  const labels = correlation.labels
  const n = labels.length
  const left = Math.min(240, Math.max(120, width - n * CELL - 8))
  const height = HEAD + n * CELL + 4
  const fill = (value: number) => {
    const strength = Math.round(Math.min(1, Math.abs(value)) * 85)
    return `color-mix(in oklab, ${value >= 0 ? 'var(--grey-7)' : 'var(--warn-5)'} ${strength}%, var(--bg))`
  }
  const name = (i: number, j: number) => `${labels[i]} and ${labels[j]}: ${values[i]![j]!.toFixed(2)}`
  return (
    <div className="stack-sm">
      {correlation.stressValues ? (
        <Segmented
          name="correlation-days"
          legend="Measured on"
          value={which}
          onChange={setWhich}
          options={[
            { value: 'all', label: 'Every day' },
            { value: 'stress', label: `The ${fmtCount(correlation.stressDays)} worst days` },
          ]}
          hint="Correlations rise in a crash: the worst days show how much the legs really offset each other when it matters."
        />
      ) : null}
      <div ref={box} className="chart-box scroll-x" onPointerLeave={() => setHover(null)}>
        <svg
          width={Math.max(width, left + n * CELL)}
          height={height}
          role="img"
          aria-label={`Correlations of the legs’ daily returns, ${which === 'stress' ? 'on the worst days' : 'on every day'}: ${values.flatMap((row, i) => row.slice(i + 1).map((_, k) => name(i, i + 1 + k))).join('; ')}.`}
        >
          {labels.map((label, i) => (
            <g key={`label-${label}`}>
              <text
                x={left - 8}
                y={HEAD + i * CELL + CELL / 2 + 2}
                className="tick"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {`${i + 1} · ${cut(label, Math.floor((left - 30) / 7))}`}
              </text>
              <text x={left + i * CELL + CELL / 2} y={HEAD - 9} className="tick" textAnchor="middle">
                {i + 1}
              </text>
            </g>
          ))}
          {values.map((row, i) =>
            row.map((value, j) => (
              <g
                key={`${i}-${j}`}
                onPointerEnter={(event) =>
                  setHover({ i, j, x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY })
                }
              >
                <rect
                  x={left + j * CELL + 1}
                  y={HEAD + i * CELL + 1}
                  width={CELL - 2}
                  height={CELL - 2}
                  rx={4}
                  fill={i === j ? 'var(--line)' : fill(value)}
                />
                <text
                  x={left + j * CELL + CELL / 2}
                  y={HEAD + i * CELL + CELL / 2 + 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="cell-value"
                  fill={i !== j && Math.abs(value) > 0.55 ? 'var(--bg)' : 'var(--fg)'}
                >
                  {value.toFixed(2)}
                </text>
              </g>
            )),
          )}
        </svg>
        <ChartTip at={hover} width={width}>
          {hover ? (hover.i === hover.j ? `${labels[hover.i]}: itself` : name(hover.i, hover.j)) : null}
        </ChartTip>
      </div>
      <p className="hint">
        Columns are numbered as the rows. The darker the blue, the more the two legs rose and fell together (1 is in
        step); the darker the brown, the more they moved apart (−1 is always opposite). Near the page’s colour:
        unrelated, which is what spreads the risk.
      </p>
    </div>
  )
}

/** Each leg's share of the money next to its share of the risk: a leg whose risk bar outruns its money bar dominates the swings. */
export function ShareBars({ legs }: { legs: CombinedLeg[] }) {
  const box = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const label = Math.round(Math.min(240, Math.max(110, width * 0.32)))
  const plot = Math.max(80, width - label - 56)
  const row = 44
  const height = legs.length * row + 8
  const bar = (fraction: number) => Math.max(0, Math.min(1, fraction)) * plot
  return (
    <div className="stack-sm">
      <div className="legend" aria-hidden="true">
        <span className="key">
          <svg width={18} height={10}>
            <rect x={1} y={1} width={16} height={8} rx={2} fill="none" stroke="var(--fg)" strokeWidth={2} />
          </svg>
          Share of the money
        </span>
        <span className="key">
          <svg width={18} height={10}>
            <rect x={1} y={1} width={16} height={8} rx={2} fill="var(--fg)" />
          </svg>
          Share of the risk
        </span>
      </div>
      <div ref={box} className="chart-box">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Each leg’s share of the money and of the risk: ${legs.map((leg) => `${leg.label} ${share(leg.weight)} of the money, ${share(leg.riskShare)} of the risk`).join('; ')}.`}
        >
          {legs.map((leg, i) => {
            const y = i * row + 6
            return (
              <g key={leg.label}>
                <text x={label - 8} y={y + 15} className="tick" textAnchor="end" dominantBaseline="middle">
                  {cut(leg.label, Math.floor((label - 12) / 7))}
                </text>
                <rect
                  x={label}
                  y={y + 2}
                  width={Math.max(2, bar(leg.weight))}
                  height={12}
                  rx={3}
                  fill="none"
                  stroke="var(--fg)"
                  strokeWidth={2}
                />
                <text x={label + bar(leg.weight) + 6} y={y + 8} className="tick" dominantBaseline="middle">
                  {share(leg.weight)}
                </text>
                {leg.riskShare != null ? (
                  <>
                    <rect
                      x={label}
                      y={y + 18}
                      width={Math.max(2, bar(leg.riskShare))}
                      height={12}
                      rx={3}
                      fill="var(--fg)"
                    />
                    <text x={label + bar(leg.riskShare) + 6} y={y + 24} className="tick" dominantBaseline="middle">
                      {share(leg.riskShare)}
                    </text>
                  </>
                ) : null}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

/** The same total money split by each rule, each with how it would have done; exact only when every leg sizes by a percent or Kelly. */
export function BudgetSplits({ result }: { result: CombinedResult }) {
  if (!result.splits.length) return <p className="p">Too few days to work out other splits.</p>
  const labels = result.legs.map((leg) => leg.label)
  return (
    <DataTable
      caption="Budget splits"
      rows={result.splits}
      rowKey={(split) => split.rule}
      columns={[
        { key: 'rule', header: 'Split', card: 'title', wrap: true, render: (split) => SPLIT_NAMES[split.rule] },
        {
          key: 'weights',
          header: 'Money per leg',
          wrap: true,
          render: (split) => split.weights.map((weight, i) => `${labels[i]} ${share(weight)}`).join(' · '),
        },
        {
          key: 'return',
          header: 'Return',
          card: 'sub',
          align: 'right',
          render: (split) => fmtSignedPercent(split.returnPercent),
        },
        { key: 'sharpe', header: 'Sharpe', align: 'right', render: (split) => ratio(split.sharpe) },
        {
          key: 'drawdown',
          header: 'Drawdown',
          align: 'right',
          render: (split) => fmtPercent(split.maxDrawdownPercent),
        },
        { key: 'dr', header: 'Diversification', align: 'right', render: (split) => ratio(split.diversificationRatio) },
        {
          key: 'exact',
          header: 'Figures',
          render: (split) => (split.exact ? 'exact' : 'estimate: run it again at these budgets'),
        },
      ]}
    />
  )
}

/** What to bear in mind reading the combined backtest: the engine's notes and how often the legs were in the market together. */
export function CombinedNotes({ result }: { result: CombinedResult }) {
  return (
    <Callout label="Reading it">
      {result.notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      <p>
        A year counts{' '}
        {result.daysPerYear === 261
          ? '261 days: every leg trades on weekdays only'
          : '365 days: a leg trades every day'}
        . Held together at most {result.exposure.maxLeverage.toFixed(2)}× the combined equity (
        {fmtMoney(result.exposure.maxGross, result.currency)}), {result.exposure.averageLeverage.toFixed(2)}× on
        average.
      </p>
      {result.overlaps.length ? (
        <p>
          In the market on the same days:{' '}
          {result.overlaps
            .map((pair) => `${pair.first} and ${pair.second} ${fmtPercent(pair.bothInMarketPercent, 0)}`)
            .join('; ')}{' '}
          of the days.
        </p>
      ) : null}
    </Callout>
  )
}
