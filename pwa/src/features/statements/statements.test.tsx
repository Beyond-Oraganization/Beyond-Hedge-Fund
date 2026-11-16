import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPortfolio } from '../../../mock-bot/portfolio.mjs'
import { queryClient } from '../../api/bot.ts'
import type { CommandResult } from '../../api/types.ts'
import { useConnections } from '../../state/connections.ts'
import Statement from './Statement.tsx'
import { StatementsCard } from './StatementsCard.tsx'
import { monthName, parseStatement } from './statements.ts'

/**
 * Monthly statements (docs/fund-app-redesign-plan.md, step 17) against the mock bot's (mock-bot/portfolio.mjs: one EUR
 * account with seventy days of values, a 2,000 deposit a week ago), over MSW, in every state an answer can take.
 */
const BOT_URL = 'https://fund.test:8443'
const KEY = 'k'.repeat(40)
const CLIENT = { id: 1, name: 'Carol Example', accounts: ['demo'] }

let change: ((json: Record<string, unknown>) => unknown) | null = null
let failure: (() => Response) | null = null
const asked: string[][] = []

const result = (partial: Partial<CommandResult>) =>
  HttpResponse.json({ command: 'x', exitCode: 0, ok: true, elapsedMs: 5, output: '', blocks: [], error: null, json: null, ...partial } satisfies CommandResult)

const server = setupServer(
  http.post(`${BOT_URL}/`, async ({ request }) => {
    const { args } = (await request.json()) as { args: string[] }
    asked.push(args)
    if (failure) return failure()
    const answer = createPortfolio(() => Date.now()).statement(args, CLIENT)
    return result({ ...answer, ok: answer.exitCode === 0, json: change && answer.json ? change(answer.json as Record<string, unknown>) : answer.json })
  }),
)

const month = (back: number) => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7)
}
const account = (json: Record<string, unknown>) => (json.accounts as Record<string, unknown>[])[0]!

let n = 0
function show(path: string, element = <Statement />) {
  const id = `statements-${++n}`
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Fund', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0 }], activeId: id, keys: { [id]: KEY } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/me/statements/:month" element={element} />
          <Route path="/clients/:id/statements/:month" element={element} />
          <Route path="/me" element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  change = null
  failure = null
  asked.length = 0
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})
afterAll(() => server.close())

