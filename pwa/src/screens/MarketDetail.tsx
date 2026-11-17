import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAction, useCommand } from '../api/bot.ts'
import { CommandFailure } from '../api/client.ts'
import { cmd } from '../api/commands.ts'
import { parseInterval } from '../api/intervals.ts'
import { parseCandles, parseOldestCandle, type CandleRow } from '../api/parse/markets.ts'
import { parseSignal, type SignalReading } from '../api/parse/strategies.ts'
import { Answer, FailurePanel } from '../components/Answer.tsx'
import { Chart, type ChartLine } from '../components/Chart.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { Decision } from '../components/Decision.tsx'
import { Segmented } from '../components/Field.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { Button, ButtonLink, Callout, Section } from '../components/ui.tsx'
import { fmtNumber, fmtPrice, fmtTime } from '../format.ts'
import { useStrategies } from '../hooks/data.ts'
import { useMemoryWarning } from '../hooks/memory.ts'
import { useEngine } from '../engine/context.ts'
import type { CandleColumns } from '../engine/types.ts'
import { useSettings } from '../state/settings.ts'

const COUNTS = [50, 200, 500, 1000, 2000]

/** Earlier candles read too, so a strategy's averages settle before the first candle drawn. */
const WARMUP = 1000

/** The candles as the engine takes them: number columns, open times in Unix seconds. */
const columnsOf = (candles: CandleRow[]): CandleColumns => ({
  time: Float64Array.from(candles, (c) => Math.round(c.time / 1000)),
  open: Float64Array.from(candles, (c) => c.open),
  high: Float64Array.from(candles, (c) => c.high),
  low: Float64Array.from(candles, (c) => c.low),
  close: Float64Array.from(candles, (c) => c.close),
  volume: Float64Array.from(candles, (c) => c.volume),
})

