import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createBot, type MockBot } from '../../../mock-bot/bot.mjs'
import { createClients } from '../../../mock-bot/clients.mjs'
import { createMenu, type MockMenu } from '../../../mock-bot/menu.mjs'
import { createPeople } from '../../../mock-bot/people.mjs'
import { queryClient } from '../../api/bot.ts'
import type { CommandResult } from '../../api/types.ts'
import { useConnections } from '../../state/connections.ts'
import ClientStrategies from './ClientStrategies.tsx'
import { LimitsCard } from './LimitsCard.tsx'
import { offered, offerLink, sizingWords } from './menu.ts'
import MenuEditor from './MenuEditor.tsx'

/**
 * Step 16 of docs/fund-app-redesign-plan.md: a client's Strategies (what trades for them, Stop, Add from the menu within their
 * limits), the owner's Strategy menu, and a client's Limits, against the mock bot (bot.mjs, menu.mjs) over MSW. As
 * mock-bot/server.mjs does, a start or check from the menu becomes the bot's own arguments, with a client's limits first.
 */
const BOT_URL = 'https://fund.test:8443'
let bot: MockBot
let menu: MockMenu
let person: { login: string; role: string } | null = null
let sent: string[][] = []

const result = (args: string[], answer: Omit<CommandResult, 'command' | 'elapsedMs' | 'ok'>) =>
  HttpResponse.json({ command: args.join(' '), elapsedMs: 3, ...answer, json: answer.json ?? null, ok: answer.exitCode === 0 } satisfies CommandResult)

const server = setupServer(
  http.post(`${BOT_URL}/`, async ({ request }) => {
    let { args } = (await request.json()) as { args: string[] }
    sent.push(args)
    if (args[0] === 'menu' || (args[0] === 'clients' && args[1] === 'limits')) return result(args, menu.run(args, person))
    let check: { refusal: string | null; largest: number | null } | null = null
    if (args[0] === 'trading' && args.includes('--setup')) {
      const s = bot.state as { account: { balance: number; currency: string }; sessions: Map<string, unknown> }
      const expanded = menu.expand(args, person, { balance: s.account.balance, currency: s.account.currency, sessions: [...s.sessions.keys()], live: false })
      if ('answer' in expanded) return result(args, expanded.answer)
      if (expanded.check?.refusal && args[1] === 'start') return result(args, { exitCode: 1, output: '', blocks: [], error: { message: expanded.check.refusal, hint: null }, json: null })
      ;({ args, check } = expanded)
    }
    const answer = await bot.run(args)
    if (check && answer.json && typeof answer.json === 'object') {
      const json = answer.json as Record<string, unknown>
      json.largestBudget = check.largest
      if (check.refusal) Object.assign(json, { wouldStart: false, refusal: check.refusal })
    }
    return result(args, answer)
  }),
)

let n = 0
function show(element: ReactElement, path = '/') {
  const id = `menu-${++n}`
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Fund', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0 }], activeId: id, keys: { [id]: 'k'.repeat(40) } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  bot = createBot({ ticking: false, seed: 3 })
  const clients = createClients(createPeople().roleOf)
  menu = createMenu({ clientOf: (login) => clients.clientOf(login) })
  person = null
  sent = []
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})
afterAll(() => server.close())

const sentStart = () => sent.find((args) => args[0] === 'trading' && args[1] === 'start')

describe('A client’s Strategies', () => {
  beforeEach(() => {
    person = { login: 'carol', role: 'client' }
  })

  it('shows what trades for them and the setups the fund offers them, in words', async () => {
    show(<ClientStrategies />)

    const running = await screen.findByRole('region', { name: 'Trading for you' })
    // Started by the fund, not from the menu: no bot name ("drcs") for a client, and what it trades in plain words.
    expect(await within(running).findByText('A strategy run by the fund')).toBeInTheDocument()
    expect(within(running).getByText(/^Gold · since /)).toBeInTheDocument()
    const offers = screen.getByRole('region', { name: 'Add a strategy' })
    expect(await within(offers).findByText('Gold trend, steady')).toBeInTheDocument()
    expect(within(offers).getByText('Euro range, careful')).toBeInTheDocument()
    expect(within(offers).getByText('25% of the budget per position.')).toBeInTheDocument()
    expect(within(offers).getByText('Careful')).toBeInTheDocument()
  })

  it('checks a budget against their limits, refuses one too large in the bot’s words, and starts one that fits', async () => {
    const user = userEvent.setup()
    show(<ClientStrategies />)

    await user.click(await screen.findByRole('button', { name: 'Choose Gold trend, steady' }))
    const budget = screen.getByLabelText(/^Budget/)
    expect(await screen.findByText(/^At most [\d,]+\.\d\d EUR on this account\./)).toBeInTheDocument()

    await user.type(budget, '9000')
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('It would not start')).toBeInTheDocument()
    expect(screen.getByText(/^A budget of 9,000\.00 EUR is more than your largest here/)).toBeInTheDocument()

    await user.clear(budget)
    await user.type(budget, '2000')
    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(await screen.findByText('It would start')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start Gold trend, steady' }))

    expect(await screen.findByText(/^Gold trend, steady is trading for you with 2,000\.00 EUR\./)).toBeInTheDocument()
    expect(sentStart()).toEqual(['trading', 'start', '--setup', '1', '--budget', '2000'])
    // The new session, under the menu's name.
    expect(await within(screen.getByRole('region', { name: 'Trading for you' })).findByText('Gold trend, steady')).toBeInTheDocument()
  })

  it('stops a strategy after asking in place, saying what stays open', async () => {
    const user = userEvent.setup()
    show(<ClientStrategies />)

    await user.click(await screen.findByRole('button', { name: 'Stop the strategy run by the fund' }))
    const ask = screen.getByRole('group', { name: 'Stop the strategy run by the fund?' })
    expect(ask).toHaveTextContent(/It won’t open new trades\./)
    await user.click(within(ask).getByRole('button', { name: 'Stop it' }))

    await waitFor(() => expect(sent).toContainEqual(['trading', 'stop', '--name', 'drcs']))
    expect(await screen.findByText('Nothing trades for you right now')).toBeInTheDocument()
  })

  it('keeps it running when they change their mind', async () => {
    const user = userEvent.setup()
    show(<ClientStrategies />)

    await user.click(await screen.findByRole('button', { name: 'Stop the strategy run by the fund' }))
    await user.click(screen.getByRole('button', { name: 'Keep it running' }))

    expect(screen.queryByRole('group', { name: 'Stop the strategy run by the fund?' })).not.toBeInTheDocument()
    expect(sent.some((args) => args[1] === 'stop')).toBe(false)
  })
})

