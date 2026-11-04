import { afterAll, describe, expect, it } from 'vitest'
import { createBot } from '../../../mock-bot/bot.mjs'
import { legacyStrategies, realBacktest, realMarketList, realSizedBacktest, realSizedStrategiesJson, realStrategiesJson } from '../fixtures/real.ts'
import type { CommandResult } from '../types.ts'
import { parseSession } from '../session.ts'
import { notices } from './blocks.ts'
import { parseCandles, parseMarketList, parseMarketSync, parseOldestCandle } from './markets.ts'
import { parseOrders, readFill } from './orders.ts'
import { parseStatus } from './status.ts'
import { parseBacktest, parseSignal, parseStrategyCatalog, readKelly, readParameterLine, readSignal, readStrategyLine } from './strategies.ts'

const bot = createBot({ ticking: false, addDelayMs: 0, start: Date.UTC(2026, 10, 4, 10, 15) })
afterAll(() => bot.stop())
const run = async (...args: string[]): Promise<CommandResult> => {
  const result = await bot.run(args)
  return { ...result, command: args.join(' '), elapsedMs: 3, ok: result.exitCode === 0 }
}

describe('the bot’s own approved outputs', () => {
  it('reads the backtest report (Backtest_PrintsTheReport.txt)', () => {
    const report = parseBacktest(realBacktest)
    expect(report.ok && report.value).toMatchObject({
      strategy: 'sample',
      market: 'BTCUSDT 1h',
      start: Date.UTC(2025, 0, 6, 0, 0),
      end: Date.UTC(2025, 2, 30, 8, 0),
      candles: 2000,
      initialBalance: 1000,
      finalBalance: 1015.03,
      profitLoss: 15.03,
      returnPercent: 1.5,
      trades: 80,
      won: 23,
      lost: 57,
      winRate: 28.8,
      average: 0.19,
      best: 19.4,
      bestPercent: 1.93,
      maxDrawdown: -29.14,
      maxDrawdownPercent: -2.8,
      stillOpen: 0,
      computedMs: 87,
      parameters: 'length=23 spread=1 lines=2',
      rules: ['open long on cross up below 1', 'close long on cross down below 1'],
    })
    expect(readParameterLine('length=23 spread=1 lines=2')).toEqual({ length: 23, spread: 1, lines: 2 })
  })

  it('splits the strategy line into parameters and rules, with or without rules', () => {
    expect(readStrategyLine('length=30 spread=1 lines=2, rules: open short on cross down above 1')).toEqual({ parameters: 'length=30 spread=1 lines=2', rules: ['open short on cross down above 1'] })
    expect(readStrategyLine('length=23 spread=1 lines=2 trigger=1')).toEqual({ parameters: 'length=23 spread=1 lines=2 trigger=1', rules: [] })
    expect(readStrategyLine(null)).toEqual({ parameters: null, rules: [] })
  })

  it('reads the Sizing and Kelly rows of a bot with position sizing, and the backtest it was stored as', () => {
    const report = parseBacktest(realSizedBacktest)
    expect(report.ok && report.value).toMatchObject({
      finalBalance: 1015.03,
      sizing: '50% of the balance per position',
      kelly: { value: '3.26% of the balance', detail: 'win rate 28.8%, loss rate 71.3%, payoff 2.80 (average win +1.22%, average loss -0.43%)', usable: true },
      storedAs: 1,
      parameters: 'length=23 spread=1 lines=2',
    })
    const before = parseBacktest(realBacktest)
    expect(before.ok && before.value).toMatchObject({ sizing: null, kelly: null, storedAs: null })
  })

  it('reads a Kelly row that is not usable', () => {
    expect(readKelly('not usable: only 12 closed trades (it needs at least 20); win rate 50.0%, loss rate 50.0%, payoff 2.00 (average win +2%, average loss -1%)')).toEqual({
      value: 'not usable',
      detail: 'only 12 closed trades (it needs at least 20); win rate 50.0%, loss rate 50.0%, payoff 2.00 (average win +2%, average loss -1%)',
      usable: false,
    })
  })

  it('reads how positions can be sized from strategies --json, and none from a bot before sizing', () => {
    const sized = parseStrategyCatalog(realSizedStrategiesJson)
    expect(sized.ok && sized.value[0]?.sizing).toEqual({
      default: 'percent:50',
      syntax: 'percent:N | fixed:AMOUNT | kelly[:N]',
      methods: [
        expect.objectContaining({ name: 'percent', title: 'Percentage of the balance', value: { name: 'percent', default: 50, min: 0.01, max: 100, meaning: 'Percent of the balance each position is worth' } }),
        expect.objectContaining({ name: 'fixed', value: expect.objectContaining({ name: 'amount', min: 0.01, max: 1000000000 }) }),
        expect.objectContaining({ name: 'kelly', value: expect.objectContaining({ name: 'share', default: 100, min: 1, max: 100 }) }),
      ],
    })
    const before = parseStrategyCatalog(realStrategiesJson)
    expect(before.ok && before.value[0]?.sizing).toBeNull()
  })

  it('reads the strategy catalog from strategies --json', () => {
    const catalog = parseStrategyCatalog(realStrategiesJson)
    expect(catalog.ok).toBe(true)
    if (!catalog.ok) return
    const [sample] = catalog.value
    expect(sample).toMatchObject({ name: 'sample', title: 'Sample bands', defaultMarket: { symbol: 'XAUUSD', interval: '1h' } })
    expect(sample?.parameters).toEqual([
      { name: 'length', default: 23, min: 1, max: 500, meaning: 'Candles the EMA averages', whole: true },
      { name: 'spread', default: 1, min: 1, max: 20, meaning: 'Tenths of a percent between neighbouring bands', whole: true },
      { name: 'lines', default: 2, min: 1, max: 10, meaning: 'Bands on each side of the EMA', whole: true },
    ])
    expect(sample?.rules).toEqual({ defaults: ['open long on cross up below 1', 'close long on cross down below 1'], syntax: 'open|close long|short on cross up|down below|above N' })
  })

  it('says why a catalog of the wrong shape cannot be read, instead of guessing', () => {
    expect(parseStrategyCatalog({ ...realStrategiesJson, json: [{ name: 'x' }] }).ok).toBe(false)
    expect(parseStrategyCatalog({ ...realStrategiesJson, json: { strategies: [] } }).ok).toBe(false)
  })

  it('reads the catalog of a bot from before rules (no --json), which then has no rules', () => {
    const catalog = parseStrategyCatalog(legacyStrategies)
    expect(catalog.ok).toBe(true)
    if (!catalog.ok) return
    const [sample] = catalog.value
    expect(sample).toMatchObject({ name: 'sample', title: 'Sample bands', defaultMarket: { symbol: 'XAUUSD', interval: '1h' } })
    expect(sample?.description).toMatch(/^A made-up strategy/)
    expect(sample?.parameters).toEqual([
      { name: 'length', default: 23, min: 1, max: 500, meaning: 'Candles the EMA averages', whole: true },
      { name: 'spread', default: 1, min: 1, max: 20, meaning: 'Tenths of a percent between neighbouring bands', whole: true },
      { name: 'lines', default: 2, min: 1, max: 10, meaning: 'Bands on each side of the EMA', whole: true },
      { name: 'trigger', default: 1, min: 1, max: 10, meaning: 'Which band below the EMA (1 = nearest it) triggers signals', whole: true },
    ])
    expect(sample?.rules).toBeNull()
  })

  it('reads the market table, with "none" and "–" cells', () => {
    const markets = parseMarketList(realMarketList)
    expect(markets.ok && markets.value).toEqual([
      { symbol: 'BTCUSDT', interval: '1h', candles: 5, first: Date.UTC(2025, 0, 6), newest: Date.UTC(2025, 0, 6, 4), age: 3 * 86400 + 4 * 3600, trading: false },
      { symbol: 'XAUUSD', interval: '1h', candles: 45123, first: Date.UTC(2019, 0, 2), newest: Date.UTC(2026, 10, 4, 8), age: 3900, trading: true },
      { symbol: 'EURPLN', interval: null, candles: 0, first: null, newest: null, age: null, trading: false },
    ])
  })

  it('reads a signal in either culture, long or short', () => {
    expect(readSignal('open long (50 % of balance)')).toEqual({ action: 'open', side: 'buy', share: 50 })
    expect(readSignal('open short (50% of balance)')).toEqual({ action: 'open', side: 'sell', share: 50 })
    expect(readSignal('close long')).toEqual({ action: 'close', side: 'buy', share: null })
    expect(readSignal('close short')).toEqual({ action: 'close', side: 'sell', share: null })
    expect(readSignal('none').action).toBe('none')
  })

  it('still reads the signals of a bot from before rules', () => {
    expect(readSignal('open buy (50 % of balance)')).toEqual({ action: 'open', side: 'buy', share: 50 })
    expect(readSignal('close newest position')).toEqual({ action: 'close', side: null, share: null })
    // Since position sizing the session sizes the open, so the signal names no share.
    expect(readSignal('open long')).toEqual({ action: 'open', side: 'buy', share: null })
    expect(readSignal('open short')).toEqual({ action: 'open', side: 'sell', share: null })
  })
})

