import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useBot, useRead } from '../api/bot.ts'
import { CommandFailure } from '../api/client.ts'
import {
  combinedErrors,
  combineRequest,
  DEFAULT_COMBINED,
  legErrors,
  legName,
  legRequest,
  legSummary,
  loadCombined,
  MAX_LEGS,
  removeCombined,
  saveCombined,
  type CombinedForm,
  type CombinedRun,
  type LegForm,
} from '../backtest/combined.ts'
import { costsKey, costsPart, CURRENCIES, NO_CONDITIONS, readNumber, storedMarkets } from '../backtest/conditions.ts'
import {
  prepareCandles,
  prepareConversion,
  prepareKelly,
  prepareWords,
  type PreparePhase,
} from '../backtest/prepare.ts'
import { useMarketCosts } from '../backtest/useMarketCosts.ts'
import { FailurePanel } from '../components/Answer.tsx'
import { BacktestTabs } from '../components/backtest/BacktestTabs.tsx'
import {
  BudgetSplits,
  CombinedEquity,
  CombinedFigures,
  CombinedNotes,
  CorrelationMatrix,
  LegsTable,
  MarketBetas,
  ShareBars,
} from '../components/backtest/CombinedReport.tsx'
import { ConditionsFields } from '../components/backtest/ConditionsFields.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { describedBy, Field } from '../components/Field.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { Sheet } from '../components/Sheet.tsx'
import { StrategyForm } from '../components/StrategyForm.tsx'
import { Button, Callout, EmptyState, Section, Skeleton } from '../components/ui.tsx'
import { useEngine } from '../engine/context.ts'
import { EngineCancelled } from '../engine/engine.ts'
import type { BacktestJob } from '../engine/engine.ts'
import type { DeviceBacktest } from '../engine/types.ts'
import { fmtCount, fmtMoney, fmtSignedPercent, fmtTime, tone } from '../format.ts'
import { useMarkets, useStrategies } from '../hooks/data.ts'
import { db } from '../state/db.ts'
import type { StrategyDefinition } from '../api/parse/strategies.ts'
import type { MarketRow } from '../api/parse/markets.ts'
import { initialConfig, toInput, validateConfig } from '../strategy/config.ts'

type Phase = (PreparePhase & { leg: string }) | { step: 'legs'; done: number; total: number } | { step: 'combine' }

function phaseWords(phase: Phase): string {
  if (phase.step === 'legs')
    return `Backtesting the legs on this device: ${fmtCount(phase.done)} of ${fmtCount(phase.total)} done…`
  if (phase.step === 'combine') return 'Adding the legs up…'
  return `${phase.leg}: ${prepareWords(phase)}`
}

