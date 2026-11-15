import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createClients, type MockClients } from '../../../mock-bot/clients.mjs'
import { overview } from '../../../mock-bot/overview.mjs'
import { createPeople } from '../../../mock-bot/people.mjs'
import { createPortfolio } from '../../../mock-bot/portfolio.mjs'
import { queryClient } from '../../api/bot.ts'
import type { CommandResult } from '../../api/types.ts'
import { useConnections } from '../../state/connections.ts'
import Overview from './Overview.tsx'
import { placeOf, type OverviewAlert } from './overview.ts'

/** The staff's Overview (docs/fund-app-redesign-plan.md, step 13) against the mock bot's `fund overview`, over MSW. */
const BOT_URL = 'https://fund.test:8443'
let clients: MockClients
type Session = { name: string; key: string; lastTick: { outcome: string; error?: string | null } | null }
let sessions: Session[] = []
let failure: CommandResult['error'] = null

const server = setupServer(
  http.post(`${BOT_URL}/`, async ({ request }) => {
    const { args } = (await request.json()) as { args: string[] }
    if (failure) return HttpResponse.json({ command: args.join(' '), exitCode: 2, ok: false, elapsedMs: 1, output: '', blocks: [], error: failure, json: null } satisfies CommandResult)
    const answer = overview(args, { portfolio: createPortfolio(() => Date.now()), clients, sessions: () => sessions, now: () => Date.now() })
    return HttpResponse.json({ command: args.join(' '), elapsedMs: 3, ok: true, account: null, connection: null, ...answer } satisfies CommandResult)
  }),
)

let n = 0
function show() {
  const id = `overview-${++n}`
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Fund', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0 }], activeId: id, keys: { [id]: 'k'.repeat(40) } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Overview />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  clients = createClients(createPeople().roleOf)
  sessions = [{ name: 'drcs', key: 'XAUUSD 1h', lastTick: null }]
  failure = null
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})
afterAll(() => server.close())

describe('Overview', () => {
  it('shows the money under management, today’s result, and the fund’s size', async () => {
    show()

    expect(await screen.findByText('Under management, EUR')).toBeInTheDocument()
    expect(screen.getByText(/^[\d,]+\.\d\d EUR$/)).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '1 clients: open Clients' })).toHaveAttribute('href', '/clients')
    expect(screen.getByRole('link', { name: '1 strategy sessions: open Trading' })).toHaveAttribute('href', '/trading')
    expect(screen.getByText('Managed accounts').closest('.k-stat')).toHaveTextContent('1')
  })

  it('says when nothing needs attention', async () => {
    show()

    expect(await screen.findByText(/Nothing needs attention/)).toBeInTheDocument()
  })

  it('lists what needs attention, errors first, each with the place to fix it', async () => {
    clients.run(['clients', 'add', 'Dana Example'])
    sessions = [{ name: 'gold', key: 'XAUUSD 1h', lastTick: { outcome: 'Failed', error: 'Market data is 3 hours old.' } }]
    show()

    const list = await screen.findByRole('region', { name: 'Needs attention' })
    const items = await within(list).findAllByRole('listitem')
    expect(items[0]).toHaveTextContent("Error'gold' on demo (XAUUSD 1h): its last tick failed: Market data is 3 hours old.")
    expect(within(items[0]!).getByRole('link', { name: 'Open Trading' })).toHaveAttribute('href', '/trading')
    expect(items[1]).toHaveTextContent('CheckDana Example has no account linked.')
    expect(within(items[1]!).getByRole('link', { name: 'Open the client' })).toHaveAttribute('href', '/clients/2')
  })

  it('tells a server from before the overview apart', async () => {
    failure = { message: "Unknown command 'overview'.", hint: null }
    show()

    expect(await screen.findByText('The fund’s server does not show overview yet')).toBeInTheDocument()
  })
})

describe('where an alert is fixed', () => {
  const alert = (patch: Partial<OverviewAlert>): OverviewAlert => ({ severity: 'warn', kind: 'valueOld', text: '', account: 'demo', client: null, session: null, ...patch })

  it.each([
    [alert({ client: 3, kind: 'clientNoPerson' }), '/clients/3'],
    [alert({ kind: 'accountNoClient' }), '/clients'],
    [alert({ kind: 'tickLate', session: 'gold' }), '/trading'],
    [alert({ kind: 'notConnected' }), '/trading'],
    [alert({ kind: 'valueOld' }), null],
  ])('%#', (given, to) => {
    expect(placeOf(given)?.to ?? null).toBe(to)
  })
})