export default function MarketDetail() {
  const { symbol = '', interval = '' } = useParams()
  const market = `${symbol} ${interval}`
  const info = parseInterval(interval)
  const { candles: count, change } = useSettings()
  const strategies = useStrategies()
  const definitions = useMemo(() => (strategies.data?.parsed.ok ? strategies.data.parsed.value : []), [strategies.data])
  const [chosen, setChosen] = useState<string | null>(null)
  const definition = definitions.find((d) => d.name === chosen) ?? definitions[0]
  const defaults = useMemo(() => Object.fromEntries((definition?.parameters ?? []).map((p) => [p.name, p.default])), [definition])
  const run = useAction()
  const engine = useEngine()
  const warning = useMemoryWarning(market)

  const query = useCommand('candles', cmd.candlesShow(symbol, interval, { last: count + WARMUP }), parseCandles)
  const all = useMemo(() => (query.data?.parsed.ok ? query.data.parsed.value : []), [query.data])
  const shown = useMemo(() => all.slice(-count), [all, count])
  // The lines the strategy's rules compare candles with, worked out on this device by the strategy itself (the engine,
  // with the strategy pack): the app holds no strategy's formulas.
  const levels = useQuery({
    queryKey: ['levels', market, definition?.name ?? null, count, all.length, all.at(-1)?.time ?? null],
    enabled: Boolean(definition && all.length),
    staleTime: Infinity,
    queryFn: ({ signal }) => engine().levels({ strategy: definition!.name, symbol, interval, parameters: defaults }, columnsOf(all), count, signal),
  })
  const chartLines = useMemo<ChartLine[]>(
    () => (levels.data?.ok ? levels.data.lines.map((line) => ({ name: line.name, points: line.points.map((p) => ({ time: p.time * 1000, value: p.value })), dashed: true })) : []),
    [levels.data],
  )

  const [signal, setSignal] = useState<SignalReading | null>(null)
  const [signalFailure, setSignalFailure] = useState<CommandFailure | null>(null)
  const [signalBusy, setSignalBusy] = useState(false)
  const [oldest, setOldest] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const askSignal = async () => {
    setSignalBusy(true)
    setSignalFailure(null)
    try {
      const reading = parseSignal(await run(cmd.signal({ strategy: definition!.name, symbol, interval, params: defaults })))
      setSignal(reading.ok ? reading.value : null)
    } catch (error) {
      setSignalFailure(error as CommandFailure)
    } finally {
      setSignalBusy(false)
    }
  }

  return (
    <>
      <ScreenHead
        kicker={info ? `Every ${info.code}` : 'Market'}
        title={market}
        crumbs={[{ label: 'Markets', to: '/markets' }, { label: market }]}
        actions={
          <>
            <ButtonLink to={`/backtest?market=${encodeURIComponent(market)}`} variant="ghost" icon="backtest">
              Backtest
            </ButtonLink>
            <ButtonLink to={`/trading?start=${encodeURIComponent(market)}`} icon="play">
              Trade it
            </ButtonLink>
          </>
        }
      />
      <Section variant="alt" label="Chart">
        <div className="spread" style={{ marginBottom: 16 }}>
          <Segmented name="count" legend="Candles" value={String(count)} onChange={(value) => void change({ candles: Number(value) })} options={COUNTS.map((n) => ({ value: String(n), label: String(n) }))} />
          {definitions.length > 1 ? (
            <Segmented name="strategy" legend="Lines of" value={definition?.name ?? ''} onChange={setChosen} options={definitions.map((d) => ({ value: d.name, label: d.title }))} />
          ) : null}
        </div>
        <Answer query={query} lines={6}>
          {(value) =>
            value.length ? (
              <div className="stack-sm">
                <Chart candles={shown} lines={chartLines} label={`${market}: ${shown.length} candles from ${fmtTime(shown[0]?.time)} to ${fmtTime(shown.at(-1)?.time)} UTC, last close ${fmtPrice(shown.at(-1)?.close)}`} />
                {chartLines.length && definition ? (
                  <p className="chart-legend">
                    <span>
                      <i className="dash" /> {chartLines.map((line) => line.name).join(', ')}: what {definition.title}’s default rules compare candles with
                    </span>
                  </p>
                ) : null}
                {levels.data && !levels.data.ok ? <p className="hint">The strategy’s lines could not be drawn: {levels.data.error.message}</p> : null}
                <p className="hint">The lines are worked out on this device by the strategy itself, from the bot’s candles, so the chart does not load the market into the bot’s memory.</p>
              </div>
            ) : (
              <Callout label="No candles">
                <p>
                  {market} has no stored candles. <Link className="underline" to={`/markets?add=${symbol}&interval=${encodeURIComponent(interval)}`}>Add it</Link> to download them.
                </p>
              </Callout>
            )
          }
        </Answer>
      </Section>
      <Section label="Decision now">
        <div className="cols2">
          <div className="stack">
            <h2 className="h2">What {definition?.title ?? 'the strategy'} decides now</h2>
            <p className="p">The decision on the newest closed candle, with the values behind it. It syncs first and never trades. It needs the bot to be signed in.</p>
            {warning ? (
              <Callout label="Memory" tone="warn">
                <p>{warning}</p>
              </Callout>
            ) : null}
            <div className="btn-row">
              <Button busy={signalBusy} disabled={!definition} onClick={() => void askSignal()}>
                Ask for the signal
              </Button>
            </div>
            {signalFailure ? <FailurePanel failure={signalFailure} /> : null}
          </div>
          <div>{signal ? <Decision reading={signal} /> : null}</div>
        </div>
      </Section>
      <Section variant="alt" label="Data">
        <div className="stack">
          <h2 className="h2">Data</h2>
          <div className="btn-row">
            <Button
              variant="ghost"
              busy={busy === 'oldest'}
              onClick={async () => {
                setBusy('oldest')
                try {
                  const reading = parseOldestCandle(await run(cmd.candlesOldest(symbol, interval)))
                  setOldest(reading.ok ? `${reading.value.broker}’s oldest ${market} candle opened ${fmtTime(reading.value.time)} UTC (close ${fmtPrice(reading.value.close)}).` : 'The answer could not be read.')
                } catch (error) {
                  setOldest((error as Error).message)
                } finally {
                  setBusy(null)
                }
              }}
            >
              The broker’s oldest candle
            </Button>
          </div>
          {oldest ? <Callout>{oldest}</Callout> : null}
          <details className="more-box">
            <summary>The candles as a table</summary>
            <DataTable
              mode="scroll"
              maxHeight
              caption="Candles"
              rows={[...shown].reverse()}
              rowKey={(row) => String(row.time)}
              columns={[
                { key: 'time', header: 'Open (UTC)', render: (row) => fmtTime(row.time) },
                { key: 'open', header: 'Open', align: 'right', render: (row) => fmtPrice(row.open) },
                { key: 'high', header: 'High', align: 'right', render: (row) => fmtPrice(row.high) },
                { key: 'low', header: 'Low', align: 'right', render: (row) => fmtPrice(row.low) },
                { key: 'close', header: 'Close', align: 'right', render: (row) => <span className={row.close >= row.open ? 'gain' : 'loss'}>{fmtPrice(row.close)}</span> },
                { key: 'volume', header: 'Volume', align: 'right', render: (row) => fmtNumber(row.volume) },
              ]}
            />
          </details>
        </div>
      </Section>
    </>
  )
}
