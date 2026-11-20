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
import { analysis, combinedResult, deviceAnswer } from '../backtest/fixtures.ts'
import { EngineContext } from '../engine/context.ts'
import type { BacktestJob, Engine } from '../engine/engine.ts'
import type { CombineRequest } from '../engine/types.ts'
import { useConnections } from '../state/connections.ts'
import CombinedBacktest from './CombinedBacktest.tsx'

vi.mock('../components/Chart.tsx', () => ({ Chart: ({ label }: { label: string }) => <div role="img" aria-label={label} /> }))

/** The Several strategies screen against the mock bot (XAUUSD 1h and EURUSD 4h) and a fake engine that records what it was asked. */
const BOT_URL = 'https://bot.test:8443'

let bot: MockBot
let jobs: BacktestJob[] = []
let combined: CombineRequest[] = []

const server = setupServer(
  http.get('*/engine/version.json', () => HttpResponse.json({ version: '2.9.0', commit: 'test' })),
  http.post(`${BOT_URL}/`, async ({ request }) => {
    const { args } = (await request.json()) as { args: string[] }
    const result = await bot.run(args)
    return HttpResponse.json({ command: args.join(' '), elapsedMs: 7, ...result, json: result.json ?? null, ok: result.exitCode === 0 } satisfies CommandResult)
  }),
)

const engine: Engine = {
  setStrategies() {},
  levels: () => Promise.reject(new Error('not on this screen')),
  backtest: () => Promise.reject(new Error('not on this screen')),
  simulate: () => Promise.reject(new Error('not on this screen')),
  summarize: () => Promise.reject(new Error('not on this screen')),
  planSweep: () => Promise.reject(new Error('not on this screen')),
  sweep: () => Promise.reject(new Error('not on this screen')),
  summarizeSweep: () => Promise.reject(new Error('not on this screen')),
  async backtestAll(asked, { onProgress } = {}) {
    jobs.push(...asked)
    onProgress?.(asked.length, asked.length)
    return asked.map((job) => deviceAnswer({ market: { symbol: job.request.symbol, interval: job.request.interval }, initialBalance: job.request.balance ?? 1000, analysis: analysis({ currency: 'EUR' }) }))
  },
  async combine(request) {
    combined.push(request)
    return { ok: true, engine: '2.9.0', combined: combinedResult() }
  },
  async planConversion({ symbol, currency }) {
    if (currency !== 'EUR') return { ok: false, engine: '2.9.0', error: { message: `No market on this device turns USD into ${currency}.` } }
    return { ok: true, engine: '2.9.0', from: 'USD', to: 'EUR', steps: [{ symbol: 'EURUSD', divide: true, ownMarket: symbol === 'EURUSD' }] }
  },
}

let n = 0
function show() {
  const id = `combined-${++n}`
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Test bot', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0 }], activeId: id, keys: { [id]: 'k'.repeat(40) } })
  return render(
    <QueryClientProvider client={queryClient}>
      <EngineContext.Provider value={() => engine}>
        <MemoryRouter initialEntries={['/backtest/combined']}>
          <CombinedBacktest />
        </MemoryRouter>
      </EngineContext.Provider>
    </QueryClientProvider>,
  )
}

/** Adds a leg through its sheet: the market, and a budget when given. */
async function addLeg(user: ReturnType<typeof userEvent.setup>, market: string, budget?: string) {
  await user.click(await screen.findByRole('button', { name: 'Add a leg' }))
  const sheet = await screen.findByRole('dialog', { name: 'Add a leg' })
  await user.selectOptions(within(sheet).getByLabelText('Market'), market)
  if (budget) {
    await user.clear(within(sheet).getByLabelText('Budget'))
    await user.type(within(sheet).getByLabelText('Budget'), budget)
  }
  await user.click(within(sheet).getByRole('button', { name: 'Add the leg' }))
}

beforeAll(() => server.listen())
beforeEach(() => {
  bot = createBot({ ticking: false, seed: 3 })
  jobs = []
  combined = []
})
afterEach(() => {
  cleanup()
  bot.stop()
  queryClient.clear()
})
afterAll(() => server.close())

