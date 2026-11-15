import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createBot } from '../../../mock-bot/bot.mjs'
import { createClients } from '../../../mock-bot/clients.mjs'
import { createMenu } from '../../../mock-bot/menu.mjs'
import { createPeople } from '../../../mock-bot/people.mjs'
import { createPortfolio } from '../../../mock-bot/portfolio.mjs'
import { queryClient } from '../../api/bot.ts'
import type { CommandResult } from '../../api/types.ts'
import { useConnections } from '../../state/connections.ts'
import Activity from './Activity.tsx'
import { byDay, dayName } from './ActivityList.tsx'
import Home from './Home.tsx'
import { cashFlowsUnconfirmed, parsePortfolio, type AccountPortfolio } from './portfolio.ts'

/**
 * A client's Home and Activity (docs/fund-app-redesign-plan.md, step 10) against the mock bot's portfolio
 * (mock-bot/portfolio.mjs: one EUR account, a 2,000 deposit a week ago), over MSW, in every state an answer can take.
 */
const BOT_URL = 'https://fund.test:8443'
const KEY = 'k'.repeat(40)
type Name = 'portfolio' | 'activity' | 'session' | 'menu'
const CAROL = { login: 'carol', name: 'Carol Example', email: null, role: 'client' as const }
type Change = (json: unknown) => unknown
/** A change to the mock's answer, or a failure instead of it. */
let changes: Partial<Record<Name, Change>> = {}
let failures: Partial<Record<Name, () => Response>> = {}

const result = (partial: Partial<CommandResult>) =>
  HttpResponse.json({ command: 'x', exitCode: 0, ok: true, elapsedMs: 5, output: '', blocks: [], error: null, json: null, ...partial } satisfies CommandResult)
const failing = (exitCode: number, message: string) => () => result({ exitCode, ok: false, error: { message, hint: null } })

const server = setupServer(
  http.post(`${BOT_URL}/`, async ({ request }) => {
    const { args } = (await request.json()) as { args: string[] }
    const name = args[0] as Name
    const failure = failures[name]
    if (failure) return failure()
    const fund = createPortfolio(() => Date.now())
    // Home also reads what trades for the client (`session strategies`) and the menu's names, as carol.
    const answer =
      name === 'portfolio' ? fund.portfolio(args)
      : name === 'session' ? await createBot({ ticking: false, seed: 3 }).run(args)
      : name === 'menu' ? createMenu({ clientOf: createClients(createPeople().roleOf).clientOf }).run(args, CAROL)
      : fund.activity(args)
    const change = changes[name]
    return result({ ...answer, json: change ? change(answer.json) : answer.json })
  }),
)

const account = (json: unknown) => (json as { accounts: Record<string, unknown>[] }).accounts[0]!
const withAccount = (patch: Record<string, unknown>): Change => (json) => ({ accounts: [{ ...account(json), ...patch }] })

let n = 0
function show(element: ReactElement) {
  const id = `portfolio-${++n}`
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Fund', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0 }], activeId: id, keys: { [id]: KEY } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  changes = {}
  failures = {}
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})
afterAll(() => server.close())

