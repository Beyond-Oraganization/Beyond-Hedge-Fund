import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBot, type MockBot } from '../../mock-bot/bot.mjs'
import { queryClient } from '../api/bot.ts'
import type { CommandResult } from '../api/types.ts'
import { deviceAnswer, scenariosAnswer, summaryAnswer } from '../backtest/fixtures.ts'
import { EngineContext } from '../engine/context.ts'
import type { Engine } from '../engine/engine.ts'
import { analysis } from '../backtest/fixtures.ts'
import { costsKey } from '../backtest/conditions.ts'
import type { CandleColumns, ConversionColumns, EngineAnswer, EngineRequest, SummaryRequest } from '../engine/types.ts'
import { db } from '../state/db.ts'
import { useConnections } from '../state/connections.ts'
import { useSettings } from '../state/settings.ts'
import Backtest from './Backtest.tsx'

// TradingView's chart draws on a canvas, which jsdom lacks; the balance chart is the library's, tested by its users.
vi.mock('../components/Chart.tsx', () => ({ Chart: ({ label }: { label: string }) => <div role="img" aria-label={label} /> }))

/**
 * The Backtest screen against the mock bot (which answers `candles export` and `kelly` as the bot does) and a fake
 * engine that records what it was asked: the real engine is the bot's own code, tested there, and end to end.
 */
const BOT_URL = 'https://bot.test:8443'
const KEY = 'k'.repeat(40)

let bot: MockBot
let overrides: [prefix: string, respond: () => Response][] = []
let asked: { request: EngineRequest; candles: CandleColumns; conversion?: ConversionColumns }[] = []
let simulated: { request: EngineRequest; count: number; conversion?: ConversionColumns }[] = []
let summed: SummaryRequest[] = []
let engineAnswer: EngineAnswer = deviceAnswer()

const server = setupServer(
  http.get('*/engine/version.json', () => HttpResponse.json({ version: '2.2.0', commit: 'test' })),
  http.post(`${BOT_URL}/`, async ({ request }) => {
    const { args } = (await request.json()) as { args: string[] }
    const line = args.join(' ')
    const override = overrides.find(([prefix]) => line.startsWith(prefix))
    if (override) return override[1]()
    const result = await bot.run(args)
    return HttpResponse.json({ command: line, elapsedMs: 7, ...result, json: result.json ?? null, ok: result.exitCode === 0 } satisfies CommandResult)
  }),
)

const answer = (partial: Partial<CommandResult>) =>
  HttpResponse.json({ command: 'x', exitCode: 0, ok: true, elapsedMs: 5, output: '', blocks: [], error: null, json: null, ...partial } satisfies CommandResult)

const engine: Engine = {
  setStrategies() {},
  async levels() {
    return { ok: true, engine: '2.5.0', strategy: 'sample', lines: [] }
  },
  async backtest(request, candles, _signal, conversion) {
    asked.push({ request, candles, conversion })
    return engineAnswer
  },
  async simulate(request, _candles, count, { onProgress, conversion } = {}) {
    simulated.push({ request, count, conversion })
    onProgress?.(count, count)
    return scenariosAnswer({ method: request.scenarios!.method, seed: request.scenarios!.seed })
  },
  async summarize(request) {
    summed.push(request)
    return summaryAnswer()
  },
  // One strategy at a time on this screen.
  backtestAll: () => Promise.reject(new Error('not on this screen')),
  combine: () => Promise.reject(new Error('not on this screen')),
  planSweep: () => Promise.reject(new Error('not on this screen')),
  sweep: () => Promise.reject(new Error('not on this screen')),
  summarizeSweep: () => Promise.reject(new Error('not on this screen')),
  // As the engine plans it: gold's USD into EUR through EURUSD, when this device has it.
  async planConversion({ symbol, currency, markets }) {
    if (symbol === 'XAUUSD' && currency === 'EUR' && markets.includes('EURUSD'))
      return { ok: true, engine: '2.8.0', from: 'USD', to: 'EUR', steps: [{ symbol: 'EURUSD', divide: true, ownMarket: false }] }
    return { ok: false, engine: '2.8.0', error: { message: `No market on this device turns USD into ${currency}: copy ${currency}USD or USD${currency} candles.` } }
  },
}

