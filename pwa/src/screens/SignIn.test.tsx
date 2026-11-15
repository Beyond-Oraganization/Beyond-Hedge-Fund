import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPeople, type MockPeople } from '../../mock-bot/people.mjs'
import { queryClient } from '../api/bot.ts'
import { useConnections } from '../state/connections.ts'
import SignIn from './SignIn.tsx'

/** The fund's sign-in screen against the mock bot's people (mock-bot/people.mjs), over MSW. */
const SERVER = 'https://fund.test:8443'
let people: MockPeople

const server = setupServer(
  http.post(`${SERVER}/`, async ({ request }) => {
    if (request.headers.get('authorization')) return new HttpResponse(null, { status: 401 })
    const { args } = (await request.json()) as { args: string[] }
    if (args[0] !== 'signin') return new HttpResponse(null, { status: 401 })
    const result = people.signin(args)
    return HttpResponse.json({ command: args.join(' '), elapsedMs: 3, ok: result.exitCode === 0, account: null, connection: null, ...result })
  }),
)

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  people = createPeople()
  useConnections.setState({ loaded: true, connections: [], activeId: null, keys: {}, tokens: {} })
})
afterEach(() => {
  cleanup()
  server.resetHandlers()
})
afterAll(() => server.close())

function show() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/signin']}>
        <Routes>
          <Route path="/signin" element={<SignIn />} />
          <Route path="/" element={<p>Home screen</p>} />
          <Route path="/home" element={<p>Client home screen</p>} />
          <Route path="/connect" element={<p>Connect with a key</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function startAs(login: string, password: string) {
  const user = userEvent.setup()
  show()
  await user.type(screen.getByLabelText('Server'), SERVER)
  await user.type(screen.getByLabelText('Login'), login)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  return user
}

const active = () => {
  const state = useConnections.getState()
  const connection = state.connections.find((c) => c.id === state.activeId)!
  return { connection, token: state.keys[connection.id] }
}

describe('SignIn', () => {
  it('signs in with the password, then the code, and keeps the sign-in on this device', async () => {
    const user = await startAs('sam', 'demo-password')

    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Home screen')).toBeInTheDocument()
    const { connection, token } = active()
    expect(connection.person).toMatchObject({ login: 'sam', name: 'Sam Example', role: 'staff' })
    expect(connection.url).toBe(SERVER)
    expect(connection.storage).toBe('device')
    expect(token).toMatch(/^bbp_/)
  })

  it('takes a first sign-in through a password of their own and the code app', async () => {
    const user = await startAs('newbie', 'temporary-1')

    await user.type(await screen.findByLabelText('New password'), 'my-own-password')
    await user.type(screen.getByLabelText('New password again'), 'my-own-passwore')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('The two passwords differ.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('New password again'))
    await user.type(screen.getByLabelText('New password again'), 'my-own-password')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByText('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in your code app' })).toHaveAttribute('href', expect.stringMatching(/^otpauth:\/\/totp\//))
    await user.type(screen.getByLabelText('6-digit code'), '654321')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Home screen')).toBeInTheDocument()
    expect(active().connection.person?.login).toBe('newbie')
  })

  it('says a wrong password is wrong, and stays on the password', async () => {
    await startAs('sam', 'not-the-password')

    expect(await screen.findByText('Invalid login or password.')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(useConnections.getState().connections).toEqual([])
  })

  it('says a wrong code is wrong, and lets them try again', async () => {
    const user = await startAs('sam', 'demo-password')

    await user.type(await screen.findByLabelText('6-digit code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Invalid code.')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('6-digit code'))
    await user.type(screen.getByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Home screen')).toBeInTheDocument()
  })

  it('without Remember me, keeps the sign-in for this visit only', async () => {
    const user = userEvent.setup()
    show()
    await user.type(screen.getByLabelText('Server'), SERVER)
    await user.type(screen.getByLabelText('Login'), 'carol')
    await user.type(screen.getByLabelText('Password'), 'demo-password')
    await user.click(screen.getByLabelText('Remember me on this device'))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Client home screen')).toBeInTheDocument()   // a client starts at their Home
    expect(active().connection.storage).toBe('session')
    expect(active().connection.sealed).toBeNull()
  })

  it('keeps the API key under Advanced, for the owner', () => {
    show()
    expect(screen.getByRole('link', { name: 'Connect with an API key' })).toHaveAttribute('href', '/connect')
  })
})