describe('Home', () => {
  it('answers first what the money is worth and how it did, with the deposit left out and marked', async () => {
    show(<Home />)

    const figure = await screen.findByText('Your portfolio')
    const card = figure.closest('section')!
    expect(within(card).getByText(/^[\d,]+\.\d\d EUR$/)).toBeInTheDocument()
    expect(within(card).getByText('Today')).toBeInTheDocument()
    expect(within(card).getByText('This month')).toBeInTheDocument()
    expect(within(card).getByText('Since joining')).toBeInTheDocument()
    expect(within(card).getByText(/\+5\.74%/)).toBeInTheDocument()
    expect(within(card).getByText(/not counted as gains or losses/)).toBeInTheDocument()
    // The chart says in words what it shows, the deposit included.
    expect(screen.getByRole('img', { name: /since joining/ })).toBeInTheDocument()
    expect(screen.getByText(/a deposit of 2,000\.00 EUR on/)).toBeInTheDocument()
    expect(screen.queryByText('Deposits not confirmed yet')).not.toBeInTheDocument()
    // The latest three of what happened, in plain words.
    const latest = screen.getByRole('region', { name: 'Latest' })
    expect(await within(latest).findByText('Closed a Gold trade')).toBeInTheDocument()
    expect(within(latest).getAllByRole('listitem')).toHaveLength(3)
    expect(within(latest).getAllByRole('time').map((time) => time.textContent)).toEqual(['Today', 'Yesterday', expect.stringMatching(/^\w{3} \d{1,2} \w{3}$/)])
    expect(within(latest).getByRole('link', { name: 'All activity' })).toHaveAttribute('href', '/activity')
    // Whether anything is wrong, and what trades for them, in their words.
    expect(await screen.findByText('Everything is running')).toBeInTheDocument()
    const trading = screen.getByRole('region', { name: 'Trading for you' })
    expect(within(trading).getByText('A strategy run by the fund')).toBeInTheDocument()
    expect(within(trading).getByText(/· Gold, since /)).toBeInTheDocument()
  })

  it('says which strategy could not trade', async () => {
    changes.session = (json) => (json as Record<string, unknown>[]).map((s) => ({ ...s, lastError: 'The broker refused the order.', lastErrorAt: new Date().toISOString() }))
    show(<Home />)

    expect(await screen.findByText('A strategy could not trade just now')).toBeInTheDocument()
    expect(screen.getByText(/^A strategy run by the fund\. The fund sees this too/)).toBeInTheDocument()
    expect(screen.queryByText('Everything is running')).not.toBeInTheDocument()
  })

  it('says when the value is late', async () => {
    changes.portfolio = withAccount({ valuedAt: new Date(Date.now() - 5 * 3600_000).toISOString() })
    show(<Home />)

    expect(await screen.findByText('Your value is late')).toBeInTheDocument()
  })

  it('says a sign-in that ended in the client’s words, not the API key’s', async () => {
    failures.portfolio = () => new HttpResponse(null, { status: 401 })
    show(<Home />)

    expect(await screen.findByText('Your sign-in has ended')).toBeInTheDocument()
    expect(screen.queryByText(/API key/)).not.toBeInTheDocument()
  })

  it('warns that a recent deposit may still count as a gain until the broker is asked', async () => {
    changes.portfolio = withAccount({ cashFlowsConfirmedUntil: null })
    show(<Home />)

    expect(await screen.findByText('Deposits not confirmed yet')).toBeInTheDocument()
  })

  it('says the portfolio is being set up before its first value', async () => {
    changes.portfolio = withAccount({ value: null, valuedAt: null, series: [], returns: { today: null, month: null, sinceStart: null } })
    show(<Home />)

    expect(await screen.findByText('Your portfolio is being set up')).toBeInTheDocument()
  })

  it('waits for a second day before drawing the chart', async () => {
    changes.portfolio = (json) => {
      const first = account(json)
      return { accounts: [{ ...first, series: (first.series as unknown[]).slice(-1) }] }
    }
    show(<Home />)

    expect(await screen.findByText('The chart starts tomorrow')).toBeInTheDocument()
  })

  it('says so when no account is linked yet', async () => {
    changes.portfolio = () => ({ accounts: [] })
    show(<Home />)

    expect(await screen.findByText('No account is linked to you yet')).toBeInTheDocument()
  })

  it('names each account when there are several', async () => {
    changes.portfolio = (json) => ({ accounts: [account(json), { ...account(json), login: 'second', currency: 'USDT' }] })
    show(<Home />)

    expect(await screen.findByRole('heading', { name: 'Account demo' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Account second' })).toBeInTheDocument()
    expect(screen.getByText(/USDT$/)).toBeInTheDocument()
  })

  it('tells a server from before portfolios apart from a failure, and offers to try again after one', async () => {
    failures.portfolio = failing(2, "Unknown command 'portfolio'.")
    show(<Home />)
    expect(await screen.findByText('The fund’s server does not show portfolio yet')).toBeInTheDocument()
    cleanup()
    queryClient.clear()

    failures.portfolio = failing(1, 'The database is not reachable.')
    show(<Home />)
    expect(await screen.findByText('Your portfolio could not be loaded')).toBeInTheDocument()
    expect(screen.getByText('The database is not reachable.')).toBeInTheDocument()
    failures.portfolio = undefined
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Your portfolio')).toBeInTheDocument()
  })
})

describe('Activity', () => {
  it('lists what happened, newest first, one card per day, with the money it made or moved', async () => {
    show(<Activity />)

    const today = await screen.findByRole('region', { name: 'Today' })
    expect(within(today).getByText('Closed a Gold trade')).toBeInTheDocument()
    // The currency comes with the portfolio, which may answer after the activity.
    expect(await within(today).findByText(/\+84\.10 EUR/)).toBeInTheDocument()
    const yesterday = screen.getByRole('region', { name: 'Yesterday' })
    expect(within(yesterday).getByText(/-12\.40 EUR/)).toBeInTheDocument()
    expect(screen.getByText('Deposit: Second transfer')).toBeInTheDocument()
    expect(screen.getByText('+2,000.00 EUR')).toBeInTheDocument()
    expect(screen.getByText('Strategy started: Gold')).toBeInTheDocument()
  })

  it('says when nothing has happened yet', async () => {
    changes.activity = () => []
    show(<Activity />)

    expect(await screen.findByText('Nothing has happened yet')).toBeInTheDocument()
  })
})

describe('reading the answers', () => {
  const NOW = Date.parse('2026-11-15T14:20:00Z')

  it('reads the bot’s portfolio, and an older bot’s without the broker check as unconfirmed', () => {
    const json = createPortfolio(() => NOW).portfolio(['portfolio', '--json']).json as { accounts: Record<string, unknown>[] }
    const reading = parsePortfolio({ json } as CommandResult)
    expect(reading.ok).toBe(true)
    const read = (reading as { value: AccountPortfolio[] }).value[0]!
    expect(read).toMatchObject({ login: 'demo', currency: 'EUR', returns: { sinceStart: expect.any(Number) } })
    expect(read.series).toHaveLength(70)
    expect(cashFlowsUnconfirmed(read, NOW)).toBe(false)
    expect(cashFlowsUnconfirmed(read, NOW + 3 * 3600_000)).toBe(true)

    const older = parsePortfolio({ json: { accounts: [{ ...json.accounts[0], cashFlowsConfirmedUntil: undefined }] } } as CommandResult)
    expect(cashFlowsUnconfirmed((older as { value: AccountPortfolio[] }).value[0]!, NOW)).toBe(true)
  })

  it('calls an answer without accounts unreadable', () => {
    expect(parsePortfolio({ json: null } as CommandResult).ok).toBe(false)
  })

  it('names the days the way people do, in UTC', () => {
    expect(dayName('2026-11-15T01:00:00Z', NOW)).toBe('Today')
    expect(dayName('2026-11-14T23:59:00Z', NOW)).toBe('Yesterday')
    expect(dayName('2026-11-07T11:30:00Z', NOW)).toBe('Sat 7 Nov')
    const items = ['2026-11-15T12:00:00Z', '2026-11-15T09:00:00Z', '2026-11-14T10:00:00Z'].map((at) => ({ at, account: 'demo', kind: 'close', text: at, amount: null }))
    expect(byDay(items, NOW).map((group) => [group.day, group.items.length])).toEqual([['Today', 2], ['Yesterday', 1]])
  })
})
