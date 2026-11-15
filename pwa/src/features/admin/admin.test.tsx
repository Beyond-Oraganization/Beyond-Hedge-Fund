import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAudit, type MockAudit } from '../../../mock-bot/audit.mjs'
import { createClients, type MockClients } from '../../../mock-bot/clients.mjs'
import { createPeople, type MockPeople } from '../../../mock-bot/people.mjs'
import { queryClient } from '../../api/bot.ts'
import type { CommandResult } from '../../api/types.ts'
import { useConnections } from '../../state/connections.ts'
import { signInWords, temporaryPassword, type Person } from './admin.ts'
import Audit from './Audit.tsx'
import Managed from './Managed.tsx'
import People from './People.tsx'

/**
 * The Admin pages of step 14 (docs/fund-app-redesign-plan.md): People (the owner's), Managed accounts and the Audit log,
 * against the mock bot's people, clients and audit (mock-bot/people.mjs, clients.mjs, audit.mjs) over MSW, as the API key.
 */
const BOT_URL = 'https://fund.test:8443'
let people: MockPeople
let clients: MockClients
let audit: MockAudit
let sent: string[][] = []

const server = setupServer(
  http.post(`${BOT_URL}/`, async ({ request }) => {
    const { args } = (await request.json()) as { args: string[] }
    sent.push(args)
    const answer = args[0] === 'people' ? people.manage(args) : args[0] === 'audit' ? audit.run(args) : clients.run(args)
    audit.record(args, { kind: 'apiKey' }, answer)
    return HttpResponse.json({ command: args.join(' '), elapsedMs: 3, ok: answer.exitCode === 0, account: null, connection: null, ...answer } satisfies CommandResult)
  }),
)

let n = 0
function show(element: ReactElement, role?: 'staff') {
  const id = `admin-${++n}`
  const person = role ? { login: 'sam', name: 'Sam Example', role, device: null } : undefined
  useConnections.setState({ loaded: true, connections: [{ id, name: 'Fund', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0, ...(person ? { person } : {}) }], activeId: id, keys: { [id]: 'k'.repeat(40) } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{element}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  people = createPeople()
  clients = createClients(people.roleOf)
  audit = createAudit()
  sent = []
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})
afterAll(() => server.close())

const passwordSent = (sub: string) => sent.find((args) => args[0] === 'people' && args[1] === sub)?.find((a) => a.startsWith('--password='))?.slice(11)

describe('People', () => {
  it('lists everyone with their role and how far their sign-in got', async () => {
    show(<People />)

    expect(await screen.findAllByText('Carol Example')).not.toHaveLength(0)
    expect(screen.getAllByRole('combobox', { name: 'Role of carol' })[0]).toHaveValue('client')
    expect(screen.getAllByText('Has a temporary password').length).toBeGreaterThan(0)
  })

  it('adds a person with a temporary password the app makes, and shows it once to hand over', async () => {
    const user = userEvent.setup()
    show(<People />)

    await user.type(await screen.findByLabelText('Login'), 'dana')
    await user.type(screen.getByLabelText('Name'), 'Dana Example')
    await user.click(screen.getByRole('button', { name: 'Add person' }))

    const password = passwordSent('add')!
    expect(password).toMatch(/^[a-zA-Z2-9]{14}$/)
    expect(await screen.findByText(/^Added dana \(Dana Example\), client\./)).toBeInTheDocument()
    expect(screen.getByText(password)).toBeInTheDocument()
    expect(await screen.findAllByText('Dana Example')).not.toHaveLength(0)
  })

  it('shows the bot’s reason when a login is taken', async () => {
    const user = userEvent.setup()
    show(<People />)

    await user.type(await screen.findByLabelText('Login'), 'carol')
    await user.type(screen.getByLabelText('Name'), 'Someone Else')
    await user.click(screen.getByRole('button', { name: 'Add person' }))

    expect(await screen.findByText("The login 'carol' is taken; choose another.")).toBeInTheDocument()
  })

  it('changes a role, disables and enables, and resets a password, each at once and logged', async () => {
    const user = userEvent.setup()
    show(<People />)

    await user.selectOptions((await screen.findAllByRole('combobox', { name: 'Role of sam' }))[0]!, 'owner')
    expect(await screen.findByText('sam is now owner.')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Disable carol' })[0]!)
    expect(await screen.findByText('carol cannot sign in, and is signed out everywhere.')).toBeInTheDocument()
    expect((await screen.findAllByRole('button', { name: 'Enable carol' })).length).toBeGreaterThan(0)

    await user.click(screen.getAllByRole('button', { name: 'Reset password of newbie' })[0]!)
    expect(await screen.findByText(passwordSent('reset-password')!)).toBeInTheDocument()

    expect(audit.run(['audit', '--json']).json).toHaveLength(3)
  })
})

describe('People, for the owner signed in', () => {
  it('keeps the owner from demoting or disabling themselves', async () => {
    const id = 'admin-olga'
    useConnections.setState({ loaded: true, connections: [{ id, name: 'Fund', url: BOT_URL, storage: 'session', sealed: null, addedAt: 0, person: { login: 'olga', name: 'Olga Example', role: 'owner', device: null } }], activeId: id, keys: { [id]: 'k'.repeat(40) } })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <People />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect((await screen.findAllByRole('combobox', { name: 'Role of olga' }))[0]).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Disable olga' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Disable sam' }).length).toBeGreaterThan(0)
  })
})