let n = 0
function show(id = `backtest-${++n}`) {
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Test bot', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0 }], activeId: id, keys: { [id]: KEY } })
  return render(
    <QueryClientProvider client={queryClient}>
      <EngineContext.Provider value={() => engine}>
        <MemoryRouter>
          <Backtest />
        </MemoryRouter>
      </EngineContext.Provider>
    </QueryClientProvider>,
  )
}

const run = async () => {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Run the backtest' }))
  return user
}

beforeAll(() => server.listen())
beforeEach(() => {
  bot = createBot({ ticking: false, seed: 3 })
  asked = []
  simulated = []
  summed = []
  engineAnswer = deviceAnswer()
  useSettings.setState({ openPanels: {} })
})
afterEach(() => {
  cleanup()
  bot.stop()
  overrides = []
  queryClient.clear()
})
afterAll(() => server.close())

describe('Backtest', () => {
  it('copies the bot’s candles to this device and backtests them here, then on 200 alternative price histories by bootstrap', async () => {
    show()
    await run()

    expect(await screen.findByRole('heading', { name: 'Monte Carlo' })).toBeInTheDocument()
    const { request, candles } = asked[0]!
    expect(request).toMatchObject({ strategy: 'sample', symbol: 'XAUUSD', interval: '1h', kelly: null })
    expect(candles.time.length).toBeGreaterThan(1000)
    expect(candles.close.length).toBe(candles.time.length)
    expect(simulated[0]).toMatchObject({ count: 200, request: { ...request, scenarios: { method: 'Bootstrap', seed: expect.any(Number) } } })
    expect(summed[0]).toMatchObject({ initialBalance: 1000, real: deviceAnswer().realScenario, results: scenariosAnswer().results })
  })

  it('asks for no costs, fill, budget or currency when none is set, as before engine 2.8.0', async () => {
    show()
    await run()

    await screen.findByRole('heading', { name: 'Monte Carlo' })
    expect(Object.keys(asked[0]!.request)).not.toEqual(expect.arrayContaining(['costs']))
    expect(asked[0]!.request).not.toHaveProperty('fill')
    expect(asked[0]!.request).not.toHaveProperty('budget')
    expect(asked[0]!.request).not.toHaveProperty('conversion')
    expect(asked[0]!.conversion).toBeUndefined()
  })

  it('sends the costs typed, the next-open fill and the balance as a budget', async () => {
    show()
    const user = userEvent.setup()
    await user.click(await screen.findByText('Costs and conditions'))
    await user.type(screen.getByLabelText('Bid–ask spread'), '0,3')
    await user.type(screen.getByLabelText('Swap long, % a year'), '−4')
    await user.click(screen.getByRole('radio', { name: 'The next candle’s open' }))
    await user.click(screen.getByRole('checkbox', { name: 'Trade like a live budget of the starting balance' }))
    expect(screen.getByLabelText('Budget')).toHaveValue(1000)
    await user.click(screen.getByRole('button', { name: 'Run the backtest' }))

    await screen.findByRole('heading', { name: 'Monte Carlo' })
    expect(asked[0]!.request).toMatchObject({ costs: { spread: 0.3, slippage: 0, commission: 0, swapLong: -4, swapShort: 0 }, fill: 'NextOpen', budget: 1000 })
    expect(simulated[0]!.request).toMatchObject({ costs: { spread: 0.3 }, fill: 'NextOpen', budget: 1000 })
  })

  it('refuses a cost no market charges, before running', async () => {
    show()
    const user = userEvent.setup()
    await user.click(await screen.findByText('Costs and conditions'))
    await user.type(screen.getByLabelText('Commission, % a side'), '12')
    await user.click(screen.getByRole('button', { name: 'Run the backtest' }))

    expect(await screen.findByText('The commission is a percent of the notional on each side, from 0 to 10.')).toBeInTheDocument()
    expect(asked).toEqual([])
  })

  it('remembers a market’s costs on this device, and brings them back for that market', async () => {
    const id = `backtest-${++n}`
    await db.set(costsKey(id, 'XAUUSD'), { spread: '0.3', slippage: '', commission: '0.0035', swapLong: '', swapShort: '' })
    show(id)

    expect(await screen.findByLabelText('Bid–ask spread')).toHaveValue('0.3')
    const user = userEvent.setup()
    await user.clear(screen.getByLabelText('Bid–ask spread'))
    await user.type(screen.getByLabelText('Bid–ask spread'), '0.5')
    await user.click(screen.getByRole('button', { name: 'Run the backtest' }))

    await screen.findByRole('heading', { name: 'Monte Carlo' })
    expect(await db.get(costsKey(id, 'XAUUSD'))).toMatchObject({ spread: '0.5', commission: '0.0035' })
  })

  it('keeps a run’s conditions with it, and “Use” brings them back', async () => {
    show()
    const user = userEvent.setup()
    await user.click(await screen.findByText('Costs and conditions'))
    await user.type(screen.getByLabelText('Bid–ask spread'), '0.3')
    await user.click(screen.getByRole('radio', { name: 'The next candle’s open' }))
    await user.click(screen.getByRole('button', { name: 'Run the backtest' }))
    await screen.findByRole('heading', { name: 'Monte Carlo' })

    await user.clear(screen.getByLabelText('Bid–ask spread'))
    await user.click(screen.getByRole('radio', { name: 'The signal’s close' }))
    await user.click(within(screen.getByRole('table', { name: 'Saved backtests' }) as HTMLElement).getByRole('button', { name: 'Use' }))

    expect(await screen.findByDisplayValue('0.3')).toHaveAccessibleName('Bid–ask spread')
    expect(screen.getByRole('radio', { name: 'The next candle’s open' })).toBeChecked()
  })

  it('converts into EUR through EURUSD: says how, copies EURUSD to this device and sends its candles', async () => {
    show()
    const user = userEvent.setup()
    await user.click(await screen.findByText('Costs and conditions'))
    await user.selectOptions(screen.getByLabelText('Measured in'), 'EUR')

    expect(await screen.findByText('Converted at each moment: ÷ EURUSD 4h.')).toBeInTheDocument()
    expect(screen.getByText('Simulated; in EUR.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run the backtest' }))

    await screen.findByRole('heading', { name: 'Monte Carlo' })
    const { request, conversion } = asked[0]!
    const count = request.conversion?.hops[0]?.count ?? 0
    expect(request.conversion).toEqual({ currency: 'EUR', hops: [{ symbol: 'EURUSD', interval: '4h', count }] })
    expect(count).toBeGreaterThan(100)
    expect(conversion?.time).toHaveLength(count)
    expect(conversion?.close).toHaveLength(count)
    expect(simulated[0]!.conversion).toBe(conversion)
  })

  it('says which market to copy when no stored market leads to the currency, and does not run', async () => {
    show()
    const user = userEvent.setup()
    await user.click(await screen.findByText('Costs and conditions'))
    await user.selectOptions(screen.getByLabelText('Measured in'), 'PLN')

    expect(await screen.findByText('No market on this device turns USD into PLN: copy PLNUSD or USDPLN candles.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run the backtest' }))
    expect(asked).toEqual([])
  })

  it('shows what the costs took: gross next to net, the Sharpe ratio at none, these and twice the costs, and Kelly before them', async () => {
    const costs = { paid: 21.23, grossProfitLoss: 19.22, netProfitLoss: -2.01, sharpeWithout: 0.71, sharpe: -0.15, sharpeAtTwice: -0.97, breakEvenMultiple: 0.83, breakEvenMissing: null }
    const gross = { ...deviceAnswer().kelly, percent: 4.16, whyUnusable: null }
    engineAnswer = deviceAnswer({
      analysis: analysis({ costs, kelly: { gross, net: deviceAnswer().kelly, openTogether: 1, concurrencyAdjustedPercent: null }, skippedOpens: 3, currency: 'EUR', conditions: 'spread 0.5, budget 1,000, in EUR (÷ EURUSD)' }),
    })
    show()
    await run()

    expect(await screen.findByText('21.23 EUR by the closed trades')).toBeInTheDocument()
    expect(screen.getByText('+19.22 EUR before, -2.01 EUR after')).toBeInTheDocument()
    expect(screen.getByText('0.71 without costs, -0.15 with these, -0.97 with twice')).toBeInTheDocument()
    expect(screen.getByText(/stays above 0 up to about 0\.8× these costs/)).toBeInTheDocument()
    expect(screen.getByText(/^4\.16% of the balance/)).toBeInTheDocument()
    expect(screen.getByText('3 open signals found no room in the budget')).toBeInTheDocument()
    expect(screen.getByText('spread 0.5, budget 1,000, in EUR (÷ EURUSD)')).toBeInTheDocument()
    expect(screen.getByText(/after 21\.23 EUR of costs/)).toBeInTheDocument()
    expect(screen.getByText(/^The costs entered, and no margin or stop-outs\./)).toBeInTheDocument()
  })

  it('makes the alternative histories by Brownian motion when chosen', async () => {
    show()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Brownian motion (random walk)' }))
    await user.click(screen.getByRole('button', { name: 'Run the backtest' }))

    await screen.findByRole('heading', { name: 'Monte Carlo' })
    expect(simulated[0]?.request.scenarios?.method).toBe('BrownianMotion')
    expect(screen.getByText(/Brownian motion is calmer than any real market/)).toBeInTheDocument()
  })

  it('runs no Monte Carlo when it is off', async () => {
    show()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('radio', { name: 'Off' }))
    await user.click(screen.getByRole('button', { name: 'Run the backtest' }))

    expect(await screen.findByRole('table', { name: 'Saved backtests' })).toBeInTheDocument()
    expect(simulated).toEqual([])
    expect(screen.queryByRole('heading', { name: 'Monte Carlo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Alternative histories by' })).not.toBeInTheDocument()
  })

  it('heads the report with return, Sharpe, beta, alpha and the marked drawdown, and keeps the others in a table that starts closed', async () => {
    show()
    await run()

    const tiles = (await screen.findByText('Sharpe a year', { selector: '.figure > .label' })).closest('.figures')!
    expect([...tiles.querySelectorAll('.figure > .label')].map((label) => label.textContent)).toEqual(['Return', 'Sharpe a year', 'Beta to XAUUSD', 'Alpha a year', 'Drawdown, marked'])
    expect(screen.getByText('5.78', { selector: '.figure .value' })).toHaveClass('warn')
    expect(screen.getByText('All figures').closest('details')).not.toHaveAttribute('open')
  })

  it('reads beta, alpha and Sharpe together in a sentence under the figures', async () => {
    show()
    await run()

    expect(await screen.findByText(/^Moves 0\.65× with XAUUSD \(R² 0\.99\)\. Alpha \+73\.64% a year is strong \(t 5\.76\)/)).toBeInTheDocument()
  })

  it('draws the equity marked each day, how far under water it was, and beta and Sharpe over time', async () => {
    show()
    await run()

    expect(await screen.findByRole('img', { name: /^Equity marked at each day’s close from 1,000\.00 to 1,004\.95/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'The equity’s distance below its peak each day: -5.00% at the deepest.' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Beta to XAUUSD over the 90 days up to each point, from 0.60 to 0.70.' })).toBeInTheDocument()
  })

  it('shows a run saved before engine 2.7.0 with the four figures it had and no verdict', async () => {
    const { finalEquity: _equity, analysis: _analysis, dailyEquity: _days, ...older } = deviceAnswer()
    const before = { kind: 'device', id: 'old', at: 1, input: { strategy: 'sample', symbol: 'XAUUSD', interval: '1h', params: {} }, balance: 1000, from: null, to: null,
      result: { ...older, tradeReturns: [0.02], overlappingTrades: 0, curve: [] } }
    await db.set(`runs:backtest-${n + 1}:old`, before)
    show()
    const user = userEvent.setup()

    await user.click(within((await screen.findByRole('table', { name: 'Saved backtests' })) as HTMLElement).getByRole('button', { name: 'Show' }))

    const tiles = (await screen.findByText('Win rate', { selector: '.figure > .label' })).closest('.figures')!
    expect([...tiles.querySelectorAll('.figure > .label')].map((label) => label.textContent)).toEqual(['Profit / loss', 'Final balance', 'Win rate', 'Max drawdown'])
    expect(screen.queryByText(/likely above 0/)).not.toBeInTheDocument()
  })

  it('sets the run against its market: a dot a day, the fitted line, beta and alpha', async () => {
    show()
    await run()

    expect(await screen.findByRole('img', { name: '5 days. Beta 0.65: it moved with 65% of the market’s daily move. Alpha +73.64% a year (t 5.8).' })).toBeInTheDocument()
    expect(screen.getByText('A day (5)')).toBeInTheDocument()
  })

  it('says why a run has no beta or alpha', async () => {
    engineAnswer = deviceAnswer({ marketBeta: null, marketBetaMissing: 'only 2 days to compare, and it needs at least 3', dailyReturns: [] })
    show()
    await run()

    expect(await screen.findByText('No beta or alpha: only 2 days to compare, and it needs at least 3.')).toBeInTheDocument()
  })

  it('says how many alternative pasts ended above the starting balance, and where the real history ranks, under the chart', async () => {
    show()
    await run()

    const section = (await screen.findByRole('heading', { name: 'Monte Carlo' })).closest('section') as HTMLElement
    expect(within(section).getByText('66.7%')).toBeInTheDocument()
    expect(within(section).getByText(/of 3 alternative pasts ended above the starting balance/)).toBeInTheDocument()
    expect(within(section).getByText('The real history beat 67% of them.')).toBeInTheDocument()
    expect(within(section).getByText(/blocks of about 5 candles/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /The balance over time in 3 alternative price histories/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /The real price from 2,000.* and 3 alternative histories/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Returns of 2 trades: 1 lost, 1 won/ })).toBeInTheDocument()
  })

  it('keeps the run on this device, with where its scenarios ended and how they were made', async () => {
    show()
    await run()

    const saved = (await screen.findByRole('table', { name: 'Saved backtests' })) as HTMLElement
    expect(within(saved).getByText('66.7% · bootstrap')).toBeInTheDocument()
  })

  it('shows a run saved before 2.2.0 with what its Monte Carlo of trades found', async () => {
    const before = { kind: 'device', id: 'old', at: 1, input: { strategy: 'sample', symbol: 'XAUUSD', interval: '1h', params: {} }, balance: 1000, from: null, to: null, paths: 1000,
      result: { ...deviceAnswer(), tradeReturns: [0.02], overlappingTrades: 0, curve: [], monteCarlo: { paths: 1000, endedAboveStartPercent: 61.2 } } }
    await db.set(`backtests:backtest-${n + 1}`, [before])
    show()
    const user = userEvent.setup()

    const saved = (await screen.findByRole('table', { name: 'Saved backtests' })) as HTMLElement
    expect(within(saved).getByText('61.2% · trade resampling')).toBeInTheDocument()
    await user.click(within(saved).getByRole('button', { name: 'Show' }))
    expect(await screen.findByText(/resampled its trades: 61.2% of 1,000 paths ended above the start/)).toBeInTheDocument()
  })

  it('with Kelly sizing, sizes by the Kelly the bot would trade with', async () => {
    const kelly = { estimate: deviceAnswer().kelly, shareOfKelly: 100, backtestId: 7, backtestedAt: '2026-11-08T12:00:00Z', from: '2019-01-02T00:00:00Z', to: '2026-11-08T12:00:00Z' }
    overrides.push(['kelly ', () => answer({ json: { method: 'Kelly', value: 25, kelly } })])
    show()
    const user = userEvent.setup()
    await user.selectOptions(await screen.findByLabelText('Position sizing'), 'kelly')
    await user.click(screen.getByRole('button', { name: 'Run the backtest' }))

    await screen.findByRole('heading', { name: 'Monte Carlo' })
    expect(asked[0]?.request.kelly).toMatchObject({ backtestId: 7, shareOfKelly: 100 })
    expect(asked[0]?.request.sizing).toMatch(/^kelly/)
  })

  it('shows the engine’s message for a request it refuses', async () => {
    engineAnswer = { ok: false, engine: '2.2.0', error: { message: "sample has no parameter speed. Parameters: length, spread, lines." } }
    show()
    await run()

    expect(await screen.findByText(/sample has no parameter speed/)).toBeInTheDocument()
  })

  it('tells an older bot, which cannot hand out its candles, from a failure', async () => {
    overrides.push(['candles export', () => answer({ exitCode: 2, ok: false, error: { message: "Unknown command 'export'.", hint: 'Run the command with --help.' } })])
    show()
    await run()

    expect(await screen.findByText(/need bot 2\.1\.0 or later/)).toBeInTheDocument()
    expect(asked).toEqual([])
  })
})
