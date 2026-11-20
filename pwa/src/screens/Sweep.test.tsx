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
import { deviceAnswer, SWEEP_AXES, sweepSummary, sweepTrials } from '../backtest/fixtures.ts'
import { readTrialLog } from '../backtest/sweep.ts'
import { EngineContext } from '../engine/context.ts'
import type { Engine } from '../engine/engine.ts'
import type { SweepRequest, SweepSummaryRequest } from '../engine/types.ts'
import { useConnections } from '../state/connections.ts'
import Sweep from './Sweep.tsx'

vi.mock('../components/Chart.tsx', () => ({ Chart: ({ label }: { label: string }) => <div role="img" aria-label={label} /> }))

/** The Parameter sweep screen against the mock bot and a fake engine that records what it was asked. */
const BOT_URL = 'https://bot.test:8443'

let bot: MockBot
let swept: { request: SweepRequest; trials: number }[] = []
let summed: SweepSummaryRequest[] = []
let planProblem: string | null = null

const server = setupServer(
  http.get('*/engine/version.json', () => HttpResponse.json({ version: '2.10.0', commit: 'test' })),
  http.post(`${BOT_URL}/`, async ({ request }) => {
    const { args } = (await request.json()) as { args: string[] }
    const result = await bot.run(args)
    return HttpResponse.json({ command: args.join(' '), elapsedMs: 7, ...result, json: result.json ?? null, ok: result.exitCode === 0 } satisfies CommandResult)
  }),
)

const engine: Engine = {
  setStrategies() {},
  levels: () => Promise.reject(new Error('not on this screen')),
  simulate: () => Promise.reject(new Error('not on this screen')),
  summarize: () => Promise.reject(new Error('not on this screen')),
  backtestAll: () => Promise.reject(new Error('not on this screen')),
  combine: () => Promise.reject(new Error('not on this screen')),
  async backtest() {
    return deviceAnswer()
  },
  async planConversion() {
    return { ok: true, engine: '2.10.0', from: 'USD', to: 'USD', steps: [] }
  },
  async planSweep(request) {
    if (planProblem) return { ok: false, engine: '2.10.0', error: { message: planProblem } }
    return { ok: true, engine: '2.10.0', trials: request.vary.reduce((n, axis) => n * axis.values.length, 1), ruleSets: 1, axes: request.vary, problems: [] }
  },
  async sweep(request, _candles, trials, { onProgress } = {}) {
    swept.push({ request, trials })
    onProgress?.(trials, trials)
    return { ok: true, engine: '2.10.0', days: ['2025-01-06', '2025-01-07'], daysPerYear: 261, holdOutStart: 1, trials: sweepTrials().slice(0, trials), problems: [], computedMs: 30 }
  },
  async summarizeSweep(request) {
    summed.push(request)
    return { ok: true, engine: '2.10.0', summary: sweepSummary(), computedMs: 4 }
  },
}

let n = 0
function show() {
  const id = `sweep-${++n}`
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Test bot', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0 }], activeId: id, keys: { [id]: 'k'.repeat(40) } })
  render(
    <QueryClientProvider client={queryClient}>
      <EngineContext.Provider value={() => engine}>
        <MemoryRouter initialEntries={['/backtest/sweep']}>
          <Sweep />
        </MemoryRouter>
      </EngineContext.Provider>
    </QueryClientProvider>,
  )
  return id
}

/** Varies length over 10, 20, 30, spread over 2 and 3, and lines over 1 and 2: the 12 trials of the fixtures. */
async function varyTwelve(user: ReturnType<typeof userEvent.setup>) {
  for (const [name, values] of [['length', '10, 20, 30'], ['spread', '2, 3'], ['lines', '1, 2']] as const) {
    await user.click(await screen.findByRole('checkbox', { name: new RegExp(`^Vary ${name}`) }))
    await user.click(screen.getByRole('radio', { name: 'A list', checked: false }))
    await user.type(screen.getByLabelText(`${name}: values`), values)
  }
}

beforeAll(() => server.listen())
beforeEach(() => {
  bot = createBot({ ticking: false, seed: 3 })
  swept = []
  summed = []
  planProblem = null
})
afterEach(() => {
  cleanup()
  bot.stop()
  queryClient.clear()
})
afterAll(() => server.close())

