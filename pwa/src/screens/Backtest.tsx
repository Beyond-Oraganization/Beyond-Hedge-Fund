import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useBot, useRead } from '../api/bot.ts'
import { CommandFailure } from '../api/client.ts'
import { cmd } from '../api/commands.ts'
import type { SessionSizing } from '../api/types.ts'
import { curveByTime, endedAbove, isDeviceRun, keep, keepScenarios, kellyShare, METHOD_NAMES, type DeviceRun, type KeptScenarios, type SavedRun } from '../backtest/runs.ts'
import { clearRuns, loadDetails, loadRuns, saveRun } from '../backtest/saved.ts'
import { FailurePanel } from '../components/Answer.tsx'
import { MonteCarloSection, ReportFigures } from '../components/backtest/Report.tsx'
import { MarketBetaChart } from '../components/backtest/MarketBetaChart.tsx'
import { TradeReturnsChart } from '../components/backtest/TradeReturnsChart.tsx'
import { Chart } from '../components/Chart.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { describedBy, Field, Segmented } from '../components/Field.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { StrategyForm } from '../components/StrategyForm.tsx'
import { Button, ButtonLink, Callout, EmptyState, Section, Skeleton } from '../components/ui.tsx'
import { readCopy, updateCopy, type CopyInfo } from '../data/candles.ts'
import { useEngine, useEngineVersion } from '../engine/context.ts'
import { EngineCancelled } from '../engine/engine.ts'
import type { PathMethod } from '../engine/types.ts'
import { fmtCount, fmtMoney, fmtPercent, fmtSignedMoney, fmtSignedPercent, fmtTime, tone } from '../format.ts'
import { useMarkets, useStatus, useStrategies } from '../hooks/data.ts'
import { keepsEverything } from '../storage/local-store.ts'
import { offerLink } from '../features/menu/menu.ts'
import { PublishCard } from '../features/published/PublishCard.tsx'
import { applySetup, configFromInput, initialConfig, toInput, validateConfig, type StrategyConfig } from '../strategy/config.ts'

const dateOrNull = (text: string) => (text ? Date.parse(`${text}T00:00:00Z`) : null)
/** A UTC time as the engine reads it, without "Z". */
const utc = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString().slice(0, 19))

type Phase =
  | { step: 'candles'; market: string; info: CopyInfo | null }
  | { step: 'kelly' }
  | { step: 'engine' }
  | { step: 'scenarios'; done: number; total: number; method: PathMethod }
  | { step: 'summary' }

const SCENARIOS = ['0', '100', '200', '500', '1000'] as const
const METHODS: { value: PathMethod; label: string }[] = [
  { value: 'Bootstrap', label: 'Bootstrap (real moves)' },
  { value: 'BrownianMotion', label: 'Brownian motion (random walk)' },
]

function phaseWords(phase: Phase): string {
  if (phase.step === 'candles')
    return phase.info
      ? `Copying ${phase.market} candles from the bot: ${fmtCount(phase.info.count)}, up to ${fmtTime(phase.info.newest)} UTC…`
      : `Bringing this device’s ${phase.market} candles up to date…`
  if (phase.step === 'kelly') return 'Asking the bot for the Kelly sizing it would trade with…'
  if (phase.step === 'engine') return 'Backtesting on this device…'
  if (phase.step === 'scenarios') return `Backtesting alternative price histories by ${METHOD_NAMES[phase.method]}: ${fmtCount(phase.done)} of ${fmtCount(phase.total)} done…`
  return 'Summing up the alternative histories…'
}

/** A seed for one Monte Carlo: every worker makes its scenarios from it. */
const newSeed = () => Math.floor(Math.random() * 2 ** 31)

/** "sample on XAUUSD 1h". */
const titleOf = (run: SavedRun) => (isDeviceRun(run) ? `${run.result.strategy} on ${run.result.market.symbol} ${run.result.market.interval}` : `${run.report.strategy} on ${run.report.market}`)
const marketOf = (run: SavedRun) => (isDeviceRun(run) ? `${run.result.market.symbol} ${run.result.market.interval}` : run.report.market)

