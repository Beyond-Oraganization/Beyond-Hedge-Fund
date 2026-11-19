import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { chosenOf, sortTrials, trialWords, VERDICTS, type KeptTrial } from '../../backtest/sweep.ts'
import { dayTime } from '../../backtest/runs.ts'
import type { MarketSweepSummary, SweepAxis, SweepObjective } from '../../engine/types.ts'
import { fmtCount, fmtPercent, fmtSignedPercent } from '../../format.ts'
import { Chart } from '../Chart.tsx'
import { DataTable } from '../DataTable.tsx'
import { Field } from '../Field.tsx'
import { Button, Callout, Figure } from '../ui.tsx'
import { useWidth } from './charting.tsx'

const ratio = (value: number | null | undefined, digits = 2) => (value == null ? '–' : value.toFixed(digits))
const OBJECTIVE_NAMES: Record<SweepObjective, string> = {
  Sharpe: 'Sharpe',
  Sortino: 'Sortino',
  Calmar: 'Calmar',
  AlphaT: 'alpha’s t',
}

/** The verdict and what decided it: the choice in and out of sample, the deflated Sharpe ratio, overfitting and the plateau. */
export function SweepVerdictBox({
  market,
  trials,
  axes,
}: {
  market: MarketSweepSummary
  trials: KeptTrial[]
  axes: SweepAxis[]
}) {
  const verdict = VERDICTS[market.verdict]
  const chosen = chosenOf(market, trials)
  const objective = OBJECTIVE_NAMES[market.objective]
  return (
    <div className="stack-sm">
      <div className="figures">
        <Figure
          label="Verdict"
          value={verdict.title}
          tone={verdict.tone}
          sub={market.chosen ? `trial ${market.chosen.index}: ${chosen ? trialWords(chosen, axes) : ''}` : undefined}
        />
        <Figure
          label={`${objective} in sample`}
          value={ratio(market.chosen?.inSampleObjective)}
          sub={
            market.chosen?.outOfSampleObjective == null
              ? 'none in the hold-out'
              : `${ratio(market.chosen.outOfSampleObjective)} in the hold-out, rank ${market.chosen.outOfSampleRank} of ${market.chosen.rankedOutOfSample}`
          }
        />
        <Figure
          label="Deflated Sharpe"
          value={market.deflated ? fmtPercent(market.deflated.dsr * 100, 0) : '–'}
          sub={
            market.deflated
              ? `against ${market.deflated.luckSharpe.toFixed(2)}, the best of ${fmtCount(market.deflated.trials)} worthless trials`
              : 'too few days'
          }
          tone={
            market.deflated
              ? market.deflated.evidence === 'Convincing'
                ? 'gain'
                : market.deflated.evidence === 'Promising'
                  ? 'warn'
                  : 'mute'
              : 'mute'
          }
        />
        <Figure
          label="Overfitting"
          value={market.overfitting ? fmtPercent(market.overfitting.pbo * 100, 0) : '–'}
          sub={
            market.overfitting
              ? `of ${fmtCount(market.overfitting.splits)} splits chose a trial below the median out of sample`
              : (market.crossValidatedMissing ?? undefined)
          }
          tone={
            market.overfitting
              ? market.overfitting.pbo < 0.1
                ? 'gain'
                : market.overfitting.pbo >= 0.5
                  ? 'loss'
                  : 'warn'
              : 'mute'
          }
        />
        <Figure
          label="Neighbours"
          value={
            market.plateau.kind === 'Unknown' ? '–' : market.plateau.kind === 'Mixed' ? 'Mixed' : market.plateau.kind
          }
          sub={
            market.plateau.score == null
              ? market.plateau.neighbours > 0
                ? 'no plateau to measure: the chosen trial did not make money in sample'
                : 'no neighbouring trial to compare'
              : `they do ${fmtPercent(market.plateau.score * 100, 0)} as well (${market.plateau.neighbours})`
          }
          tone={market.plateau.kind === 'Plateau' ? 'gain' : market.plateau.kind === 'Spike' ? 'loss' : 'mute'}
        />
      </div>
      <p className="p verdict">
        {verdict.title}: {market.reasons.join('; ')}. {fmtCount(market.eligible)} of {fmtCount(market.trials)} trials
        met the constraints in sample.
      </p>
    </div>
  )
}

/**
 * The objective over two parameters, the others at the chosen trial's values: each cell a button with its value written
 * in it, on a diverging scale around 0. Picking a cell selects its trial in the table.
 */