describe('a month’s statement', () => {
  it('shows the value as the month began and ended, the money moved, what trading made and the return', async () => {
    show(`/me/statements/${month(1)}`)

    const summary = await screen.findByRole('region', { name: /^Your account, in EUR$/ })
    expect(within(summary).getByRole('rowheader', { name: 'Value as the month began' })).toBeTruthy()
    expect(within(summary).getByRole('rowheader', { name: 'Value as the month ended' })).toBeTruthy()
    expect(within(summary).getByRole('rowheader', { name: 'What trading made' })).toBeTruthy()
    expect(within(summary).getByRole('rowheader', { name: 'Return for the month' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: `Statement for ${monthName(month(1))}` })).toBeTruthy()
    expect(screen.getByText('Carol Example')).toBeTruthy()
    expect(screen.queryByText(/This month is not over/)).toBeNull()
    expect(asked.at(-1)).toEqual(['statement', '--month', month(1), '--json'])
  })

  it('lists the positions closed by strategy, the deposits and the strategies started', async () => {
    change = (json) => ({ ...json, accounts: [{ ...account(json), events: [{ at: '2026-10-03T08:00:00Z', text: 'Strategy started: drcs, Gold' }], cashFlows: [{ at: '2026-10-20T09:00:00Z', amount: 2000, note: 'Second transfer' }] }] })
    show(`/me/statements/${month(1)}`)

    const strategies = await screen.findByRole('region', { name: 'strategies' })
    expect(within(strategies).getAllByText('Gold').length).toBeGreaterThan(0)
    expect(within(strategies).getAllByText('Placed by the fund').length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: 'closed positions' })).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'deposits and withdrawals' })).getByText('Deposit: Second transfer')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'strategies started and stopped' })).getByText('Strategy started: drcs, Gold')).toBeTruthy()
  })

  it('says the month under way is so far', async () => {
    show(`/me/statements/${month(0)}`)

    expect(await screen.findByText(/This month is not over/)).toBeTruthy()
    expect(screen.getByText(/, so far$/)).toBeTruthy()
  })

  it('says when the return is not confirmed', async () => {
    change = (json) => ({ ...json, accounts: [{ ...account(json), cashFlowsConfirmed: false }] })
    show(`/me/statements/${month(1)}`)

    expect(await screen.findByText('Return not confirmed yet.')).toBeTruthy()
  })

  it('adds up accounts in one currency', async () => {
    change = (json) => ({
      ...json,
      accounts: [account(json), { ...account(json), login: 'demo-2' }],
      totals: [{ currency: 'EUR', accounts: 2, opening: 2000, closing: 2300, deposits: 100, withdrawals: 0, change: 200, realized: 150 }],
    })
    show(`/me/statements/${month(1)}`)

    expect(await screen.findByRole('region', { name: 'All your accounts in EUR' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Account demo-2, in EUR' })).toBeTruthy()
  })

  it('prints', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    show(`/me/statements/${month(1)}`)

    await userEvent.click(await screen.findByRole('button', { name: 'Print or save as PDF' }))

    expect(print).toHaveBeenCalledOnce()
    print.mockRestore()
  })

  it('asks staff’s statement for the client in the address', async () => {
    show(`/clients/1/statements/${month(1)}`)

    await screen.findByRole('heading', { name: /^Statement for/ })
    expect(asked.at(-1)).toEqual(['statement', '--month', month(1), '--client', '1', '--json'])
    expect(screen.getByRole('link', { name: 'Back to the client' }).getAttribute('href')).toBe('/clients/1')
  })

  it('refuses an address that is not a month, without asking the bot', async () => {
    show('/me/statements/october')

    expect(await screen.findByText('“october” is not a month')).toBeTruthy()
    expect(asked).toEqual([])
  })

  it('shows the bot’s refusal', async () => {
    failure = () => result({ exitCode: 1, ok: false, error: { message: 'Client 2 is not yours.', hint: null } })
    show(`/me/statements/${month(1)}`)

    expect(await screen.findByText('Your statement could not be loaded')).toBeTruthy()
    expect(screen.getByText('Client 2 is not yours.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Print or save as PDF' })).toBeNull()
  })

  it('says a server from before statements needs an update', async () => {
    failure = () => result({ exitCode: 2, ok: false, error: { message: "Unknown command 'statement'.", hint: null } })
    show(`/me/statements/${month(1)}`)

    expect(await screen.findByText('The fund’s server does not show statement yet')).toBeTruthy()
  })
})

describe('statements by month', () => {
  it('links each month, newest first, and marks the one under way', async () => {
    show('/me', <StatementsCard base="/me/statements" />)

    const links = await screen.findAllByRole('link')
    expect(links[0]!.textContent).toBe(monthName(month(0)))
    expect(links[1]!.getAttribute('href')).toBe(`/me/statements/${month(1)}`)
    expect(screen.getByText('(so far)')).toBeTruthy()
  })

  it('says when there is none yet', async () => {
    change = (json) => ({ ...json, months: [] })
    show('/me', <StatementsCard base="/me/statements" />)

    expect(await screen.findByText(/first statement shows here/)).toBeTruthy()
  })
})

describe('reading a statement', () => {
  it('turns down an answer without one', () => {
    expect(parseStatement({ command: 'x', exitCode: 0, ok: true, elapsedMs: 1, output: '', blocks: [], error: null, json: { months: [] } }).ok).toBe(false)
  })

  it('names a month', () => expect(monthName('2026-10')).toBe('October 2026'))
})