describe('answers from the mock bot', () => {
  it('session --json passes the snapshot check', async () => {
    const snapshot = parseSession(await run('session', '--json'))
    expect(snapshot.ok).toBe(true)
    if (snapshot.ok) {
      expect(snapshot.value.account.currency).toBe('EUR')
      expect(snapshot.value.strategies[0]?.market).toEqual({ symbol: 'XAUUSD', interval: 'OneHour' })
    }
  })

  it('status, market list and sync', async () => {
    const status = parseStatus(await run('status'))
    expect(status.ok && status.value).toMatchObject({ version: '2.2.0', user: 'demo', database: { connected: true, schema: 2 }, broker: { state: 'connected', mode: 'DEMO' }, trading: 1 })
    const markets = parseMarketList(await run('market', 'list'))
    expect(markets.ok && markets.value.map((m) => `${m.symbol} ${m.interval}`)).toEqual(['EURUSD 4h', 'XAUUSD 1h'])
    const sync = parseMarketSync(await run('market', 'sync'))
    expect(sync.ok && sync.value.length).toBe(2)
  })

  it('candles and the oldest candle', async () => {
    const candles = parseCandles(await run('candles', 'show', 'XAUUSD', '1h', '--last', '30'))
    expect(candles.ok && candles.value.length).toBe(30)
    if (candles.ok) expect(candles.value[0]!.time).toBeLessThan(candles.value[29]!.time)
    const empty = parseCandles(await run('candles', 'show', 'NOPE', '1h'))
    expect(empty.ok && empty.value).toEqual([])
    const oldest = parseOldestCandle(await run('candles', 'oldest', 'XAUUSD', '1h'))
    expect(oldest.ok && oldest.value.broker).toBe('cTrader')
  })

  it('strategies --json, signal and backtest, with the default rules and with others', async () => {
    const catalog = parseStrategyCatalog(await run('strategies', '--json'))
    expect(catalog.ok && catalog.value[0]?.rules?.syntax).toBe('open|close long|short on cross up|down below|above N')
    const signal = parseSignal(await run('signal', 'sample', '--symbol', 'XAUUSD', '--interval', '1h', '-d'))
    expect(signal.ok && signal.value).toMatchObject({ strategy: 'sample', market: 'XAUUSD 1h', parameters: 'length=20 spread=3 lines=2', rules: ['open long on cross up below 1', 'close long on cross down below 1'] })
    expect(signal.ok && signal.value.values.map((v) => v.name)).toEqual(['open', 'close', 'EMA(20)', 'below 1'])
    const report = parseBacktest(await run('backtest', 'sample', '--symbol', 'XAUUSD', '--interval', '1h', '--set', 'length=30', '--rule', 'open short on cross down above 2', '--rule', 'close short on cross up above 2', '-d', '--balance', '5000'))
    expect(report.ok && report.value.initialBalance).toBe(5000)
    expect(report.ok && report.value).toMatchObject({ parameters: 'length=30 spread=3 lines=2', rules: ['open short on cross down above 2', 'close short on cross up above 2'] })
  })

  it('sizes backtests and sessions as --sizing says, Kelly from a stored full-history backtest', async () => {
    const catalog = parseStrategyCatalog(await run('strategies', '--json'))
    expect(catalog.ok && catalog.value[0]?.sizing?.methods.map((m) => m.name)).toEqual(['percent', 'fixed', 'kelly'])
    const fixed = parseBacktest(await run('backtest', 'sample', '-d', '--sizing', 'fixed:500'))
    expect(fixed.ok && fixed.value.sizing).toBe('500.00 per position')
    const id = fixed.ok ? fixed.value.storedAs! : NaN
    const edge = ['--rule', 'open long on cross up below 2', '--rule', 'close long on cross down below 1']
    const started = await run('trading', 'start', 'sample', '-d', ...edge, '--sizing', 'kelly:50', '--name', 'kelly')
    expect(started.exitCode, started.error?.message).toBe(0)
    expect(notices(started).other.join(' ')).toMatch(new RegExp(`Position sizing: Kelly, 50% of [\\d.]+% = [\\d.]+% of the balance per position, from backtest #${id + 1} `))
    const snapshot = parseSession(await run('session', '--json'))
    const kelly = snapshot.ok ? snapshot.value.strategies.find((x) => x.name === 'kelly')?.sizing : null
    expect(kelly).toMatchObject({ method: 'Kelly', kelly: { shareOfKelly: 50, backtestId: id + 1 } })
    const refused = await run('trading', 'start', 'sample', '-d', '--sizing', 'kelly')
    expect(refused.exitCode).toBe(1)
    // The default rules' full-history backtest is the fixed-amount one run above: it is read, not run again.
    expect(refused.error?.message).toMatch(new RegExp(`^Kelly sizing cannot use backtest #${id}: .*\\. Choose --sizing percent:N or fixed:AMOUNT, or change the rules\\.$`))
    const listed = await run('backtests', '--json')
    expect((listed.json as { id: number }[]).slice(0, 2).map((b) => b.id)).toEqual([id + 1, id])
  })

  it('a rule the strategy cannot have fails with the bot’s message', async () => {
    const failed = await run('backtest', 'sample', '-d', '--rule', 'open long on cross up below 3')
    expect(failed.exitCode).toBe(1)
    expect(failed.error?.message).toBe("Rule 'open long on cross up below 3': below 3 is not a band: there are bands 1 to 2 on each side.")
  })

  it('orders and actions', async () => {
    const broker = parseOrders(await run('orders', 'list', '--broker'))
    expect(broker.ok && broker.value[0]).toMatchObject({ symbol: 'XAUUSD', side: 'Buy', status: 'open' })
    const placed = await run('orders', 'place', 'EURUSD', 'sell', '1000', '--yes')
    const fill = readFill(notices(placed).done[0] ?? '')
    expect(fill).toMatchObject({ side: 'Sell', quantity: 1000, symbol: 'EURUSD' })
    const unconfirmed = await run('orders', 'place', 'EURUSD', 'buy', '1')
    expect(unconfirmed.exitCode).toBe(1)
    expect(unconfirmed.error?.message).toContain('--yes')
  })

  it('a missing market fails with the bot’s hint', async () => {
    const failed = await run('backtest', 'sample', '-d', '--symbol', 'NOPE')
    expect(failed.exitCode).toBe(1)
    expect(failed.error?.hint).toBe('Add it with: market add NOPE 1h')
  })
})