const newId = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`

/**
 * Several strategies at once (the bot's plan, Appendix A Part C): each leg a strategy on its market with its own budget,
 * backtested on this device in one currency, then added up day by day by the bot's engine.
 */
export default function CombinedBacktest() {
  const { connection } = useBot()
  const strategies = useStrategies()
  const markets = useMarkets()
  const read = useRead()
  const engine = useEngine()
  const staff = connection?.person?.role !== 'client'
  const definitions = useMemo(() => {
    const all = strategies.data?.parsed.ok ? strategies.data.parsed.value : null
    if (!all || staff) return all
    return all.map((d) =>
      d.sizing
        ? { ...d, sizing: { ...d.sizing, methods: d.sizing.methods.filter((method) => method.name !== 'kelly') } }
        : d,
    )
  }, [strategies.data, staff])
  const rows = markets.data?.parsed.ok ? markets.data.parsed.value : null
  const stored = useMemo(() => (rows ? storedMarkets(rows) : []), [rows])
  const [legs, setLegs] = useState<LegForm[]>([])
  const [form, setForm] = useState<CombinedForm>(DEFAULT_COMBINED)
  const [editing, setEditing] = useState<{ leg: LegForm; isNew: boolean } | null>(null)
  const [touched, setTouched] = useState(false)
  const [phase, setPhase] = useState<Phase | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [failure, setFailure] = useState<CommandFailure | null>(null)
  const [current, setCurrent] = useState<CombinedRun | null>(null)
  const [saved, setSaved] = useState<CombinedRun[]>([])
  const stop = useRef<AbortController | null>(null)
  const ids = { currency: useId(), riskFree: useId(), from: useId(), to: useId() }

  useEffect(() => {
    if (connection) void loadCombined(connection.id).then(setSaved)
  }, [connection])

  const errors = combinedErrors(form, legs)
  const legProblems = legs.some(
    (leg) =>
      Object.keys(legErrors(leg, legs)).length ||
      Object.keys(
        validateConfig(
          leg.config,
          definitions?.find((d) => d.name === leg.config.strategy),
        ),
      ).length,
  )

  const addLeg = () => {
    if (!definitions || !rows) return
    const config = initialConfig(definitions, rows, legs.length ? undefined : { symbol: 'XAUUSD', interval: '1h' })
    if (config)
      setEditing({ leg: { id: newId(), label: '', config, budget: '1000', conditions: NO_CONDITIONS }, isNew: true })
  }

  /** Backtests every leg on this device, each in the combined currency, then adds them up. */
  const start = async () => {
    setTouched(true)
    if (!connection || !definitions || Object.keys(errors).length || legProblems) return
    const controller = new AbortController()
    stop.current = controller
    setProblem(null)
    setFailure(null)
    try {
      const jobs: BacktestJob[] = []
      for (const leg of legs) {
        const name = legName(leg)
        const definition = definitions.find((d) => d.name === leg.config.strategy)
        const input = toInput(leg.config, definition)
        const preparing = {
          signal: controller.signal,
          onPhase: (step: PreparePhase) => setPhase({ ...step, leg: name }),
        }
        const candles = await prepareCandles(connection.id, `${input.symbol} ${input.interval}`, read, preparing)
        void db.set(costsKey(connection.id, input.symbol), costsPart(leg.conditions))
        const { conversion, columns } = await prepareConversion(
          engine(),
          connection.id,
          read,
          input.symbol,
          form.currency,
          stored,
          preparing,
        ).catch((error: Error) => {
          throw new Error(`${name}: ${error.message}`)
        })
        const kelly = await prepareKelly(input, read, preparing)
        jobs.push({ request: legRequest(leg, input, kelly, form, conversion), candles, conversion: columns })
      }

      setPhase({ step: 'legs', done: 0, total: jobs.length })
      const answers = await engine().backtestAll(jobs, {
        signal: controller.signal,
        onProgress: (done, total) => setPhase({ step: 'legs', done, total }),
      })
      const refused = answers.findIndex((answer) => !answer.ok)
      if (refused >= 0) {
        const answer = answers[refused]!
        return setProblem(`${legName(legs[refused]!)}: ${answer.ok ? '' : answer.error.message}`)
      }
      const ran = answers as DeviceBacktest[]
      setPhase({ step: 'combine' })
      const combined = await engine().combine(combineRequest(form, legs, ran), controller.signal)
      if (!combined.ok) return setProblem(combined.error.message)
      const run: CombinedRun = {
        kind: 'combined',
        id: newId(),
        at: Date.now(),
        form,
        legs,
        engine: combined.engine,
        summaries: ran.map((answer, index) => legSummary(legName(legs[index]!), answer)),
        combined: combined.combined,
      }
      setCurrent(run)
      await saveCombined(connection.id, run)
      setSaved(await loadCombined(connection.id))
    } catch (error) {
      if (error instanceof EngineCancelled || (error instanceof CommandFailure && error.kind === 'cancelled')) return
      if (error instanceof CommandFailure) setFailure(error)
      else setProblem((error as Error).message)
    } finally {
      setPhase(null)
      stop.current = null
    }
  }

  const ready = definitions && rows
  return (
    <>
      <ScreenHead
        kicker="Backtest"
        title="Several strategies."
        lead="Each leg is a strategy on its market with its own budget, as separate live sessions with budgets trade. This device backtests every leg in one currency, then adds them up day by day: how they did together, one beta per market, how they moved together, and how else the same money could have been split."
      />
      <Section variant="alt" label="Combined backtest settings">
        <div className="stack">
          <BacktestTabs />
          {!ready ? (
            strategies.error || markets.error ? (
              <FailurePanel failure={(strategies.error ?? markets.error)!} />
            ) : (
              <Skeleton lines={4} />
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
              {legs.length ? (
                <DataTable
                  caption="Legs"
                  rows={legs}
                  rowKey={(leg) => leg.id}
                  columns={[
                    {
                      key: 'leg',
                      header: 'Leg',
                      card: 'title',
                      wrap: true,
                      render: (leg) => <strong>{legName(leg)}</strong>,
                    },
                    {
                      key: 'budget',
                      header: 'Budget',
                      card: 'sub',
                      align: 'right',
                      render: (leg) => fmtMoney(readNumber(leg.budget), form.currency),
                    },
                    {
                      key: 'sizing',
                      header: 'Sizing',
                      render: (leg) =>
                        leg.config.sizing ? `${leg.config.sizing.method}:${leg.config.sizing.value}` : 'the default',
                    },
                    {
                      key: 'conditions',
                      header: 'Costs and fill',
                      wrap: true,
                      render: (leg) => {
                        const costs = [
                          leg.conditions.spread && `spread ${leg.conditions.spread}`,
                          leg.conditions.commission && `commission ${leg.conditions.commission}%`,
                          leg.conditions.fill === 'NextOpen' && 'next open',
                          leg.conditions.budgeted && 'budget room',
                        ]
                        return costs.filter(Boolean).join(', ') || 'none'
                      },
                    },
                    {
                      key: 'check',
                      header: '',
                      render: (leg) =>
                        touched &&
                        (Object.keys(legErrors(leg, legs)).length ||
                          Object.keys(
                            validateConfig(
                              leg.config,
                              definitions.find((d) => d.name === leg.config.strategy),
                            ),
                          ).length) ? (
                          <span className="field-error">Needs a fix: edit it.</span>
                        ) : null,
                    },
                  ]}
                  actions={(leg) => (
                    <span className="row">
                      <Button compact variant="ghost" onClick={() => setEditing({ leg, isNew: false })}>
                        Edit
                      </Button>
                      <Button
                        compact
                        variant="ghost"
                        onClick={() => setLegs((list) => list.filter((other) => other.id !== leg.id))}
                      >
                        Remove
                      </Button>
                    </span>
                  )}
                />
              ) : (
                <EmptyState title="No legs yet.">
                  Add a leg for each strategy and market, e.g. a strategy on XAUUSD 1h and the same one on EURPLN 1h.
                </EmptyState>
              )}
              {touched && errors.legs ? <p className="field-error">{errors.legs}</p> : null}
              <div className="btn-row">
                <Button variant="ghost" icon="plus" onClick={addLeg} disabled={legs.length >= MAX_LEGS}>
                  Add a leg
                </Button>
                {legs.length >= MAX_LEGS ? <span className="hint">At most {MAX_LEGS} legs.</span> : null}
              </div>
              <div className="form-grid">
                <Field
                  id={ids.currency}
                  label="Currency"
                  hint="Every leg is backtested in it, converted at each moment through the bot’s markets."
                >
                  <select
                    id={ids.currency}
                    value={form.currency}
                    onChange={(event) => setForm({ ...form, currency: event.target.value })}
                    aria-describedby={describedBy(ids.currency, 'hint')}
                  >
                    {CURRENCIES.map((currency) => (
                      <option key={currency} value={currency}>
                        {currency}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  id={ids.riskFree}
                  label="Risk-free, % a year"
                  hint={`What cash in ${form.currency} earns: taken off for the Sharpe ratio and alpha.`}
                  error={touched ? errors.riskFree : undefined}
                >
                  <input
                    id={ids.riskFree}
                    className="mono"
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={form.riskFree}
                    onChange={(event) => setForm({ ...form, riskFree: event.target.value })}
                    aria-describedby={describedBy(ids.riskFree, 'hint', touched ? errors.riskFree : null)}
                  />
                </Field>
                <Field id={ids.from} label="From (UTC, optional)" hint="Each leg’s first stored candle when empty.">
                  <input
                    id={ids.from}
                    type="date"
                    value={form.from}
                    onChange={(event) => setForm({ ...form, from: event.target.value })}
                    aria-describedby={describedBy(ids.from, 'hint')}
                  />
                </Field>
                <Field
                  id={ids.to}
                  label="To (UTC, optional)"
                  hint="The newest candle when empty."
                  error={touched ? errors.to : undefined}
                >
                  <input
                    id={ids.to}
                    type="date"
                    value={form.to}
                    onChange={(event) => setForm({ ...form, to: event.target.value })}
                    aria-describedby={describedBy(ids.to, 'hint', touched ? errors.to : null)}
                  />
                </Field>
              </div>
              <div className="btn-row">
                <Button type="submit" busy={phase != null} icon="backtest">
                  Run the combined backtest
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
                <Callout label="Not combined" tone="error">
                  <p>{problem}</p>
                </Callout>
              ) : null}
            </form>
          )}
        </div>
      </Section>
      {editing && definitions && rows ? (
        <LegSheet
          key={editing.leg.id}
          leg={editing.leg}
          isNew={editing.isNew}
          others={legs}
          definitions={definitions}
          markets={rows}
          currency={form.currency}
          connectionId={connection?.id}
          onClose={() => setEditing(null)}
          onSave={(leg) => {
            setLegs((list) =>
              editing.isNew ? [...list, leg] : list.map((other) => (other.id === leg.id ? leg : other)),
            )
            setEditing(null)
          }}
        />
      ) : null}
      {current ? <CombinedReportSections run={current} /> : null}
      <Section variant="alt" label="Saved combined runs">
        <div className="section-title">
          <h2 className="h2">Saved combined runs</h2>
        </div>
        {saved.length ? (
          <DataTable
            caption="Saved combined backtests"
            rows={[...saved].reverse()}
            rowKey={(run) => run.id}
            columns={[
              {
                key: 'legs',
                header: 'Legs',
                card: 'title',
                wrap: true,
                render: (run) => run.combined.legs.map((leg) => leg.label).join(' + '),
              },
              {
                key: 'return',
                header: 'Return',
                card: 'sub',
                align: 'right',
                render: (run) => (
                  <span className={tone(run.combined.profitLoss) ?? undefined}>
                    {fmtSignedPercent(run.combined.returnPercent)}
                  </span>
                ),
              },
              {
                key: 'sharpe',
                header: 'Sharpe',
                align: 'right',
                render: (run) => run.combined.returns?.sharpe.toFixed(2) ?? '–',
              },
              {
                key: 'dr',
                header: 'Diversification',
                align: 'right',
                render: (run) => run.combined.diversificationRatio?.toFixed(2) ?? '–',
              },
              { key: 'currency', header: 'Currency', render: (run) => run.combined.currency },
              { key: 'when', header: 'Run', render: (run) => fmtTime(run.at) },
            ]}
            actions={(run) => (
              <span className="row">
                <Button compact variant="ghost" onClick={() => setCurrent(run)}>
                  Show
                </Button>
                <Button
                  compact
                  variant="ghost"
                  onClick={() => {
                    setLegs(run.legs)
                    setForm(run.form)
                    window.scrollTo({ top: 0 })
                  }}
                >
                  Use
                </Button>
                <Button
                  compact
                  variant="ghost"
                  onClick={() => {
                    if (!connection) return
                    void removeCombined(connection.id, run.id).then(() => loadCombined(connection.id).then(setSaved))
                    if (current?.id === run.id) setCurrent(null)
                  }}
                >
                  Remove
                </Button>
              </span>
            )}
          />
        ) : (
          <EmptyState title="No combined runs yet.">
            Each combined backtest you run is kept on this device, with its legs’ figures.
          </EmptyState>
        )}
      </Section>
    </>
  )
}

/** The report of a combined run, section by section. */
function CombinedReportSections({ run }: { run: CombinedRun }) {
  const c = run.combined
  return (
    <>
      <Section label="Combined report">
        <div className="section-title">
          <h2 className="h2">{c.legs.map((leg) => leg.label).join(' + ')}</h2>
        </div>
        <div className="stack">
          <CombinedFigures run={run} />
          <div className="stack-sm">
            <h3 className="h3">The legs</h3>
            <LegsTable run={run} />
          </div>
          <div className="stack-sm">
            <h3 className="h3">Equity over time</h3>
            <CombinedEquity run={run} />
          </div>
          <div className="stack-sm">
            <h3 className="h3">Money and risk</h3>
            <p className="hint">
              A leg whose risk outruns its money makes most of the combined swings, whatever its budget.
            </p>
            <ShareBars legs={c.legs} />
          </div>
        </div>
      </Section>
      <Section variant="alt" label="Together">
        <div className="stack">
          <div className="stack-sm">
            <h3 className="h3">Against each market</h3>
            <p className="hint">
              The combined daily return fitted on every market the legs trade at once: each beta holds the other markets
              fixed.
            </p>
            <MarketBetas result={c} />
          </div>
          <div className="stack-sm">
            <h3 className="h3">How the legs moved together</h3>
            <CorrelationMatrix result={c} />
          </div>
          <div className="stack-sm">
            <h3 className="h3">Other ways to split the money</h3>
            <p className="hint">
              The same total money split by each rule, each leg’s result scaled to its share. Mean-variance optimisation
              is left out on purpose: with a few legs and a short history it fits the noise.
            </p>
            <BudgetSplits result={c} />
          </div>
          <CombinedNotes result={c} />
        </div>
      </Section>
    </>
  )
}

/** Adds or edits one leg: its name, strategy setup, budget, and its market's costs and fill. */
function LegSheet({
  leg,
  isNew,
  others,
  definitions,
  markets,
  currency,
  connectionId,
  onClose,
  onSave,
}: {
  leg: LegForm
  isNew: boolean
  others: LegForm[]
  definitions: StrategyDefinition[]
  markets: MarketRow[]
  currency: string
  connectionId: string | undefined
  onClose: () => void
  onSave: (leg: LegForm) => void
}) {
  const [draft, setDraft] = useState(leg)
  const [touched, setTouched] = useState(false)
  const ids = { label: useId(), budget: useId() }
  const definition = definitions.find((d) => d.name === draft.config.strategy)
  const symbol = draft.config.market.split(' ')[0] ?? ''
  // A market's remembered costs come with it, for a new leg and whenever its market changes.
  const first = useRef(!isNew)
  useMarketCosts(connectionId, symbol || undefined, (costs) => {
    if (first.current) {
      first.current = false
      return
    }
    setDraft((current) => ({ ...current, conditions: { ...current.conditions, ...costs } }))
  })
  const configErrors = validateConfig(draft.config, definition)
  const errors = legErrors(draft, others)
  const shown = touched ? errors : {}
  const save = () => {
    setTouched(true)
    if (!Object.keys(configErrors).length && !Object.keys(errors).length) onSave(draft)
  }
  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? 'Add a leg' : `Edit ${legName(leg)}`}
      wide
      footer={
        <div className="btn-row">
          <Button onClick={save}>{isNew ? 'Add the leg' : 'Save the leg'}</Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="stack">
        <Field
          id={ids.label}
          label="Name (optional)"
          hint={`“${draft.config.strategy} on ${draft.config.market}” when empty.`}
          error={shown.label}
        >
          <input
            id={ids.label}
            type="text"
            value={draft.label}
            maxLength={40}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            aria-describedby={describedBy(ids.label, 'hint', shown.label)}
          />
        </Field>
        <StrategyForm
          definitions={definitions}
          markets={markets}
          config={draft.config}
          onChange={(config) => setDraft({ ...draft, config })}
          errors={touched ? configErrors : {}}
        />
        <Field
          id={ids.budget}
          label="Budget"
          hint={`This leg’s own money, in ${currency}: it sizes from it and its own closed results.`}
          error={shown.budget}
        >
          <input
            id={ids.budget}
            className="mono"
            type="text"
            inputMode="decimal"
            value={draft.budget}
            onChange={(event) => setDraft({ ...draft, budget: event.target.value })}
            aria-invalid={shown.budget ? true : undefined}
            aria-describedby={describedBy(ids.budget, 'hint', shown.budget)}
          />
        </Field>
        <ConditionsFields
          form={draft.conditions}
          onChange={(conditions) => setDraft({ ...draft, conditions })}
          errors={shown}
          symbol={symbol}
          route={null}
          withCurrency={false}
        />
      </div>
    </Sheet>
  )
}
