import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createClients, type MockClients } from '../../../mock-bot/clients.mjs'
import { createPeople } from '../../../mock-bot/people.mjs'
import { createPortfolio } from '../../../mock-bot/portfolio.mjs'
import { queryClient } from '../../api/bot.ts'
import type { CommandResult } from '../../api/types.ts'
import { useConnections } from '../../state/connections.ts'
import ClientPage from './ClientPage.tsx'
import { readiness } from './clients.ts'
import ClientsList from './ClientsList.tsx'
import ViewAsClient from './ViewAsClient.tsx'

/**
 * Staff's clients (docs/fund-app-redesign-plan.md, step 11) against the mock bot's clients and portfolio
 * (mock-bot/clients.mjs, portfolio.mjs), which keep the real bot's rules and messages, over MSW.
 */
const BOT_URL = 'https://fund.test:8443'
let clients: MockClients
let sent: string[][] = []

const server = setupServer(
  http.post(`${BOT_URL}/`, async ({ request }) => {
    const { args } = (await request.json()) as { args: string[] }
    sent.push(args)
    const fund = createPortfolio(() => Date.now())
    const answer = args[0] === 'portfolio' ? fund.portfolio(args) : args[0] === 'activity' ? fund.activity(args) : clients.run(args)
    return HttpResponse.json({ command: args.join(' '), elapsedMs: 3, ok: answer.exitCode === 0, account: null, connection: null, ...answer } satisfies CommandResult)
  }),
)

let n = 0
function show(path: string) {
  const id = `clients-${++n}`
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Fund', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0 }], activeId: id, keys: { [id]: 'k'.repeat(40) } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/clients" element={<ClientsList />} />
          <Route path="/clients/:id" element={<ClientPage />} />
          <Route path="/clients/:id/view" element={<ViewAsClient />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  clients = createClients(createPeople().roleOf)
  sent = []
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})
afterAll(() => server.close())

describe('Clients', () => {
  it('lists each client with their account, its value and this month, who signs in, and that nothing is missing', async () => {
    show('/clients')

    expect((await screen.findAllByRole('link', { name: 'Carol Example' }))[0]).toHaveAttribute('href', '/clients/1')
    expect(await screen.findAllByText(/^[\d,]+\.\d\d EUR$/)).not.toHaveLength(0)
    expect(screen.getAllByText('carol').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0)
  })

  it('adds a client and opens their page, which says what is missing', async () => {
    const user = userEvent.setup()
    show('/clients')

    await user.type(await screen.findByLabelText('Name'), 'Dana Example')
    await user.click(screen.getByRole('button', { name: 'Add client' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Dana Example' })).toBeInTheDocument()
    expect(screen.getByText('No account linked')).toBeInTheDocument()
    expect(sent).toContainEqual(['clients', 'add', 'Dana Example', '--json'])
  })

  it('asks for a name before adding', async () => {
    const user = userEvent.setup()
    show('/clients')

    await user.click(await screen.findByRole('button', { name: 'Add client' }))

    expect(screen.getByText('Give the client a name.')).toBeInTheDocument()
    expect(sent.some((args) => args[1] === 'add')).toBe(false)
  })
})

describe('A client’s page', () => {
  it('shows what the client sees, their account and who signs in', async () => {
    show('/clients/1')

    expect(await screen.findByRole('heading', { level: 1, name: 'Carol Example' })).toBeInTheDocument()
    const sees = screen.getByRole('region', { name: 'What the client sees' })
    expect(await within(sees).findByText(/^[\d,]+\.\d\d EUR$/)).toBeInTheDocument()
    expect(within(sees).getByRole('link', { name: 'View as client' })).toHaveAttribute('href', '/clients/1/view')
    const accounts = screen.getByRole('region', { name: 'Accounts' })
    expect(within(accounts).getByText('demo')).toBeInTheDocument()
    expect(await within(accounts).findByText(/CTrader Demo/)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Who signs in' })).getByText('carol')).toBeInTheDocument()
  })

  it('unlinks an account and links it again, without asking (a link is undone by linking)', async () => {
    const user = userEvent.setup()
    show('/clients/1')
    const accounts = await screen.findByRole('region', { name: 'Accounts' })

    await user.click(await within(accounts).findByRole('button', { name: 'Unlink demo' }))
    expect(await within(accounts).findByText('No account linked yet.')).toBeInTheDocument()

    await user.selectOptions(within(accounts).getByLabelText('Managed account'), 'demo')
    await user.click(within(accounts).getByRole('button', { name: 'Link account' }))
    expect(await within(accounts).findByRole('button', { name: 'Unlink demo' })).toBeInTheDocument()
    expect(sent).toContainEqual(['clients', 'unlink', '1', '--account', 'demo'])
    expect(sent).toContainEqual(['clients', 'link', '1', '--account', 'demo'])
  })

  it('shows the bot’s reason when a person cannot be linked', async () => {
    const user = userEvent.setup()
    show('/clients/1')
    const people = await screen.findByRole('region', { name: 'Who signs in' })

    await user.type(within(people).getByLabelText(/Login of a person/), 'sam')
    await user.click(within(people).getByRole('button', { name: 'Link person' }))

    expect(await within(people).findByText('sam is staff: staff and the owner reach every managed account already.')).toBeInTheDocument()
  })

  it('says so for a client that does not exist', async () => {
    show('/clients/99')

    expect(await screen.findByText('No client 99')).toBeInTheDocument()
  })
})

describe('Viewing as a client', () => {
  it('shows the client’s Home for their accounts only, and says whose it is', async () => {
    show('/clients/1/view')

    expect(await screen.findByText('You are seeing what Carol Example sees')).toBeInTheDocument()
    expect(await screen.findByText('Your portfolio')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'All activity' })).not.toBeInTheDocument()
  })

  it('shows a client without an account what they would see', async () => {
    clients.run(['clients', 'add', 'Dana Example'])
    show('/clients/2/view')

    expect(await screen.findByText('No account is linked to you yet')).toBeInTheDocument()
  })
})

describe('what is missing for a client', () => {
  const client = { id: 1, name: 'A', createdAt: '', people: ['carol'], accounts: ['demo'] }
  const valued = { login: 'demo', currency: 'EUR', value: 1, valuedAt: null, returns: { today: null, month: null, sinceStart: null }, series: [], cashFlows: [], cashFlowsConfirmedUntil: null }

  it.each([
    [{ ...client, accounts: [] }, [], 'No account linked'],
    [{ ...client, people: [] }, [], 'Nobody signs in'],
    [client, [{ ...valued, value: null }], 'First value within the hour'],
    [client, [valued], 'Ready'],
  ])('%#: %s', (c, portfolios, words) => {
    expect(readiness(c, portfolios).words).toBe(words)
  })
})