describe('The owner’s Strategy menu', () => {
  it('lists the setups, withdraws one, and changes another’s words', async () => {
    const user = userEvent.setup()
    show(<MenuEditor />, '/menu')

    await user.click((await screen.findAllByRole('button', { name: 'Withdraw Euro range, careful' }))[0]!)
    expect(await screen.findByText(/^Menu setup 2 is withdrawn/)).toBeInTheDocument()
    expect((await screen.findAllByText('Withdrawn')).length).toBeGreaterThan(0)

    await user.click(screen.getAllByRole('button', { name: 'Change words of Gold trend, steady' })[0]!)
    const name = screen.getAllByLabelText('Name clients read')[0]!
    await user.clear(name)
    await user.type(name, 'Gold trend, calm')
    await user.click(screen.getByRole('button', { name: 'Save words' }))
    expect(await screen.findByText(/^Menu setup 1 is now: Gold trend, calm/)).toBeInTheDocument()
  })

  it('adds a setup from the strategy form, with the words clients read', async () => {
    const user = userEvent.setup()
    show(<MenuEditor />, '/menu')

    const form = await screen.findByRole('region', { name: 'Add a setup' })
    await user.click(await within(form).findByRole('button', { name: 'Add to the menu' }))
    expect(within(form).getByText('Give the setup a name clients read.')).toBeInTheDocument()

    await user.type(within(form).getByLabelText('Name clients read'), 'Gold dips, bold')
    await user.type(within(form).getByLabelText('What it does, and when it loses'), 'Buys deeper dips with larger positions.')
    await user.selectOptions(within(form).getByLabelText('Risk'), 'bold')
    await user.click(within(form).getByRole('button', { name: 'Add to the menu' }))

    expect(await screen.findByText(/^Added menu setup 3: Gold dips, bold \(bold\)/)).toBeInTheDocument()
    const add = sent.find((args) => args[0] === 'menu' && args[1] === 'add')!
    expect(add).toEqual(expect.arrayContaining(['drcs', '--symbol', 'XAUUSD', '--interval', '1h', '--name', 'Gold dips, bold', '--risk', 'bold']))
  })

  it('takes a backtest offered to clients, filled in', async () => {
    const link = offerLink({ strategy: 'drcs', symbol: 'XAUUSD', interval: '1h', params: { depth: 30 }, rules: ['open long on cross down lower 2'], sizing: 'percent:10' })
    show(<MenuEditor />, link)

    expect(await screen.findByRole('region', { name: 'Offer this backtest to clients' })).toBeInTheDocument()
    expect(screen.getByText('From your backtest')).toBeInTheDocument()
  })
})

describe('A client’s Limits', () => {
  it('shows what the client may start and saves a change', async () => {
    const user = userEvent.setup()
    show(<LimitsCard client={1} />)

    const euro = await screen.findByRole('checkbox', { name: /Euro range, careful/ })
    expect(euro).toBeChecked()
    expect(screen.getByLabelText('Largest budget (% of the balance)')).toHaveValue('40')
    await user.click(euro)
    await user.type(screen.getByLabelText('Largest budget (amount)'), '3000')
    await user.click(screen.getByRole('button', { name: 'Save limits' }))

    expect(await screen.findByText(/^Limits saved/)).toBeInTheDocument()
    expect(sent.find((args) => args[1] === 'limits' && args.includes('--setups'))).toEqual(
      ['clients', 'limits', '1', '--setups', '1', '--max-budget', '3000', '--max-budget-percent', '40', '--max-sessions', '2', '--live', 'no', '--json'],
    )
  })

  it('says a client without limits may start nothing', async () => {
    show(<LimitsCard client={2} />)

    expect(await screen.findByText('No limits yet: this client may start nothing')).toBeInTheDocument()
  })
})

describe('the menu’s words and links', () => {
  it('hands a backtest over and back', () => {
    const input = { strategy: 'drcs', symbol: 'XAUUSD', interval: '1h', params: { depth: 30 }, rules: ['open long on cross down lower 2'], sizing: 'kelly:50' }
    const config = offered(new URLSearchParams(offerLink(input).split('?')[1]).get('offer'))
    expect(config).toMatchObject({ strategy: 'drcs', market: 'XAUUSD 1h', rules: ['open long on cross down lower 2'] })
    expect(offered('not base64 json')).toBeNull()
  })

  it.each([
    ['percent:25', '25% of the budget per position'],
    ['fixed:500', '500 per position'],
    ['kelly:50', 'Kelly sizing (50% of it)'],
  ])('%s', (sizing, words) => {
    expect(sizingWords(sizing)).toBe(words)
  })
})