export function SweepHeatMap({
  market,
  selected,
  onSelect,
}: {
  market: MarketSweepSummary
  selected: number | null
  onSelect: (trial: number) => void
}) {
  const map = market.heatMap
  const [which, setWhich] = useState<'inSample' | 'outOfSample'>('inSample')
  if (!map)
    return (
      <p className="p">
        {market.chosen
          ? 'Vary two parameters to see a heat map.'
          : 'No trial qualified, so there is no chosen trial to centre a heat map on.'}
      </p>
    )
  const values = map.cells.map((cell) => cell[which]).filter((value): value is number => value != null)
  const top = Math.max(1e-9, ...values.map(Math.abs))
  const fill = (value: number | null) => {
    if (value == null) return 'transparent'
    const strength = Math.round(Math.min(1, Math.abs(value) / top) * 80)
    return `color-mix(in oklab, ${value >= 0 ? 'var(--grey-7)' : 'var(--warn-5)'} ${strength}%, var(--bg))`
  }
  const objective = OBJECTIVE_NAMES[market.objective]
  const describe = `${objective} ${which === 'inSample' ? 'in sample' : 'in the hold-out'} by ${map.x} (across) and ${map.y} (down); the other parameters at the chosen trial’s values.`
  return (
    <div className="stack-sm">
      <div className="seg" role="radiogroup" aria-label="Heat map of">
        {(['inSample', 'outOfSample'] as const).map((part) => (
          <label key={part}>
            <input type="radio" name="heat-map-part" checked={which === part} onChange={() => setWhich(part)} />
            <span>{part === 'inSample' ? 'In sample' : 'Hold-out'}</span>
          </label>
        ))}
      </div>
      <p className="hint">{describe}</p>
      <div className="heat-map-box">
        <table className="heat-map">
          <caption className="vh">{describe}</caption>
          <thead>
            <tr>
              <th scope="col">{`${map.y} \\ ${map.x}`}</th>
              {map.xValues.map((value) => (
                <th key={value} scope="col">
                  {value}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {map.yValues.map((yValue, y) => (
              <tr key={yValue}>
                <th scope="row">{yValue}</th>
                {map.xValues.map((xValue, x) => {
                  const cell = map.cells.find((c) => c.x === x && c.y === y)
                  const value = cell?.[which] ?? null
                  const strong = value != null && Math.abs(value) / top > 0.6
                  return (
                    <td key={xValue}>
                      {cell?.trial != null ? (
                        <button
                          type="button"
                          className={
                            cell.trial === selected
                              ? 'cell picked'
                              : cell.trial === market.chosen?.index
                                ? 'cell chosen'
                                : 'cell'
                          }
                          style={{ background: fill(value), color: strong ? 'var(--bg)' : 'var(--fg)' }}
                          aria-pressed={cell.trial === selected}
                          aria-label={`${map.x} ${xValue}, ${map.y} ${yValue}: ${ratio(value)}${cell.trial === market.chosen?.index ? ', the chosen trial' : ''}`}
                          onClick={() => onSelect(cell.trial!)}
                        >
                          {ratio(value)}
                        </button>
                      ) : (
                        <span className="cell empty">–</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Blue is above 0 and brown below, darker the further. A broad patch of similar values is a plateau, believable;
        one strong square among weak ones is a spike, probably fitted to noise. The chosen trial is outlined.
      </p>
    </div>
  )
}

type Sort = 'inSample' | 'outOfSample' | 'index'

/** Every trial, sortable, the eligible ones alone if wanted, 100 a page; the picked trial is marked and shown first. */
export function TrialsTable({
  trials,
  axes,
  market,
  selected,
}: {
  trials: KeptTrial[]
  axes: SweepAxis[]
  market: MarketSweepSummary
  selected: number | null
}) {
  const [sort, setSort] = useState<Sort>('inSample')
  const [eligibleOnly, setEligibleOnly] = useState(false)
  const [page, setPage] = useState(0)
  const ids = { sort: useId(), eligible: useId() }
  const rows = useMemo(() => {
    const sorted = sortTrials(eligibleOnly ? trials.filter((trial) => trial.eligible) : trials, sort, market.objective)
    const picked = sorted.find((trial) => trial.index === selected)
    return picked ? [picked, ...sorted.filter((trial) => trial !== picked)] : sorted
  }, [trials, eligibleOnly, sort, market.objective, selected])
  const pages = Math.max(1, Math.ceil(rows.length / 100))
  const shown = rows.slice(page * 100, page * 100 + 100)
  const mark = (trial: KeptTrial) =>
    [trial.index === market.chosen?.index ? 'chosen' : '', trial.index === selected ? 'picked' : '']
      .filter(Boolean)
      .join(', ')
  return (
    <div className="stack-sm">
      <div className="row wrap">
        <Field id={ids.sort} label="Sort by">
          <select id={ids.sort} value={sort} onChange={(event) => (setSort(event.target.value as Sort), setPage(0))}>
            <option value="inSample">{OBJECTIVE_NAMES[market.objective]} in sample</option>
            <option value="outOfSample">{OBJECTIVE_NAMES[market.objective]} in the hold-out</option>
            <option value="index">Trial number</option>
          </select>
        </Field>
        <label className="check" htmlFor={ids.eligible}>
          <input
            id={ids.eligible}
            type="checkbox"
            checked={eligibleOnly}
            onChange={(event) => (setEligibleOnly(event.target.checked), setPage(0))}
          />
          Only the trials that met the constraints
        </label>
      </div>
      <DataTable
        caption={`Trials on ${market.label}`}
        rows={shown}
        rowKey={(trial) => String(trial.index)}
        columns={[
          {
            key: 'trial',
            header: 'Trial',
            card: 'title',
            render: (trial) => (
              <span>
                #{trial.index}
                {mark(trial) ? <strong> · {mark(trial)}</strong> : null}
              </span>
            ),
          },
          {
            key: 'values',
            header: 'Values',
            wrap: true,
            render: (trial) => `${trialWords(trial, axes)}${trial.ruleSet ? ` · rules ${trial.ruleSet + 1}` : ''}`,
          },
          {
            key: 'isSharpe',
            header: 'Sharpe in',
            card: 'sub',
            align: 'right',
            render: (trial) => ratio(trial.inSample.sharpe),
          },
          {
            key: 'oosSharpe',
            header: 'Sharpe out',
            align: 'right',
            render: (trial) => ratio(trial.outOfSample.sharpe),
          },
          {
            key: 'isReturn',
            header: 'Return in',
            align: 'right',
            render: (trial) => fmtSignedPercent(trial.inSample.returnPercent),
          },
          {
            key: 'oosReturn',
            header: 'Return out',
            align: 'right',
            render: (trial) => fmtSignedPercent(trial.outOfSample.returnPercent),
          },
          {
            key: 'drawdown',
            header: 'Drawdown in',
            align: 'right',
            render: (trial) => fmtPercent(trial.inSample.maxDrawdownPercent),
          },
          { key: 'trades', header: 'Trades in', align: 'right', render: (trial) => fmtCount(trial.inSample.trades) },
          {
            key: 'pf',
            header: 'Profit factor in',
            align: 'right',
            render: (trial) => ratio(trial.inSample.profitFactor),
          },
          { key: 'alpha', header: 'Alpha t in', align: 'right', render: (trial) => ratio(trial.inSample.alphaT) },
          {
            key: 'kelly',
            header: 'Kelly in / out',
            align: 'right',
            render: (trial) =>
              `${trial.inSample.kellyNet.percent == null ? '–' : fmtPercent(trial.inSample.kellyNet.percent, 1)} / ${trial.outOfSample.kellyNet.percent == null ? '–' : fmtPercent(trial.outOfSample.kellyNet.percent, 1)}`,
          },
          {
            key: 'eligible',
            header: 'Eligible',
            wrap: true,
            render: (trial) => (trial.eligible ? 'yes' : (trial.notEligibleBecause ?? 'no')),
          },
        ]}
      />
      {pages > 1 ? (
        <div className="btn-row">
          <Button compact variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous 100
          </Button>
          <span className="hint">
            Page {page + 1} of {pages}
          </span>
          <Button compact variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>
            Next 100
          </Button>
        </div>
      ) : null}
    </div>
  )
}

const PLOT = { top: 16, right: 12, bottom: 28, left: 40 }

/** The overfitting checks drawn: where the winners' ranks fell, in sample against out of sample, and the CPCV paths. */
export function OverfittingPanel({ market }: { market: MarketSweepSummary }) {
  if (!market.overfitting || !market.cpcv)
    return <p className="p">No overfitting checks: {market.crossValidatedMissing}.</p>
  const o = market.overfitting
  return (
    <div className="stack">
      <div className="stack-sm">
        <h4 className="label">Where each split’s winner ranked out of sample</h4>
        <LogitHistogram bins={o.histogram} pbo={o.pbo} />
        <p className="hint">
          Each bar counts the splits whose in-sample winner landed there out of sample: left of the line is below the
          median. {fmtPercent(o.pbo * 100, 0)} fell left: under 10 % is good, over 50 % means choosing by backtest is
          worse than picking at random.
        </p>
      </div>
      <div className="stack-sm">
        <h4 className="label">The winners, in sample against out of sample</h4>
        <WinnersScatter points={o.points} slope={o.degradationSlope} />
        <p className="hint">
          Slope {o.degradationSlope.toFixed(2)}: well below 1 means most of the in-sample edge vanishes out of sample.
        </p>
      </div>
      <div className="stack-sm">
        <h4 className="label">Combinatorial purged cross-validation</h4>
        <p className="p">
          {market.cpcv.groups} groups, {market.cpcv.testGroups} tested at a time: {market.cpcv.splits.length} splits
          making {market.cpcv.pathSharpes.length} complete paths, each trial purged for its longest holding and{' '}
          {market.cpcv.embargoDays} days of embargo. Out-of-sample Sharpe of the paths:{' '}
          {market.cpcv.pathSharpes.map((sharpe) => sharpe.toFixed(2)).join(', ')}.
        </p>
        <PathDots sharpes={market.cpcv.pathSharpes} />
      </div>
    </div>
  )
}

function LogitHistogram({ bins, pbo }: { bins: number[]; pbo: number }) {
  const box = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const height = 180
  const plotW = width - PLOT.left - PLOT.right
  const plotH = height - PLOT.top - PLOT.bottom
  const top = Math.max(1, ...bins)
  const barW = plotW / bins.length
  const x = (bin: number) => PLOT.left + bin * barW
  return (
    <div ref={box} className="chart-box">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Logits of the winners’ ranks out of sample: ${fmtPercent(pbo * 100, 0)} below 0, below the median.`}
      >
        {bins.map((count, bin) => (
          <rect
            key={bin}
            x={x(bin) + 1}
            y={PLOT.top + plotH - (count / top) * plotH}
            width={Math.max(1, barW - 2)}
            height={(count / top) * plotH}
            rx={2}
            fill={bin < 8 ? 'var(--loss)' : 'var(--fg)'}
          />
        ))}
        <line x1={x(8)} x2={x(8)} y1={PLOT.top} y2={PLOT.top + plotH} className="zero" />
        {[-4, -2, 0, 2, 4].map((tick) => (
          <text key={tick} x={x((tick + 4) * 2)} y={height - 8} className="tick" textAnchor="middle">
            {tick === 0 ? '0 (the median)' : tick}
          </text>
        ))}
      </svg>
    </div>
  )
}

function WinnersScatter({ points, slope }: { points: { inSample: number; outOfSample: number }[]; slope: number }) {
  const box = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const height = 220
  const all = points.flatMap((point) => [point.inSample, point.outOfSample])
  const [lo, hi] = [Math.min(0, ...all), Math.max(0.1, ...all)]
  const plotW = width - PLOT.left - PLOT.right
  const plotH = height - PLOT.top - PLOT.bottom
  const x = (value: number) => PLOT.left + ((value - lo) / (hi - lo)) * plotW
  const y = (value: number) => PLOT.top + plotH - ((value - lo) / (hi - lo)) * plotH
  return (
    <div ref={box} className="chart-box">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${points.length} winners’ Sharpe ratios in sample against out of sample; slope ${slope.toFixed(2)}.`}
      >
        <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} className="average" />
        <line x1={x(0)} x2={x(0)} y1={PLOT.top} y2={PLOT.top + plotH} className="grid" />
        <line y1={y(0)} y2={y(0)} x1={PLOT.left} x2={PLOT.left + plotW} className="grid" />
        {points.map((point, i) => (
          <circle
            key={i}
            cx={x(point.inSample)}
            cy={y(point.outOfSample)}
            r={4}
            fill="var(--fg)"
            fillOpacity={0.55}
            stroke="var(--bg)"
            strokeWidth={1}
          />
        ))}
        <text x={PLOT.left + plotW} y={height - 8} className="tick" textAnchor="end">
          Sharpe in sample →
        </text>
        <text x={PLOT.left + 4} y={PLOT.top + 10} className="tick">
          ↑ out of sample (dashed: as good)
        </text>
      </svg>
    </div>
  )
}

function PathDots({ sharpes }: { sharpes: number[] }) {
  const box = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const height = 70
  const [lo, hi] = [Math.min(0, ...sharpes) - 0.1, Math.max(0.1, ...sharpes) + 0.1]
  const x = (value: number) => PLOT.left + ((value - lo) / (hi - lo)) * (width - PLOT.left - PLOT.right)
  return (
    <div ref={box} className="chart-box">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`The ${sharpes.length} paths’ Sharpe ratios out of sample: ${sharpes.map((s) => s.toFixed(2)).join(', ')}.`}
      >
        <line x1={x(0)} x2={x(0)} y1={8} y2={height - 24} className="zero" />
        {sharpes.map((sharpe, i) => (
          <circle
            key={i}
            cx={x(sharpe)}
            cy={(height - 16) / 2}
            r={6}
            fill={sharpe > 0 ? 'var(--fg)' : 'var(--loss)'}
            stroke="var(--bg)"
            strokeWidth={2}
          />
        ))}
        <text x={x(0)} y={height - 8} className="tick" textAnchor="middle">
          0
        </text>
      </svg>
    </div>
  )
}

/** Each parameter's effect on the objective around the chosen trial, the others held at its values. */
export function SensitivityBars({ market }: { market: MarketSweepSummary }) {
  if (!market.sensitivities.length) return null
  return (
    <DataTable
      caption="Sensitivity"
      rows={market.sensitivities}
      rowKey={(row) => row.name}
      columns={[
        { key: 'name', header: 'Parameter', card: 'title', render: (row) => row.name },
        {
          key: 'step',
          header: 'Change per step',
          card: 'sub',
          align: 'right',
          render: (row) => (row.perStep == null ? '–' : `${row.perStep >= 0 ? '+' : ''}${row.perStep.toFixed(2)}`),
        },
        {
          key: 'profile',
          header: `${OBJECTIVE_NAMES[market.objective]} at each value`,
          wrap: true,
          render: (row) => row.profile.map((point) => `${point.value}: ${ratio(point.objective)}`).join(' · '),
        },
      ]}
    />
  )
}

/** The anchored walk-forward's chained out-of-sample line. */
export function WalkForwardLine({ market }: { market: MarketSweepSummary }) {
  const walk = market.walkForward
  const points = useMemo(
    () => walk?.chained.map((point) => ({ time: dayTime(point.day), value: point.value })) ?? [],
    [walk],
  )
  if (!walk) return null
  return (
    <div className="stack-sm">
      <Chart
        lines={[{ name: 'Walk-forward', points, width: 3 }]}
        label={`The walk-forward’s out-of-sample line over ${walk.steps.length} steps, Sharpe ${ratio(walk.chainedSharpe)} a year`}
        height={220}
      />
      <p className="hint">
        At each step the trial with the best Sharpe ratio on every day before it was chosen, then run on the step:{' '}
        {walk.steps.map((step) => `#${step.chosen} (${step.testSharpe.toFixed(2)})`).join(', ')}.
      </p>
    </div>
  )
}

/** How alike the markets ranked the same trials. */
export function CrossMarkets({
  pairs,
}: {
  pairs: { first: string; second: string; spearman: number; trials: number }[]
}) {
  if (!pairs.length) return null
  return (
    <Callout label="Across the markets">
      {pairs.map((pair) => (
        <p key={`${pair.first}-${pair.second}`}>
          {pair.first} and {pair.second} ranked the {fmtCount(pair.trials)} trials alike at {pair.spearman.toFixed(2)}{' '}
          (Spearman):{' '}
          {pair.spearman > 0.7
            ? 'the same settings work on both'
            : pair.spearman < 0.3
              ? 'what works on one does not on the other'
              : 'partly alike'}
          .
        </p>
      ))}
    </Callout>
  )
}

/** Links that save the trials as CSV and the whole sweep as JSON; their blobs are let go when the sweep changes. */
export function ExportLinks({ name, csv, json }: { name: string; csv: string; json: string }) {
  const urls = useMemo(
    () => ({
      csv: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
      json: URL.createObjectURL(new Blob([json], { type: 'application/json' })),
    }),
    [csv, json],
  )
  useEffect(() => () => [urls.csv, urls.json].forEach((url) => URL.revokeObjectURL(url)), [urls])
  return (
    <p className="row wrap">
      <a className="link" href={urls.csv} download={`${name}.csv`}>
        Export the trials (CSV)
      </a>
      <a className="link" href={urls.json} download={`${name}.json`}>
        Export the sweep (JSON)
      </a>
    </p>
  )
}