describe('Audit log', () => {
  it('lists the changes newest first, with passwords hidden, and filters by person', async () => {
    people.manage(['people', 'add', 'dana', '--name', 'Dana', '--role', 'client', '--password=secret-123'])
    audit.record(['people', 'add', 'dana', '--name', 'Dana', '--role', 'client', '--password=secret-123'], { kind: 'apiKey' }, { exitCode: 0, error: null })
    audit.record(['clients', 'link', '1', '--person', 'dana'], { kind: 'person', person: { login: 'sam', role: 'staff' } }, { exitCode: 2, error: { message: 'No.' }, refused: true })
    const user = userEvent.setup()
    show(<Audit />)

    expect(await screen.findAllByText('clients link 1 --person dana')).not.toHaveLength(0)
    expect(screen.getAllByText('people add dana --name Dana --role client --password=***').length).toBeGreaterThan(0)
    expect(screen.queryByText(/secret-123/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Refused').length).toBeGreaterThan(0)
    expect(screen.getAllByText('sam (staff)').length).toBeGreaterThan(0)

    await user.type(screen.getByLabelText('Only this person (login)'), 'sam')
    await user.click(screen.getByRole('button', { name: 'Show' }))
    await waitFor(() => expect(screen.queryAllByText(/people add dana/)).toHaveLength(0))
    expect(sent.at(-1)).toEqual(['audit', '--last', '50', '--person', 'sam', '--json'])
  })

  it('says when nothing is logged yet', async () => {
    show(<Audit />)

    expect(await screen.findByText('Nothing logged yet')).toBeInTheDocument()
  })
})

describe('Managed accounts', () => {
  it('lists each managed account, whether it is open and whose client it is', async () => {
    show(<Managed />)

    expect(await screen.findAllByText('demo')).not.toHaveLength(0)
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0)
    expect(await screen.findAllByText('Carol Example')).not.toHaveLength(0)
  })

  it('lets the owner let go of an account and manage it again with its password', async () => {
    const user = userEvent.setup()
    show(<Managed />)

    await user.click((await screen.findAllByRole('button', { name: 'Let go of demo' }))[0]!)
    expect(await screen.findByText('No managed account yet')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Trading account login'), 'demo')
    await user.type(screen.getByLabelText('Its password'), 'wrong-one')
    await user.click(screen.getByRole('button', { name: 'Manage account' }))
    expect(await screen.findByText('Invalid login or password.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Its password'))
    await user.type(screen.getByLabelText('Its password'), 'demo-password')
    await user.click(screen.getByRole('button', { name: 'Manage account' }))
    expect(await screen.findByText(/^demo \(CTrader Demo\) is managed/)).toBeInTheDocument()
    expect(await screen.findAllByRole('button', { name: 'Let go of demo' })).not.toHaveLength(0)
  })

  it('shows staff the accounts without the owner’s controls', async () => {
    show(<Managed />, 'staff')

    expect(await screen.findAllByText('demo')).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Let go of demo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Manage an account' })).not.toBeInTheDocument()
  })
})

describe('words and passwords', () => {
  const person = (patch: Partial<Person>): Person => ({ login: 'x', name: 'X', email: null, role: 'client', mustChangePassword: false, codeSet: true, disabled: false, createdAt: '', sessions: 0, ...patch })

  it.each([
    [person({ disabled: true, sessions: 2 }), 'Disabled'],
    [person({ mustChangePassword: true }), 'Has a temporary password'],
    [person({ codeSet: false }), 'Adds their code app at the next sign-in'],
    [person({ sessions: 1 }), 'Signed in on 1 device'],
    [person({ sessions: 3 }), 'Signed in on 3 devices'],
    [person({}), 'Signed out'],
  ])('%#: %s', (given, words) => {
    expect(signInWords(given)).toBe(words)
  })

  it('makes temporary passwords of 14 unambiguous characters, each different', () => {
    const made = new Set(Array.from({ length: 50 }, () => temporaryPassword()))
    expect(made.size).toBe(50)
    for (const password of made) expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{14}$/)
  })
})