describe('Parameter sweep', () => {
  it('counts the trials as they are set up, and says about how long they take', async () => {
    show()
    const user = userEvent.setup()
    await varyTwelve(user)

    expect(screen.getByText(/^12 trials · about \d+ s$/)).toBeInTheDocument()
  })

  it('sweeps the setup on this device, then sums every trial up', async () => {
    show()
    const user = userEvent.setup()
    await varyTwelve(user)
    await user.click(screen.getByRole('button', { name: 'Run the sweep' }))

    expect(await screen.findByRole('heading', { name: 'sample on XAUUSD 1h: 12 trials' })).toBeInTheDocument()
    expect(swept[0]).toMatchObject({ trials: 12, request: { base: { strategy: 'sample', symbol: 'XAUUSD', interval: '1h' }, vary: SWEEP_AXES, holdOut: { sharePercent: 30 }, objective: 'Sharpe', earlierTrials: 0 } })
    expect(summed[0]).toMatchObject({ axes: SWEEP_AXES, markets: [{ label: 'XAUUSD 1h', days: ['2025-01-06', '2025-01-07'], daysPerYear: 261 }] })
    expect(summed[0]!.markets[0]!.trials).toHaveLength(12)
  })

  it('reports the verdict, the heat map, every trial, the overfitting checks and the chosen trial in full', async () => {
    show()
    const user = userEvent.setup()
    await varyTwelve(user)
    await user.click(screen.getByRole('button', { name: 'Run the sweep' }))

    await screen.findByRole('heading', { name: 'sample on XAUUSD 1h: 12 trials' })
    expect(screen.getByText('Promising, not proven', { selector: '.figure .value' })).toBeInTheDocument()
    expect(screen.getByText(/^Promising, not proven: deflated Sharpe 0\.86 over 12 trials; probability of overfitting 0\.18/)).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Trials on XAUUSD 1h' })).getAllByRole('row')).toHaveLength(13)
    await user.click(screen.getByRole('button', { name: 'length 20, spread 3: 1.40, the chosen trial' }))
    expect(screen.getByRole('button', { name: 'length 20, spread 3: 1.40, the chosen trial' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('table', { name: 'Trials on XAUUSD 1h' })).getAllByRole('row')[1]).toHaveTextContent('#7 · chosen, picked')
    expect(screen.getByRole('img', { name: /^Logits of the winners’ ranks out of sample: 18% below 0/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^The 5 paths’ Sharpe ratios out of sample: 0\.80, 0\.60/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Export the trials (CSV)' })).toHaveAttribute('download', expect.stringMatching(/\.csv$/))
    expect(screen.getByRole('link', { name: 'Open as backtest' })).toHaveAttribute('href', expect.stringMatching(/^\/backtest\?strategy=sample&market=XAUUSD\+1h&set=length%3D20&set=spread%3D3&set=lines%3D2/))
    expect(await screen.findByText('Sharpe a year', { selector: '.figure > .label' })).toBeInTheDocument()
  })

  it('counts this sweep’s trials for the next one, which can count them in the deflated Sharpe ratio', async () => {
    const id = show()
    const user = userEvent.setup()
    await varyTwelve(user)
    await user.click(screen.getByRole('button', { name: 'Run the sweep' }))
    await screen.findByRole('heading', { name: 'sample on XAUUSD 1h: 12 trials' })

    expect(await readTrialLog(id, 'sample', 'XAUUSD 1h')).toBe(12)
    expect(await screen.findByRole('checkbox', { name: /^Count the 12 trials swept before/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Run the sweep' }))
    await screen.findByText(/^Promising, not proven: deflated/)
    expect(swept.at(-1)!.request.earlierTrials).toBe(12)
  })

  it('asks for something to vary, and refuses values the parameter does not take', async () => {
    show()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Run the sweep' }))
    expect(await screen.findByText('Vary a parameter, or try another rule set.')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /^Vary length/ }))
    await user.click(screen.getByRole('radio', { name: 'A list', checked: false }))
    await user.type(screen.getByLabelText('length: values'), '1, 10')
    expect(await screen.findByText('length takes 2 to 500; 1 is outside.')).toBeInTheDocument()
    expect(swept).toEqual([])
  })

  it('shows the engine’s message when it refuses the sweep', async () => {
    planProblem = 'A sweep sizes by a percent or a fixed amount: each trial is another setup, and Kelly is worked out per setup.'
    show()
    const user = userEvent.setup()
    await varyTwelve(user)
    await user.click(screen.getByRole('button', { name: 'Run the sweep' }))

    expect(await screen.findByText(planProblem)).toBeInTheDocument()
  })
})