describe('Several strategies', () => {
  it('asks for two legs before it combines', async () => {
    show()
    const user = userEvent.setup()
    await addLeg(user, 'XAUUSD 1h')
    await user.click(screen.getByRole('button', { name: 'Run the combined backtest' }))

    expect(await screen.findByText('Add at least 2 legs to combine.')).toBeInTheDocument()
    expect(jobs).toEqual([])
  })

  it('backtests every leg on this device in EUR with its own budget, then adds them up', async () => {
    show()
    const user = userEvent.setup()
    await addLeg(user, 'XAUUSD 1h', '1500')
    await addLeg(user, 'EURUSD 4h')
    await user.click(screen.getByRole('button', { name: 'Run the combined backtest' }))

    expect(await screen.findByRole('heading', { name: 'Gold + Zloty' })).toBeInTheDocument()
    expect(jobs.map((job) => [job.request.symbol, job.request.balance])).toEqual([['XAUUSD', 1500], ['EURUSD', 1000]])
    // Gold in EUR reads EURUSD's candles; EURUSD in EUR divides by its own close.
    expect(jobs[0]!.request.conversion).toEqual({ currency: 'EUR', hops: [{ symbol: 'EURUSD', interval: '4h', count: jobs[0]!.conversion!.time.length }] })
    expect(jobs[0]!.conversion!.time.length).toBeGreaterThan(100)
    expect(jobs[1]!.request.conversion).toEqual({ currency: 'EUR', hops: [{ symbol: 'EURUSD' }] })
    expect(combined[0]).toMatchObject({ currency: 'EUR', legs: [{ label: 'sample on XAUUSD 1h', budget: 1500, currency: 'EUR' }, { label: 'sample on EURUSD 4h', budget: 1000 }] })
  })

  it('reports the five figures, the verdict, the legs, one beta per market, the correlations and the budget splits', async () => {
    show()
    const user = userEvent.setup()
    await addLeg(user, 'XAUUSD 1h')
    await addLeg(user, 'EURUSD 4h')
    await user.click(screen.getByRole('button', { name: 'Run the combined backtest' }))

    const tiles = (await screen.findByText('Diversification', { selector: '.figure > .label' })).closest('.figures')!
    expect([...tiles.querySelectorAll('.figure > .label')].map((label) => label.textContent)).toEqual(['Return', 'Sharpe a year', 'Diversification', 'Alpha a year', 'Drawdown'])
    expect(screen.getByText(/Gold carries 78% of the risk with 50% of the money\.$/)).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'The legs' })).getByText('0.05 to USD in EUR')).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Beta to each market' })).getByText('XAUUSD')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Correlations of the legs’ daily returns, on every day: Gold and Zloty: 0\.10\.$/ })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'The 5 worst days' }))
    expect(screen.getByRole('img', { name: /on the worst days: Gold and Zloty: 0\.62\.$/ })).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Budget splits' })).getByText('Equal risk (inverse volatility)')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Gold 50% of the money, 78% of the risk/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Combined equity at each day’s end, from 2,000\.00 EUR to 2,060\.00 EUR$/ })).toBeInTheDocument()
  })

  it('keeps the run on this device, and “Use” brings its legs back', async () => {
    show()
    const user = userEvent.setup()
    await addLeg(user, 'XAUUSD 1h')
    await addLeg(user, 'EURUSD 4h')
    await user.click(screen.getByRole('button', { name: 'Run the combined backtest' }))

    const saved = (await screen.findByRole('table', { name: 'Saved combined backtests' })) as HTMLElement
    expect(within(saved).getByText('Gold + Zloty')).toBeInTheDocument()
    for (const button of within(screen.getByRole('table', { name: 'Legs' })).getAllByRole('button', { name: 'Remove' })) await user.click(button)
    expect(screen.getByText('No legs yet.')).toBeInTheDocument()
    await user.click(within(saved).getByRole('button', { name: 'Use' }))
    expect(within(screen.getByRole('table', { name: 'Legs' })).getByText('sample on EURUSD 4h')).toBeInTheDocument()
  })

  it('names the leg whose conversion cannot be planned', async () => {
    show()
    const user = userEvent.setup()
    await addLeg(user, 'XAUUSD 1h')
    await addLeg(user, 'EURUSD 4h')
    await user.selectOptions(screen.getByLabelText('Currency'), 'PLN')
    await user.click(screen.getByRole('button', { name: 'Run the combined backtest' }))

    expect(await screen.findByText('sample on XAUUSD 1h: No market on this device turns USD into PLN.')).toBeInTheDocument()
    expect(jobs).toEqual([])
  })

  it('refuses two legs of the same name', async () => {
    show()
    const user = userEvent.setup()
    await addLeg(user, 'XAUUSD 1h')
    await user.click(screen.getByRole('button', { name: 'Add a leg' }))
    const sheet = await screen.findByRole('dialog', { name: 'Add a leg' })
    await user.selectOptions(within(sheet).getByLabelText('Market'), 'XAUUSD 1h')
    await user.click(within(sheet).getByRole('button', { name: 'Add the leg' }))

    expect(within(sheet).getByText('Another leg has this name; give this one its own.')).toBeInTheDocument()
  })
})
