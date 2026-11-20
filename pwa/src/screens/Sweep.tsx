import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useBot, useRead } from '../api/bot.ts'
import { CommandFailure } from '../api/client.ts'
import type { StrategyDefinition, StrategyParameter } from '../api/parse/strategies.ts'
import {
  conditionErrors,
  costsKey,
  NO_CONDITIONS,
  NO_COSTS,
  storedMarkets,
  type ConditionsForm,
  type MarketCosts,
} from '../backtest/conditions.ts'
import { prepareCandles, prepareConversion, prepareWords, type PreparePhase } from '../backtest/prepare.ts'
import { keep, type DeviceRun } from '../backtest/runs.ts'
import {
  addToTrialLog,
  axesOf,
  chosenOf,
  DEFAULT_SWEEP,
  estimateSeconds,
  estimateWords,
  keepTrial,
  loadSweeps,
  NO_VARY,
  OBJECTIVES,
  readTrialLog,
  saveSweep,
  sweepErrors,
  sweepRequest,
  trialCount,
  trialsCsv,
  trialWords,
  VERDICTS,
  type SavedSweep,
  type SweepForm,
  type VaryForm,
} from '../backtest/sweep.ts'
import { useMarketCosts } from '../backtest/useMarketCosts.ts'
import { FailurePanel } from '../components/Answer.tsx'
import { BacktestTabs } from '../components/backtest/BacktestTabs.tsx'
import { ConditionsFields } from '../components/backtest/ConditionsFields.tsx'
import { ReportFigures } from '../components/backtest/Report.tsx'
import {
  CrossMarkets,
  ExportLinks,
  OverfittingPanel,
  SensitivityBars,
  SweepHeatMap,
  SweepVerdictBox,
  TrialsTable,
  WalkForwardLine,
} from '../components/backtest/SweepReport.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { describedBy, Field, Segmented } from '../components/Field.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { StrategyForm } from '../components/StrategyForm.tsx'
import { Button, ButtonLink, Callout, EmptyState, Section, Skeleton } from '../components/ui.tsx'
import { useEngine } from '../engine/context.ts'
import { EngineCancelled, poolSize } from '../engine/engine.ts'
import type { SweepRequest, SweepTrial } from '../engine/types.ts'
import { fmtCount, fmtTime } from '../format.ts'
import { useMarkets, useStrategies } from '../hooks/data.ts'
import { db } from '../state/db.ts'
import { initialConfig, toInput, validateConfig, type StrategyConfig } from '../strategy/config.ts'

type Phase =
  | (PreparePhase & { label: string })
  | { step: 'plan' }
  | { step: 'trials'; done: number; total: number; market: string }
  | { step: 'summary' }
  | { step: 'chosen' }

function phaseWords(phase: Phase): string {
  if (phase.step === 'plan') return 'Counting the trials…'
  if (phase.step === 'trials') return `${fmtCount(phase.done)} of ${fmtCount(phase.total)} trials on ${phase.market}…`
  if (phase.step === 'summary') return 'Working out how far to trust the best trial…'
  if (phase.step === 'chosen') return 'Running the chosen trial in full…'
  return `${phase.label}: ${prepareWords(phase)}`
}

/** The time now, for a run's id and stamp; called when a run ends, never while drawing. */
const now = () => Date.now()

/** "/backtest?strategy=…&market=…&set=…&rule=…": the chosen trial on the one-strategy screen. */
function backtestLink(strategy: string, market: string, parameters: Record<string, number>, rules: string[]) {
  const query = new URLSearchParams({ strategy, market })
  for (const [name, value] of Object.entries(parameters)) query.append('set', `${name}=${value}`)
  for (const rule of rules) query.append('rule', rule)
  return `/backtest?${query}`
}

/** The setup varied on a market, with its trials, as one run keeps them before saving. */
type MarketRun = {
  label: string
  days: string[]
  daysPerYear: number
  holdOutStart: number
  trials: SweepTrial[]
  problems: { trial: number; message: string }[]
}

/**
 * A parameter sweep (the bot's plan, Appendix A Part D): one setup backtested on this device with its parameters varied,
 * on one market or several, then summed up by the bot's engine into how far to trust the best of them.
 */
