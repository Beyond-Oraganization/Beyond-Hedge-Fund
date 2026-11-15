import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createBot, type MockBot } from '../../../mock-bot/bot.mjs'
import { queryClient } from '../../api/bot.ts'
import { ACCOUNT_HEADER } from '../../api/client.ts'
import type { CommandResult } from '../../api/types.ts'
import Trading from '../../screens/Trading.tsx'
import { useConnections } from '../../state/connections.ts'
import { readBudget, readCheck } from './check.ts'

/**
 * Trading's step 13 (docs/fund-app-redesign-plan.md): a session's budget, checked with `trading check` before it starts,
 * and every session of every account in one table. Against the mock bot over MSW.
 */
const BOT_URL = 'https://fund.test:8443'
let bot: MockBot
let sent: string[][] = []
/** Answers by account for the two-account table (account header → strategies). */
let perAccount: Record<string, unknown[]> | null = null

const ok = (json: unknown, command = 'x') => HttpResponse.json({ command, exitCode: 0, ok: true, elapsedMs: 3, output: '', blocks: [], error: null, json } satisfies CommandResult)

const server = setupServer(
  http.post(`${BOT_URL}/`, async ({ request }) => {
    const { args } = (await request.json()) as { args: string[] }
    sent.push(args)
    if (perAccount && args[0] === 'accounts')
      return ok(Object.keys(perAccount).map((login, index) => ({ login, broker: 'CTrader', mode: 'Demo', current: index === 0, connected: true, accountId: '1', balance: 10000, currency: 'EUR', strategies: 1, signedInAt: '2026-11-15T08:00:00Z', error: null })))
    if (perAccount && args[0] === 'session' && args[1] === 'strategies') return ok(perAccount[request.headers.get(ACCOUNT_HEADER) ?? ''] ?? [])
    const result = await bot.run(args)
    return HttpResponse.json({ command: args.join(' '), elapsedMs: 5, ...result, json: result.json ?? null, ok: result.exitCode === 0 } satisfies CommandResult)
  }),
)

let n = 0
function show() {
  const id = `trading-${++n}`
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Fund', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0 }], activeId: id, keys: { [id]: 'k'.repeat(40) } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Trading />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  bot = createBot({ ticking: false, seed: 3 })
  sent = []
  perAccount = null
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})
afterAll(() => server.close())

async function fillBudget(user: ReturnType<typeof userEvent.setup>, amount: string) {
  await user.type(await screen.findByLabelText('Budget (optional)'), amount)
  await user.click(screen.getByRole('button', { name: 'Start trading' }))
}

describe('A budget for a new session', () => {
  it('is checked before starting: the confirmation says what it carries, and the start sends it', async () => {
    const user = userEvent.setup()
    show()

    await fillBudget(user, '4,000')

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('Before starting')).toBeInTheDocument()
    expect(within(sheet).getByText(/^Budget 4,000\.00 EUR\. .*room for \d+ positions? at once/)).toBeInTheDocument()
    expect(sent.find((args) => args[1] === 'check')).toEqual(expect.arrayContaining(['trading', 'check', '--budget', '4000', '--json']))

    await user.click(within(sheet).getByRole('button', { name: 'Start trading' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(sent.find((args) => args[1] === 'start')).toEqual(expect.arrayContaining(['--budget', '4000']))
  })

  it('that the balance does not carry is refused before anything opens, with the bot’s reason', async () => {
    const user = userEvent.setup()
    show()

    await fillBudget(user, '999999')

    expect(await screen.findByText('It would not start')).toBeInTheDocument()
    expect(screen.getByText(/A budget of 999,999\.00 EUR does not fit/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(sent.some((args) => args[1] === 'start')).toBe(false)
  })

  it('that is not an amount is said at the field, and nothing is sent', async () => {
    const user = userEvent.setup()
    show()

    await fillBudget(user, 'lots')

    expect(await screen.findByText(/An amount above 0/)).toBeInTheDocument()
    expect(sent.some((args) => args[1] === 'check' || args[1] === 'start')).toBe(false)
  })

  it('left empty, the session trades the whole balance: still checked, no budget sent', async () => {
    const user = userEvent.setup()
    show()

    await user.click(await screen.findByRole('button', { name: 'Start trading' }))

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).queryByText('Budget')).not.toBeInTheDocument()
    expect(sent.find((args) => args[1] === 'check')).not.toContain('--budget')
  })
})

describe('Every session of every account', () => {
  const session = (name: string, symbol: string, extra: Record<string, unknown> = {}) => ({
    name, market: { symbol, interval: 'Hour1' }, strategy: 'sample', parameters: {}, startedAt: '2026-11-15T08:00:00Z', ticks: 3, trades: 2,
    lastTick: null, lastError: null, lastErrorAt: null, nextTickAt: '2026-11-15T19:00:00Z', ...extra,
  })

  it('shows each account’s sessions in one table, with their budgets and a failed tick as an error', async () => {
    perAccount = {
      'client-a': [session('gold', 'XAUUSD', { budget: { amount: 4000, currency: 'EUR', since: '2026-11-15T08:00:00Z', money: 4084.1, room: 4, open: 1 } })],
      'client-b': [session('euro', 'EURPLN', { lastTick: { market: { symbol: 'EURPLN', interval: 'Hour1' }, strategy: 'sample', time: '2026-11-15T18:00:02Z', outcome: 'Failed', candle: null, insight: null, candlesAdded: 0, trade: null, elapsed: '00:00:00.1', nextTickAt: '2026-11-15T19:00:00Z', error: 'Market data is 3 hours old.' } })],
    }
    show()

    const table = await screen.findByRole('region', { name: 'Every session, every account' })
    expect(await within(table).findAllByText('gold')).not.toHaveLength(0)
    expect(await within(table).findAllByText('client-b')).not.toHaveLength(0)
    expect(within(table).getAllByText('4,084.10 EUR, room 4, 1 open').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('Whole balance').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('Failed 18:00').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('Market data is 3 hours old.').length).toBeGreaterThan(0)
    expect(sent.filter((args) => args[0] === 'session' && args[1] === 'strategies')).toHaveLength(2)
  })

  it('is left out with one account, whose sessions the screen shows already', async () => {
    show()

    await screen.findAllByText(/sample/)
    expect(screen.queryByRole('region', { name: 'Every session, every account' })).not.toBeInTheDocument()
  })
})

describe('reading a budget and a check', () => {
  it.each([
    ['', null, null],
    ['4000', 4000, null],
    ['4,000.50', 4000.5, null],
    [' 250 ', 250, null],
    ['0', null, 'An amount above 0, in the account’s currency, e.g. 4000.'],
    ['-5', null, 'An amount above 0, in the account’s currency, e.g. 4000.'],
    ['ten', null, 'An amount above 0, in the account’s currency, e.g. 4000.'],
  ])('“%s”', (text, amount, error) => {
    expect(readBudget(text)).toEqual({ amount, error })
  })

  it('reads the check, and nothing from an answer without one', () => {
    expect(readCheck({ json: { wouldStart: false, refusal: 'No.', text: 'No.', budget: { room: 0 }, unchecked: null } } as CommandResult)).toEqual({ wouldStart: false, refusal: 'No.', text: 'No.', room: 0, unchecked: null })
    expect(readCheck({ json: null } as CommandResult)).toBeNull()
  })
})