export default function Backtest() {
  const { connection } = useBot()
  const strategies = useStrategies()
  const markets = useMarkets()
  const status = useStatus({ enabled: connection?.person?.role !== 'client' })
  const read = useRead()
  const engine = useEngine()
  const engineVersion = useEngineVersion()
  // The owner offers a backtested setup to clients (the API key acts as the owner).
  const owner = (connection?.person?.role ?? 'owner') === 'owner'
  const [params] = useSearchParams()
  const [edited, setDraft] = useState<StrategyConfig | null>(null)
  const [balance, setBalance] = useState('1000')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [scenarios, setScenarios] = useState<(typeof SCENARIOS)[number]>('200')
  const [method, setMethod] = useState<PathMethod>('Bootstrap')
  const [touched, setTouched] = useState(false)
  const [phase, setPhase] = useState<Phase | null>(null)
  const [failure, setFailure] = useState<CommandFailure | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [current, setCurrent] = useState<SavedRun | null>(null)
  const [saved, setSaved] = useState<SavedRun[]>([])
  const [compare, setCompare] = useState<string[]>([])
  // Staff and the owner publish a run's figures for everyone (features/published).
  const [publishing, setPublishing] = useState<DeviceRun | null>(null)
  const [published, setPublished] = useState<string | null>(null)
  const stop = useRef<AbortController | null>(null)
  const ids = { balance: useId(), from: useId(), to: useId() }

  // Staff and the owner (and the API key) size by Kelly, which may run a backtest on the server, and publish runs; a
  // client the fund trusts backtests here without either (Fund/CommandPolicy.cs).
  const staff = connection?.person?.role !== 'client'
  const definitions = useMemo(() => {
    const all = strategies.data?.parsed.ok ? strategies.data.parsed.value : null
    if (!all || staff) return all
    return all.map((d) => (d.sizing ? { ...d, sizing: { ...d.sizing, methods: d.sizing.methods.filter((method) => method.name !== 'kelly') } } : d))
  }, [strategies.data, staff])
  const rows = markets.data?.parsed.ok ? markets.data.parsed.value : null
  const [symbol, interval] = (params.get('market') ?? '').split(' ')
  const draft = edited ?? (definitions && rows ? initialConfig(definitions, rows, { symbol, interval, strategy: params.get('strategy') }) : null)
  const botVersion = status.data?.parsed.ok ? status.data.parsed.value.version : null
  useEffect(() => {
    if (connection) void loadRuns(connection.id).then(setSaved)
  }, [connection])

  const definition = definitions?.find((d) => d.name === draft?.strategy)
  const errors = useMemo(() => {
    const found = draft ? validateConfig(draft, definition) : {}
    if (!(Number(balance) > 0)) found.balance = 'The starting balance must be above 0.'
    if (from && to && from >= to) found.to = 'The end must be after the start.'
    return found
  }, [draft, definition, balance, from, to])

  /** Shows a saved run, with its Monte Carlo's paths when this device kept them. */
  const show = async (run: SavedRun) => {
    setCurrent(run)
    if (!connection || !isDeviceRun(run) || !run.monteCarlo || run.monteCarlo.details) return
    const details = await loadDetails(connection.id, run.id)
    if (details) setCurrent({ ...run, monteCarlo: { ...run.monteCarlo, details } })
  }

  /** Brings this device's candles up to date, asks the bot for its Kelly when the sizing needs it, then backtests here. */
  const start = async () => {
    setTouched(true)
    if (!draft || !connection || Object.keys(errors).length) return
    const input = toInput(draft, definition)
    const market = `${input.symbol} ${input.interval}`
    const asked = Number(scenarios)
    const controller = new AbortController()
    stop.current = controller
    setFailure(null)
    setProblem(null)
    try {
      setPhase({ step: 'candles', market, info: null })
      await updateCopy(connection.id, market, read, { signal: controller.signal, onProgress: (info) => setPhase({ step: 'candles', market, info }) })
      const candles = await readCopy(connection.id, market)
      if (!candles) throw new Error(`This device has no ${market} candles.`)
      const share = kellyShare(input.sizing)
      let kelly: SessionSizing['kelly'] = null
      if (share != null) {
        setPhase({ step: 'kelly' })
        kelly = ((await read(cmd.kelly(input, share), controller.signal)).json as SessionSizing | null)?.kelly ?? null
        if (!kelly) throw new Error('The bot’s Kelly sizing could not be read.')
      }
      setPhase({ step: 'engine' })
      const request = {
        strategy: input.strategy,
        symbol: input.symbol,
        interval: input.interval,
        parameters: input.params,
        rules: input.rules,
        sizing: input.sizing,
        kelly,
        balance: Number(balance),
        from: utc(dateOrNull(from)),
        to: utc(dateOrNull(to)),
      }
      const answer = await engine().backtest(request, candles, controller.signal)
      if (!answer.ok) return setProblem(answer.error.message)
      let monteCarlo: KeptScenarios | null = null
      if (asked) {
        setPhase({ step: 'scenarios', done: 0, total: asked, method })
        const simulated = await engine().simulate({ ...request, scenarios: { method, seed: newSeed() } }, candles, asked, {
          signal: controller.signal,
          onProgress: (done, total) => setPhase({ step: 'scenarios', done, total, method }),
        })
        if (!simulated.ok) return setProblem(simulated.error.message)
        setPhase({ step: 'summary' })
        const summed = await engine().summarize({ initialBalance: Number(balance), real: answer.realScenario, results: simulated.results }, controller.signal)
        if (!summed.ok) return setProblem(summed.error.message)
        monteCarlo = keepScenarios(answer, simulated, summed.summary)
      }
      const run: DeviceRun = {
        kind: 'device', id: `${Date.now()}`, at: Date.now(), input, balance: Number(balance), from: dateOrNull(from), to: dateOrNull(to),
        scenarios: asked, method, result: keep(answer), monteCarlo,
      }
      setCurrent(run)
      setSaved(await saveRun(connection.id, run, { keepEverything: keepsEverything() }))
    } catch (error) {
      if (error instanceof EngineCancelled || (error instanceof CommandFailure && error.kind === 'cancelled')) return
      if (error instanceof CommandFailure && error.kind === 'usage')
        setProblem(`This bot cannot hand out its candles or its Kelly sizing yet (${error.message}) Backtests on this device need bot 2.1.0 or later: update the bot.`)
      else if (error instanceof CommandFailure) setFailure(error)
      else setProblem((error as Error).message)
    } finally {
      setPhase(null)
      stop.current = null
    }
  }

  const compared = saved.filter((run) => compare.includes(run.id))
  const device = current && isDeviceRun(current) ? current : null
  const curve = device ? curveByTime(device.result.curve) : current && !isDeviceRun(current) ? (current.curve?.map((p) => ({ time: p.time, value: p.balance })) ?? null) : null

  return (
    <>
      <ScreenHead
        kicker="Backtest"
        title="Replay a strategy."
        lead="This device replays the strategy over its own copy of the bot’s candles, with the bot’s own code, then backtests it again on alternative price histories of the same dates. The bot only hands out the candles, and its Kelly sizing when you size by Kelly."
      />
      <Section variant="alt" label="Backtest settings">
        {!definitions || !rows || !draft ? (
          strategies.error || markets.error ? <FailurePanel failure={(strategies.error ?? markets.error)!} /> : <Skeleton lines={5} />
        ) : (
          <form
            className="stack"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void start()
            }}
          >
            <StrategyForm definitions={definitions} markets={rows} config={draft} onChange={setDraft} errors={touched ? errors : {}} />
            <div className="form-grid">
              <Field id={ids.balance} label="Starting balance" error={touched ? errors.balance : undefined} hint="Simulated; in the symbol’s quote currency.">
                <input
                  id={ids.balance}
                  className="mono"
                  type="number"
                  min="1"
                  step="any"
                  inputMode="decimal"
                  value={balance}
                  onChange={(event) => setBalance(event.target.value)}
                  aria-describedby={describedBy(ids.balance, 'hint', touched ? errors.balance : null)}
                />
              </Field>
              <Field id={ids.from} label="From (UTC, optional)" hint="The first stored candle when empty.">
                <input id={ids.from} type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-describedby={describedBy(ids.from, 'hint')} />
              </Field>
              <Field id={ids.to} label="To (UTC, optional)" error={touched ? errors.to : undefined} hint="The newest candle when empty.">
                <input id={ids.to} type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-describedby={describedBy(ids.to, 'hint', touched ? errors.to : null)} />
              </Field>
            </div>
            <Segmented
              name="monte-carlo"
              legend="Monte Carlo"
              value={scenarios}
              onChange={setScenarios}
              options={SCENARIOS.map((value) => ({ value, label: value === '0' ? 'Off' : `${fmtCount(Number(value))} scenarios` }))}
              hint="How many alternative price histories of the same dates to backtest the strategy on, each made up at random. 200 take seconds on a computer, longer on a phone."
            />
            {scenarios !== '0' ? (
              <Segmented
                name="price-paths"
                legend="Alternative histories by"
                value={method}
                onChange={setMethod}
                options={METHODS}
                hint="The bootstrap glues real candle moves in random blocks, so real tails and calm or wild spells stay. Brownian motion is a calm random walk with the real drift and volatility: a baseline."
              />
            ) : null}
            {engineVersion && botVersion && engineVersion !== botVersion ? (
              <Callout label="Versions" tone="warn">
                <p>
                  This app backtests with engine {engineVersion}; the bot trades with {botVersion}. Results may differ from what the bot would trade until both are the same
                  version.
                </p>
              </Callout>
            ) : null}
            <div className="btn-row">
              <Button type="submit" busy={phase != null} icon="backtest">
                Run the backtest
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
              <Callout label="Not backtested" tone="error">
                <p>{problem}</p>
              </Callout>
            ) : null}
          </form>
        )}
      </Section>
      {current ? (
        <Section label="Report">
          <div className="section-title">
            <h2 className="h2">{titleOf(current)}</h2>
          </div>
          <div className="stack">
            <ReportFigures run={current} />
            <div className="stack-sm">
              <h3 className="h3">Balance over time</h3>
              {curve?.length ? (
                <Chart
                  lines={[{ name: 'Balance', points: curve, width: 3 }]}
                  label={`Balance from ${fmtMoney(device?.result.initialBalance ?? curve[0]?.value)} to ${fmtMoney(curve.at(-1)?.value)}, after each closed trade`}
                  height={300}
                />
              ) : (
                <p className="p">
                  {device ? 'No trade closed, so the balance never changed.' : 'This run was saved before backtests ran on this device: run it again to see its balance after every trade.'}
                </p>
              )}
            </div>
            <div className="stack-sm">
              <h3 className="h3">Trade returns</h3>
              {device?.result.tradeReturns.length ? (
                <>
                  <p className="hint">How far the price moved in each position’s favour, whatever the position’s size.</p>
                  <TradeReturnsChart
                    returns={device.result.tradeReturns}
                    averageWin={device.result.kelly.wins ? device.result.kelly.averageWin : null}
                    averageLoss={device.result.kelly.losses ? device.result.kelly.averageLoss : null}
                  />
                </>
              ) : (
                <p className="p">{device ? 'No trade closed.' : 'Run it again to see each trade’s return.'}</p>
              )}
            </div>
            <div className="stack-sm">
              <h3 className="h3">Against the market</h3>
              {device?.result.marketBeta && device.result.dayDots?.length ? (
                <>
                  <p className="hint">
                    Each dot is a day: the market’s move across, the strategy’s up, its open positions valued at the day’s close. The slope of the line is beta, how much of the
                    market’s move the strategy carried. Where it crosses the middle line is alpha, what it made on a day the market stood still.
                  </p>
                  <MarketBetaChart dots={device.result.dayDots} beta={device.result.marketBeta} />
                </>
              ) : (
                <p className="p">
                  {device?.result.marketBetaMissing
                    ? `No beta or alpha: ${device.result.marketBetaMissing}.`
                    : device?.result.dayDots
                      ? 'No beta or alpha for this run.'
                      : 'Run it again to see how it moved with the market.'}
                </p>
              )}
            </div>
            <Callout label="What a backtest leaves out">
              <p>No fees, spread or margin. Positions still open at the end are not in the balance. The bot trades with the same decision code, so a backtest and the live strategy cannot drift apart.</p>
              <p>A strategy that is long in rises and short in falls shows a V of dots, a beta near 0 and a large alpha: that is timing the market, which one straight line cannot tell apart.</p>
            </Callout>
          </div>
        </Section>
      ) : null}
      {device?.monteCarlo || device?.result.monteCarlo ? (
        <Section variant="alt" label="Monte Carlo">
          <div className="section-title">
            <h2 className="h2">Monte Carlo</h2>
          </div>
          {device.monteCarlo ? (
            <MonteCarloSection mc={device.monteCarlo} />
          ) : (
            <p className="p">
              This run was saved with the Monte Carlo used before, which resampled its trades: {fmtPercent(device.result.monteCarlo!.endedAboveStartPercent, 1)} of{' '}
              {fmtCount(device.result.monteCarlo!.paths)} paths ended above the start. Run it again to backtest it on alternative price histories.
            </p>
          )}
        </Section>
      ) : null}
      <Section variant={device?.monteCarlo || device?.result.monteCarlo ? 'default' : 'alt'} label="Saved runs">
        <div className="section-title">
          <h2 className="h2">Saved runs</h2>
          {saved.length ? (
            <button
              type="button"
              className="link small"
              onClick={() => {
                if (connection) void clearRuns(connection.id).then(() => setSaved([]))
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
        {published ? (
          <Callout label="Published">
            {published}
          </Callout>
        ) : null}
        {publishing ? (
          <PublishCard key={publishing.id} run={publishing} definitions={definitions} onClose={() => setPublishing(null)} onDone={setPublished} />
        ) : null}
        {saved.length ? (
          <div className="stack">
            <DataTable
              caption="Saved backtests"
              rows={[...saved].reverse()}
              rowKey={(run) => run.id}
              columns={[
                { key: 'market', header: 'Market', card: 'title', render: marketOf },
                {
                  key: 'pl',
                  header: 'Profit / loss',
                  card: 'sub',
                  align: 'right',
                  render: (run) => {
                    const [profit, percent] = isDeviceRun(run) ? [run.result.profitLoss, run.result.returnPercent] : [run.report.profitLoss, run.report.returnPercent]
                    return <span className={tone(profit) ?? undefined}>{fmtSignedPercent(percent)}</span>
                  },
                },
                {
                  key: 'setup',
                  header: 'Setup',
                  wrap: true,
                  render: (run) => (isDeviceRun(run) ? run.result.setup : `${run.report.parameters ?? ''}${run.report.rules.length ? `, rules: ${run.report.rules.join('; ')}` : ''}`),
                },
                { key: 'trades', header: 'Trades', align: 'right', render: (run) => fmtCount(isDeviceRun(run) ? run.result.closedTrades : run.report.trades) },
                { key: 'dd', header: 'Max drawdown', align: 'right', render: (run) => fmtPercent(isDeviceRun(run) ? run.result.maxDrawdownPercent : run.report.maxDrawdownPercent) },
                {
                  key: 'mc',
                  header: 'Ended above start',
                  align: 'right',
                  render: (run) => {
                    const above = endedAbove(run)
                    return above ? `${fmtPercent(above.percent, 1)} · ${above.method}` : '–'
                  },
                },
                { key: 'when', header: 'Run', render: (run) => fmtTime(run.at) },
              ]}
              actions={(run) => (
                <span className="row">
                  <Button compact variant="ghost" onClick={() => void show(run)}>
                    Show
                  </Button>
                  <Button
                    compact
                    variant="ghost"
                    onClick={() => {
                      // Fitted to the catalog as it is now: a run from before rules had parameters that may be gone.
                      const used = configFromInput(run.input)
                      const known = definitions?.find((d) => d.name === used.strategy)
                      setDraft(known ? applySetup(used, used, known).config : used)
                      setTouched(true)
                      window.scrollTo({ top: 0 })
                    }}
                  >
                    Use
                  </Button>
                  {owner ? (
                    <ButtonLink compact variant="ghost" to={offerLink(run.input)}>
                      Offer to clients
                    </ButtonLink>
                  ) : null}
                  {staff && isDeviceRun(run) ? (
                    <Button
                      compact
                      variant="ghost"
                      onClick={() => {
                        setPublished(null)
                        setPublishing(run)
                      }}
                    >
                      Publish
                    </Button>
                  ) : null}
                  <label className="check small">
                    <input
                      type="checkbox"
                      checked={compare.includes(run.id)}
                      onChange={(event) => setCompare((list) => (event.target.checked ? [...list, run.id].slice(-4) : list.filter((id) => id !== run.id)))}
                    />
                    Compare
                  </label>
                </span>
              )}
            />
            {compared.length > 1 ? (
              <DataTable
                mode="scroll"
                caption="Comparison"
                rows={COMPARED_ROWS}
                rowKey={(row) => row[0]}
                columns={[
                  { key: 'what', header: '', render: (row) => <strong className="label">{row[0]}</strong> },
                  ...compared.map((run, index) => ({ key: run.id, header: `Run ${index + 1}`, render: (row: CompareRow) => row[1](run) })),
                ]}
              />
            ) : compare.length === 1 ? (
              <p className="hint">Tick one more run to compare.</p>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No runs yet.">
            {keepsEverything()
              ? 'Each backtest you run is kept in this app’s database, with every scenario of its Monte Carlo.'
              : 'Each backtest you run is kept on this device (the last 50), with its Monte Carlo’s results.'}
          </EmptyState>
        )}
      </Section>
    </>
  )
}

type CompareRow = [string, (run: SavedRun) => string]

const COMPARED_ROWS: CompareRow[] = [
  ['Market', marketOf],
  ['Setup', (run) => (isDeviceRun(run) ? run.result.setup : (run.report.parameters ?? ''))],
  ['Period', (run) => (isDeviceRun(run) ? `${fmtTime(Date.parse(run.result.start))} → ${fmtTime(Date.parse(run.result.end))}` : `${fmtTime(run.report.start)} → ${fmtTime(run.report.end)}`)],
  [
    'Profit / loss',
    (run) => (isDeviceRun(run) ? `${fmtSignedMoney(run.result.profitLoss)} ${fmtSignedPercent(run.result.returnPercent)}` : `${fmtSignedMoney(run.report.profitLoss)} ${fmtSignedPercent(run.report.returnPercent)}`),
  ],
  ['Trades', (run) => (isDeviceRun(run) ? `${run.result.closedTrades} (${fmtPercent(run.result.winRate, 1)} won)` : `${run.report.trades} (${fmtPercent(run.report.winRate, 1)} won)`)],
  [
    'Max drawdown',
    (run) => (isDeviceRun(run) ? `${fmtSignedMoney(run.result.maxDrawdown)} (${fmtPercent(run.result.maxDrawdownPercent)})` : `${fmtSignedMoney(run.report.maxDrawdown)} (${fmtPercent(run.report.maxDrawdownPercent)})`),
  ],
  [
    'Monte Carlo',
    (run) => {
      const above = endedAbove(run)
      return above ? `${fmtPercent(above.percent, 1)} of ${fmtCount(above.of)} ended above the start (${above.method})` : '–'
    },
  ],
  ['Real history beat', (run) => (isDeviceRun(run) && run.monteCarlo ? `${fmtPercent(run.monteCarlo.summary.realBeatPercent, 0)} of the alternative pasts` : '–')],
]