export default function Sweep() {
  const { connection } = useBot()
  const strategies = useStrategies()
  const markets = useMarkets()
  const read = useRead()
  const engine = useEngine()
  // No Kelly here: every trial is another setup, and Kelly is worked out per setup.
  const definitions = useMemo(() => {
    const all = strategies.data?.parsed.ok ? strategies.data.parsed.value : null
    return (
      all?.map((d) =>
        d.sizing
          ? { ...d, sizing: { ...d.sizing, methods: d.sizing.methods.filter((method) => method.name !== 'kelly') } }
          : d,
      ) ?? null
    )
  }, [strategies.data])
  const rows = markets.data?.parsed.ok ? markets.data.parsed.value : null
  const stored = useMemo(() => (rows ? storedMarkets(rows) : []), [rows])
  const [edited, setDraft] = useState<StrategyConfig | null>(null)
  const draft = edited ?? (definitions && rows ? initialConfig(definitions, rows) : null)
  const definition = definitions?.find((d) => d.name === draft?.strategy)
  const [vary, setVary] = useState<Record<string, VaryForm>>({})
  const [extraRules, setExtraRules] = useState<string[]>([])
  const [extraMarkets, setExtraMarkets] = useState<string[]>([])
  const [form, setForm] = useState<SweepForm>(DEFAULT_SWEEP)
  const [heat, setHeat] = useState<{ x: string; y: string } | null>(null)
  const [conditions, setConditions] = useState<ConditionsForm>(NO_CONDITIONS)
  const [touched, setTouched] = useState(false)
  const [phase, setPhase] = useState<Phase | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [failure, setFailure] = useState<CommandFailure | null>(null)
  const [current, setCurrent] = useState<SavedSweep | null>(null)
  const [chosenRun, setChosenRun] = useState<DeviceRun | null>(null)
  const [saved, setSaved] = useState<SavedSweep[]>([])
  const [earlier, setEarlier] = useState(0)
  const stop = useRef<AbortController | null>(null)
  const ids = {
    balance: useId(),
    from: useId(),
    to: useId(),
    holdOut: useId(),
    holdOutFrom: useId(),
    objective: useId(),
    trades: useId(),
    drawdown: useId(),
    earlier: useId(),
    heatX: useId(),
    heatY: useId(),
  }

  const marketSymbol = draft?.market.split(' ')[0] ?? ''
  const remember = useMarketCosts(connection?.id, marketSymbol || undefined, (costs) =>
    setConditions((current) => ({ ...current, ...costs })),
  )
  useEffect(() => {
    if (connection) void loadSweeps(connection.id).then(setSaved)
  }, [connection])
  useEffect(() => {
    if (!connection || !draft) return
    let current = true
    void readTrialLog(connection.id, draft.strategy, draft.market).then((count) => current && setEarlier(count))
    return () => {
      current = false
    }
  }, [connection, draft?.strategy, draft?.market, current?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const { axes, errors: varyErrors } = definition ? axesOf(vary, definition.parameters) : { axes: [], errors: {} }
  const ruleSets = 1 + extraRules.length
  const trials = trialCount(axes, ruleSets)
  const marketList = draft ? [draft.market, ...extraMarkets.filter((market) => market !== draft.market)] : []
  const candleCount = marketList.reduce(
    (sum, market) => sum + (rows?.find((row) => `${row.symbol} ${row.interval}` === market)?.candles ?? 0),
    0,
  )
  const estimate = trials <= 1000 ? estimateSeconds(trials, candleCount, poolSize()) : null
  const errors = { ...sweepErrors(form, axes, ruleSets), ...(draft ? validateConfig(draft, definition) : {}) }
  const costErrors = conditionErrors(conditions)
  const heatAxes =
    axes.length >= 2
      ? heat && axes.some((a) => a.name === heat.x) && axes.some((a) => a.name === heat.y) && heat.x !== heat.y
        ? heat
        : { x: axes[0]!.name, y: axes[1]!.name }
      : null

  const start = async () => {
    setTouched(true)
    if (
      !connection ||
      !draft ||
      !definition ||
      Object.keys(errors).length ||
      Object.keys(varyErrors).length ||
      Object.keys(costErrors).length
    )
      return
    const controller = new AbortController()
    stop.current = controller
    setProblem(null)
    setFailure(null)
    setChosenRun(null)
    try {
      const input = toInput(draft, definition)
      const baseRules = input.rules?.length ? input.rules : (definition.rules?.defaults ?? [])
      const sets = [
        baseRules,
        ...extraRules.map((text) =>
          text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        ),
      ]
      void remember(conditions)
      const earlierTrials = form.countEarlier ? earlier : 0
      let first: SweepRequest | null = null
      let plannedAxes = axes
      const runs: MarketRun[] = []
      for (const market of marketList) {
        const [symbol = '', interval = ''] = market.split(' ')
        const preparing = {
          signal: controller.signal,
          onPhase: (step: PreparePhase) => setPhase({ ...step, label: market }),
        }
        const candles = await prepareCandles(connection.id, market, read, preparing)
        // The costs entered are this market's; another market sweeps with its own, as remembered on this device.
        const costs =
          market === draft.market
            ? conditions
            : { ...conditions, ...((await db.get<MarketCosts>(costsKey(connection.id, symbol))) ?? NO_COSTS) }
        const { conversion, columns } = await prepareConversion(
          engine(),
          connection.id,
          read,
          symbol,
          conditions.currency,
          stored,
          preparing,
        )
        const request = sweepRequest(
          form,
          { ...input, symbol, interval, rules: baseRules },
          costs,
          axes,
          sets,
          conversion,
          earlierTrials,
          heatAxes,
        )
        if (!first) {
          first = request
          setPhase({ step: 'plan' })
          const plan = await engine().planSweep(request, controller.signal)
          if (!plan.ok) return setProblem(plan.error.message)
          plannedAxes = plan.axes
        }
        setPhase({ step: 'trials', done: 0, total: trials, market })
        const run = await engine().sweep(request, candles, trials, {
          signal: controller.signal,
          conversion: columns,
          onProgress: (done, total) => setPhase({ step: 'trials', done, total, market }),
        })
        if (!run.ok) return setProblem(`${market}: ${run.error.message}`)
        if (!run.trials.length) return setProblem(`${market}: no trial could run. ${run.problems[0]?.message ?? ''}`)
        runs.push({
          label: market,
          days: run.days,
          daysPerYear: run.daysPerYear,
          holdOutStart: run.holdOutStart,
          trials: run.trials,
          problems: run.problems,
        })
      }
      if (!first) return

      setPhase({ step: 'summary' })
      const summed = await engine().summarizeSweep(
        {
          sweep: first,
          axes: plannedAxes,
          markets: runs.map(({ label, days, daysPerYear, trials }) => ({ label, days, daysPerYear, trials })),
        },
        controller.signal,
      )
      if (!summed.ok) return setProblem(summed.error.message)
      const sweep: SavedSweep = {
        kind: 'sweep',
        id: `${now()}`,
        at: now(),
        engine: summed.engine,
        strategy: draft.strategy,
        request: first,
        axes: plannedAxes,
        summary: summed.summary,
        markets: runs.map((run) => ({
          label: run.label,
          days: run.days.length,
          holdOutStart: run.holdOutStart,
          trials: run.trials.map(keepTrial),
          problems: run.problems,
        })),
      }
      setCurrent(sweep)
      setSaved(await saveSweep(connection.id, sweep))
      for (const run of runs) await addToTrialLog(connection.id, draft.strategy, run.label, run.trials.length)

      // The chosen trial of the first market, run again in full for its report.
      const chosen = chosenOf(summed.summary.markets[0]!, sweep.markets[0]!.trials)
      if (chosen) {
        setPhase({ step: 'chosen' })
        const request = { ...first.base, parameters: chosen.parameters, rules: sets[chosen.ruleSet] }
        const candles = await prepareCandles(connection.id, draft.market, read, {})
        const conversion = await prepareConversion(
          engine(),
          connection.id,
          read,
          marketSymbol,
          conditions.currency,
          stored,
        )
        const answer = await engine().backtest(request, candles, controller.signal, conversion.columns)
        if (answer.ok)
          setChosenRun({
            kind: 'device',
            id: `chosen-${sweep.id}`,
            at: now(),
            input: { ...input, params: chosen.parameters, rules: sets[chosen.ruleSet] },
            balance: request.balance ?? 1000,
            from: null,
            to: null,
            result: keep(answer),
          })
      }
    } catch (error) {
      if (error instanceof EngineCancelled || (error instanceof CommandFailure && error.kind === 'cancelled')) return
      if (error instanceof CommandFailure) setFailure(error)
      else setProblem((error as Error).message)
    } finally {
      setPhase(null)
      stop.current = null
    }
  }

  const ready = definitions && rows && draft
  return (
    <>
      <ScreenHead
        kicker="Backtest"
        title="Parameter sweep."
        lead="This device backtests one setup many times with its parameters varied, chooses the best on the earlier days, checks it on days it never saw, and says how far to trust it: the deflated Sharpe ratio counts every trial, and the overfitting checks ask whether the best in sample stays good out of it."
      />
      <Section variant="alt" label="Sweep settings">
        <div className="stack">
          <BacktestTabs />
          {!ready ? (
            strategies.error || markets.error ? (
              <FailurePanel failure={(strategies.error ?? markets.error)!} />
            ) : (
              <Skeleton lines={5} />
            )
          ) : (
            <form
              className="stack"
              noValidate
              onSubmit={(event) => {
                event.preventDefault()
                void start()
              }}
            >
              <StrategyForm
                definitions={definitions}
                markets={rows}
                config={draft}
                onChange={setDraft}
                errors={touched ? validateConfig(draft, definition) : {}}
              />
              <fieldset className="stack-sm">
                <legend className="h3">Vary</legend>
                <p className="hint">
                  Each parameter switched on takes its values in turn; the others stay as set above. Vary few, in coarse
                  steps first: every trial counts against the best one.
                </p>
                {definition?.parameters.map((parameter) => (
                  <VaryRow
                    key={parameter.name}
                    parameter={parameter}
                    form={vary[parameter.name] ?? NO_VARY}
                    error={touched ? varyErrors[parameter.name] : undefined}
                    onChange={(next) => setVary((current) => ({ ...current, [parameter.name]: next }))}
                  />
                ))}
              </fieldset>
              <RuleSets definition={definition} extra={extraRules} onChange={setExtraRules} />
              <fieldset className="stack-sm">
                <legend className="h3">Markets</legend>
                <p className="hint">
                  The same trials on other markets too: settings that do well on several are far more believable than
                  ones tuned to one.
                </p>
                <div className="row wrap">
                  {stored
                    .map((market) => `${market.symbol} ${market.interval}`)
                    .filter((market) => market !== draft.market)
                    .map((market) => (
                      <label key={market} className="check">
                        <input
                          type="checkbox"
                          checked={extraMarkets.includes(market)}
                          onChange={(event) =>
                            setExtraMarkets((list) =>
                              event.target.checked ? [...list, market] : list.filter((m) => m !== market),
                            )
                          }
                        />
                        {market}
                      </label>
                    ))}
                </div>
              </fieldset>
              <div className="form-grid">
                <Field id={ids.balance} label="Starting balance" error={touched ? errors.balance : undefined}>
                  <input
                    id={ids.balance}
                    className="mono"
                    type="text"
                    inputMode="decimal"
                    value={form.balance}
                    onChange={(event) => setForm({ ...form, balance: event.target.value })}
                  />
                </Field>
                <Field id={ids.from} label="From (UTC, optional)">
                  <input
                    id={ids.from}
                    type="date"
                    value={form.from}
                    onChange={(event) => setForm({ ...form, from: event.target.value })}
                  />
                </Field>
                <Field id={ids.to} label="To (UTC, optional)" error={touched ? errors.to : undefined}>
                  <input
                    id={ids.to}
                    type="date"
                    value={form.to}
                    onChange={(event) => setForm({ ...form, to: event.target.value })}
                  />
                </Field>
                <Field
                  id={ids.holdOut}
                  label={`Hold-out: the last ${form.holdOutPercent}% of the days`}
                  hint="Kept out of the choice, and used once to check it."
                >
                  <input
                    id={ids.holdOut}
                    type="range"
                    min={10}
                    max={50}
                    step={5}
                    value={form.holdOutPercent}
                    disabled={!!form.holdOutFrom}
                    onChange={(event) => setForm({ ...form, holdOutPercent: Number(event.target.value) })}
                    aria-describedby={describedBy(ids.holdOut, 'hint')}
                  />
                </Field>
                <Field
                  id={ids.holdOutFrom}
                  label="Or hold out from (optional)"
                  hint="Every day from this date instead."
                >
                  <input
                    id={ids.holdOutFrom}
                    type="date"
                    value={form.holdOutFrom}
                    onChange={(event) => setForm({ ...form, holdOutFrom: event.target.value })}
                    aria-describedby={describedBy(ids.holdOutFrom, 'hint')}
                  />
                </Field>
                <Field id={ids.objective} label="Best by" hint="In sample, after costs.">
                  <select
                    id={ids.objective}
                    value={form.objective}
                    onChange={(event) => setForm({ ...form, objective: event.target.value as SweepForm['objective'] })}
                  >
                    {OBJECTIVES.map((objective) => (
                      <option key={objective.value} value={objective.value}>
                        {objective.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  id={ids.trades}
                  label="At least this many trades"
                  error={touched ? errors.minimumTrades : undefined}
                  hint="In sample, to be chosen."
                >
                  <input
                    id={ids.trades}
                    className="mono"
                    type="text"
                    inputMode="numeric"
                    value={form.minimumTrades}
                    onChange={(event) => setForm({ ...form, minimumTrades: event.target.value })}
                  />
                </Field>
                <Field
                  id={ids.drawdown}
                  label="Deepest fall allowed, % (optional)"
                  error={touched ? errors.maxDrawdown : undefined}
                  hint="In sample, e.g. 25."
                >
                  <input
                    id={ids.drawdown}
                    className="mono"
                    type="text"
                    inputMode="decimal"
                    value={form.maxDrawdown}
                    onChange={(event) => setForm({ ...form, maxDrawdown: event.target.value })}
                  />
                </Field>
                {axes.length >= 2 && heatAxes ? (
                  <>
                    <Field id={ids.heatX} label="Heat map across">
                      <select
                        id={ids.heatX}
                        value={heatAxes.x}
                        onChange={(event) =>
                          setHeat({
                            x: event.target.value,
                            y: heatAxes.y === event.target.value ? heatAxes.x : heatAxes.y,
                          })
                        }
                      >
                        {axes.map((axis) => (
                          <option key={axis.name}>{axis.name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field id={ids.heatY} label="Heat map down">
                      <select
                        id={ids.heatY}
                        value={heatAxes.y}
                        onChange={(event) =>
                          setHeat({
                            y: event.target.value,
                            x: heatAxes.x === event.target.value ? heatAxes.y : heatAxes.x,
                          })
                        }
                      >
                        {axes.map((axis) => (
                          <option key={axis.name}>{axis.name}</option>
                        ))}
                      </select>
                    </Field>
                  </>
                ) : null}
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.profitFactor}
                  onChange={(event) => setForm({ ...form, profitFactor: event.target.checked })}
                />
                To be chosen, a trial’s profits must outweigh its losses in sample, after costs
              </label>
              <ConditionsFields
                form={conditions}
                onChange={setConditions}
                errors={touched ? costErrors : {}}
                symbol={marketSymbol}
                route={null}
              />
              <label className="check" htmlFor={ids.earlier}>
                <input
                  id={ids.earlier}
                  type="checkbox"
                  checked={form.countEarlier}
                  onChange={(event) => setForm({ ...form, countEarlier: event.target.checked })}
                />
                Count the {fmtCount(earlier)} trials swept before on {draft.strategy} and {draft.market} in the deflated
                Sharpe ratio
              </label>
              <p className="hint" role="status">
                {estimateWords(trials * marketList.length, estimate == null ? null : estimate * marketList.length)}
                {marketList.length > 1 ? ` over ${marketList.length} markets` : ''}
              </p>
              {touched && errors.vary ? <p className="field-error">{errors.vary}</p> : null}
              <div className="btn-row">
                <Button type="submit" busy={phase != null} icon="backtest">
                  Run the sweep
                </Button>
                {phase ? (
                  <Button variant="ghost" onClick={() => stop.current?.abort()}>
                    Cancel
                  </Button>
                ) : null}
              </div>
              {phase ? (
                <p className="hint" role="status">
                  {phaseWords(phase)}
                </p>
              ) : null}
              {failure ? <FailurePanel failure={failure} /> : null}
              {problem ? (
                <Callout label="Not swept" tone="error">
                  <p>{problem}</p>
                </Callout>
              ) : null}
            </form>
          )}
        </div>
      </Section>
      {current ? <SweepSections sweep={current} chosenRun={chosenRun} /> : null}
      <Section variant="alt" label="Saved sweeps">
        <div className="section-title">
          <h2 className="h2">Saved sweeps</h2>
        </div>
        {saved.length ? (
          <DataTable
            caption="Saved sweeps"
            rows={[...saved].reverse()}
            rowKey={(sweep) => sweep.id}
            columns={[
              {
                key: 'setup',
                header: 'Sweep',
                card: 'title',
                wrap: true,
                render: (sweep) => `${sweep.strategy} on ${sweep.markets.map((market) => market.label).join(', ')}`,
              },
              {
                key: 'verdict',
                header: 'Verdict',
                card: 'sub',
                render: (sweep) => VERDICTS[sweep.summary.markets[0]!.verdict].title,
              },
              {
                key: 'trials',
                header: 'Trials',
                align: 'right',
                render: (sweep) => fmtCount(sweep.summary.markets[0]!.trials),
              },
              { key: 'when', header: 'Run', render: (sweep) => fmtTime(sweep.at) },
            ]}
            actions={(sweep) => (
              <Button compact variant="ghost" onClick={() => (setCurrent(sweep), setChosenRun(null))}>
                Show
              </Button>
            )}
          />
        ) : (
          <EmptyState title="No sweeps yet.">
            Each sweep you run keeps its trials and summary on this device (the last 10).
          </EmptyState>
        )}
      </Section>
    </>
  )
}

/** One parameter's row: off, or varied over a list or a range. */
function VaryRow({
  parameter,
  form,
  error,
  onChange,
}: {
  parameter: StrategyParameter
  form: VaryForm
  error: string | undefined
  onChange: (form: VaryForm) => void
}) {
  const base = useId()
  return (
    <div className="stack-sm vary-row">
      <label className="check" htmlFor={`${base}-on`}>
        <input
          id={`${base}-on`}
          type="checkbox"
          checked={form.on}
          onChange={(event) => onChange({ ...form, on: event.target.checked })}
        />
        Vary {parameter.name}
        <span className="hint">
          {' '}
          ({parameter.min} to {parameter.max}
          {parameter.whole ? ', whole numbers' : ''})
        </span>
      </label>
      {form.on ? (
        <div className="form-grid">
          <Segmented
            name={`${base}-mode`}
            legend={`${parameter.name} values`}
            value={form.mode}
            onChange={(mode) => onChange({ ...form, mode })}
            options={[
              { value: 'range', label: 'From, to, step' },
              { value: 'list', label: 'A list' },
            ]}
          />
          {form.mode === 'list' ? (
            <Field id={`${base}-list`} label={`${parameter.name}: values`} hint="e.g. 10, 20, 30" error={error}>
              <input
                id={`${base}-list`}
                className="mono"
                type="text"
                value={form.list}
                onChange={(event) => onChange({ ...form, list: event.target.value })}
                aria-describedby={describedBy(`${base}-list`, 'hint', error)}
              />
            </Field>
          ) : (
            <>
              <Field id={`${base}-from`} label={`${parameter.name}: from`} error={error}>
                <input
                  id={`${base}-from`}
                  className="mono"
                  type="text"
                  inputMode="decimal"
                  value={form.from}
                  onChange={(event) => onChange({ ...form, from: event.target.value })}
                />
              </Field>
              <Field id={`${base}-to`} label={`${parameter.name}: to`}>
                <input
                  id={`${base}-to`}
                  className="mono"
                  type="text"
                  inputMode="decimal"
                  value={form.to}
                  onChange={(event) => onChange({ ...form, to: event.target.value })}
                />
              </Field>
              <Field id={`${base}-step`} label={`${parameter.name}: step`}>
                <input
                  id={`${base}-step`}
                  className="mono"
                  type="text"
                  inputMode="decimal"
                  value={form.step}
                  onChange={(event) => onChange({ ...form, step: event.target.value })}
                />
              </Field>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** The rule sets tried: the setup's rules first, then any added, one rule a line. */
function RuleSets({
  definition,
  extra,
  onChange,
}: {
  definition: StrategyDefinition | undefined
  extra: string[]
  onChange: (extra: string[]) => void
}) {
  const base = useId()
  return (
    <fieldset className="stack-sm">
      <legend className="h3">Rule sets</legend>
      <p className="hint">
        Set 1 is the rules above. Each set added is tried with every value: it doubles the trials, or more.
      </p>
      {extra.map((text, index) => (
        <Field
          key={index}
          id={`${base}-${index}`}
          label={`Rule set ${index + 2}, one rule a line`}
          hint={definition?.rules ? `Written as ${definition.rules.syntax}` : undefined}
        >
          <textarea
            id={`${base}-${index}`}
            className="mono"
            rows={3}
            value={text}
            onChange={(event) => onChange(extra.map((other, i) => (i === index ? event.target.value : other)))}
          />
        </Field>
      ))}
      <div className="btn-row">
        <Button
          compact
          variant="ghost"
          icon="plus"
          onClick={() => onChange([...extra, (definition?.rules?.defaults ?? []).join('\n')])}
        >
          Add a rule set
        </Button>
        {extra.length ? (
          <Button compact variant="ghost" onClick={() => onChange(extra.slice(0, -1))}>
            Remove the last
          </Button>
        ) : null}
      </div>
    </fieldset>
  )
}

/** A sweep's report, market by market: the verdict, the heat map, the trials, the checks, and the chosen trial in full. */
function SweepSections({ sweep, chosenRun }: { sweep: SavedSweep; chosenRun: DeviceRun | null }) {
  const [selected, setSelected] = useState<number | null>(null)
  const name = `sweep-${sweep.strategy}-${new Date(sweep.at).toISOString().slice(0, 10)}`
  const json = useMemo(
    () =>
      JSON.stringify(
        { request: sweep.request, axes: sweep.axes, summary: sweep.summary, markets: sweep.markets },
        null,
        2,
      ),
    [sweep],
  )
  return (
    <>
      {sweep.summary.markets.map((market, m) => {
        const kept = sweep.markets[m]!
        const chosen = chosenOf(market, kept.trials)
        return (
          <Section key={market.label} variant={m % 2 ? 'alt' : 'default'} label={`Sweep on ${market.label}`}>
            <div className="section-title">
              <h2 className="h2">
                {sweep.strategy} on {market.label}: {fmtCount(market.trials)} trials
              </h2>
            </div>
            <div className="stack">
              <SweepVerdictBox market={market} trials={kept.trials} axes={sweep.axes} />
              {kept.problems.length ? (
                <p className="hint">
                  {fmtCount(kept.problems.length)} trials could not run: {kept.problems[0]!.message}
                </p>
              ) : null}
              <div className="stack-sm">
                <h3 className="h3">Heat map</h3>
                <SweepHeatMap market={market} selected={selected} onSelect={setSelected} />
              </div>
              <div className="stack-sm">
                <h3 className="h3">Every trial</h3>
                <TrialsTable trials={kept.trials} axes={sweep.axes} market={market} selected={selected} />
                <ExportLinks
                  name={`${name}-${market.label.replace(/\s+/g, '-')}`}
                  csv={trialsCsv(kept.trials, sweep.axes)}
                  json={json}
                />
              </div>
              <div className="stack-sm">
                <h3 className="h3">Overfitting</h3>
                <OverfittingPanel market={market} />
              </div>
              {market.sensitivities.length ? (
                <div className="stack-sm">
                  <h3 className="h3">Sensitivity</h3>
                  <SensitivityBars market={market} />
                </div>
              ) : null}
              {market.walkForward ? (
                <div className="stack-sm">
                  <h3 className="h3">Walk-forward</h3>
                  <WalkForwardLine market={market} />
                </div>
              ) : null}
              {m === 0 && chosen ? (
                <div className="stack-sm">
                  <h3 className="h3">The chosen trial in full</h3>
                  <p className="hint">
                    Trial {chosen.index}: {trialWords(chosen, sweep.axes)}, over the whole period. Its Kelly here is in
                    sample; live sizing reads a backtest of its own.
                  </p>
                  {chosenRun ? <ReportFigures run={chosenRun} /> : null}
                  <ButtonLink
                    variant="ghost"
                    to={backtestLink(
                      sweep.strategy,
                      market.label,
                      chosen.parameters,
                      sweep.request.ruleSets?.[chosen.ruleSet] ?? sweep.request.base.rules ?? [],
                    )}
                  >
                    Open as backtest
                  </ButtonLink>
                </div>
              ) : null}
            </div>
          </Section>
        )
      })}
      <CrossMarkets pairs={sweep.summary.crossMarkets} />
    </>
  )
}