// Answers recorded from a real bot with `npm run record-fixtures` (none are committed until one is recorded).
type Recorded = { args: string[]; botVersion: string; answer: CommandResult }
const recorded = Object.entries(import.meta.glob<Recorded>('../fixtures/recorded/*.json', { eager: true, import: 'default' }))
const PARSERS: [RegExp, (result: CommandResult) => { ok: boolean }][] = [
  [/^status$/, parseStatus],
  [/^market list$/, parseMarketList],
  [/^strategies( --json)?$/, parseStrategyCatalog],
  [/^session --json$/, parseSession],
  [/^orders list/, parseOrders],
  [/^candles show /, parseCandles],
  [/^candles oldest /, parseOldestCandle],
  [/^signal /, parseSignal],
  [/^backtest /, parseBacktest],
]

describe.skipIf(!recorded.length)('answers recorded from a real bot', () => {
  it.each(recorded)('%s is read by its parser', (_, { args, answer }) => {
    const line = args.join(' ')
    const parser = PARSERS.find(([pattern]) => pattern.test(line))?.[1]
    expect(parser, `no parser for ${line}`).toBeDefined()
    expect(answer.ok, `${line} failed: ${answer.error?.message}`).toBe(true)
    expect(parser!(answer)).toMatchObject({ ok: true })
  })
})
