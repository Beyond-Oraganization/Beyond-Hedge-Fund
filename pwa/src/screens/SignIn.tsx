import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Section } from '../components/ui.tsx'
import { explain, runCommand } from '../api/client.ts'
import { Banner, Button, Card, ConfirmWithCode, PageHeader } from '../shared/ui/index.ts'
import { useConnections, type PersonRole } from '../state/connections.ts'

/** The step a sign-in is at: the bot's answer to the last try (Fund/PersonSignIn in Beyond-Bot-Bybit). */
type Step = { kind: 'password' } | { kind: 'newPassword' } | { kind: 'code'; setup: { secret: string; link: string } | null }

type SignInJson = {
  status: 'newPasswordRequired' | 'codeSetup' | 'codeRequired' | 'signedIn'
  secret?: string
  link?: string
  token?: string
  person?: { login: string; name: string; role: PersonRole; device: string | null; trusted?: boolean }
}

/** The fund's server, as the build names it; otherwise the one this device signed in to last. */
function defaultServer(): string {
  const built = import.meta.env.VITE_FUND_API as string | undefined
  if (built) return built
  return useConnections.getState().connections.findLast((connection) => connection.person)?.url ?? ''
}

/** What this device is, for the person's list of signed-in devices: "Chrome on macOS". */
function deviceName(): string {
  const agent = navigator.userAgent
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'A browser'
  const system = /iPhone|iPad/.test(agent) ? 'iOS' : /Android/.test(agent) ? 'Android' : /Mac OS X/.test(agent) ? 'macOS' : /Windows/.test(agent) ? 'Windows' : /Linux/.test(agent) ? 'Linux' : 'a device'
  return `${browser} on ${system}`
}

/**
 * Signing in to the fund: login and password, then the 6-digit code of the person's code app. A first sign-in replaces the
 * temporary password and adds the code app on the way. The token the bot answers with is kept like a key: with this device's
 * key (remember me), or for this visit only. The API key, for the owner's own use, is under Advanced.
 */
export default function SignIn() {
  // A new login in the address (signing out sends it) starts the form afresh, with that login in it.
  const [params] = useSearchParams()
  const login = params.get('login') ?? ''
  return <SignInForm key={login} givenLogin={login} />
}

function SignInForm({ givenLogin }: { givenLogin: string }) {
  const id = useId()
  const navigate = useNavigate()
  const addPerson = useConnections((state) => state.addPerson)
  const [server, setServer] = useState(defaultServer)
  const [login, setLogin] = useState(givenLogin)
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [again, setAgain] = useState('')
  const [remember, setRemember] = useState(true)
  const [step, setStep] = useState<Step>({ kind: 'password' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(extra: string[]) {
    setBusy(true)
    setError(null)
    try {
      const args = ['signin', login.trim(), `--password=${password}`, ...extra, '--json']
      const outcome = await runCommand({ url: server.trim(), key: '' }, args)
      if (outcome.kind !== 'ok') return setError(explain(outcome).message)
      const answer = outcome.result.json as SignInJson | null
      if (!answer) return setError('The server answered without saying how the sign-in went. Is it the fund’s bot, of a version with people?')
      // A replaced password is the password from now on.
      if (extra.some((arg) => arg.startsWith('--new-password='))) setPassword(newPassword)
      switch (answer.status) {
        case 'newPasswordRequired':
          return setStep({ kind: 'newPassword' })
        case 'codeSetup':
          return setStep({ kind: 'code', setup: { secret: answer.secret ?? '', link: answer.link ?? '' } })
        case 'codeRequired':
          return setStep({ kind: 'code', setup: null })
        case 'signedIn': {
          const person = answer.person!
          await addPerson({ url: server.trim(), token: answer.token!, person: { login: person.login, name: person.name, role: person.role, device: person.device, trusted: person.trusted === true }, remember })
          navigate(person.role === 'client' ? '/home' : '/overview', { replace: true })
        }
      }
    } finally {
      setBusy(false)
    }
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault()
    if (!server.trim() || !login.trim() || !password) return setError('Fill in the server, your login and your password.')
    void send([])
  }

  function submitNewPassword(event: FormEvent) {
    event.preventDefault()
    if (newPassword.length < 8) return setError('A password has at least 8 characters.')
    if (newPassword !== again) return setError('The two passwords differ.')
    void send([`--new-password=${newPassword}`])
  }

  return (
    <Section>
      <div className="k-demo" style={{ maxWidth: 560 }}>
        <PageHeader title="Sign in" meta={step.kind === 'password' ? 'To Beyond Hedge Fund, with your login, your password and your code app.' : `As ${login.trim()}.`} />
        {error ? <Banner tone="error" title={error} /> : null}

        {step.kind === 'password' ? (
          <Card>
            <form className="k-form" onSubmit={submitPassword} noValidate>
              <div className="k-field">
                <label htmlFor={`${id}-server`}>Server</label>
                <input id={`${id}-server`} className="k-input" type="url" inputMode="url" autoComplete="url" spellCheck={false} value={server}
                  onChange={(event) => setServer(event.target.value)} placeholder="https://fund.example.com" />
                <span className="k-hint">{import.meta.env.VITE_FUND_API ? 'Filled in for you: the fund’s server.' : 'The fund gives you this address.'}</span>
              </div>
              <div className="k-field">
                <label htmlFor={`${id}-login`}>Login</label>
                <input id={`${id}-login`} className="k-input" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={login}
                  onChange={(event) => setLogin(event.target.value)} />
              </div>
              <div className="k-field">
                <label htmlFor={`${id}-password`}>Password</label>
                <input id={`${id}-password`} className="k-input" type="password" autoComplete="current-password" value={password}
                  onChange={(event) => setPassword(event.target.value)} />
              </div>
              <label className="k-check">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Remember me on this device
              </label>
              <Button type="submit" variant="primary" size="large" busy={busy}>
                Continue
              </Button>
            </form>
          </Card>
        ) : null}

        {step.kind === 'newPassword' ? (
          <Card title="Choose your own password">
            <p className="k-hint">The password you were given is for the first sign-in only.</p>
            <form className="k-form" onSubmit={submitNewPassword} noValidate>
              <div className="k-field">
                <label htmlFor={`${id}-new`}>New password</label>
                <input id={`${id}-new`} className="k-input" type="password" autoComplete="new-password" value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)} />
                <span className="k-hint">At least 8 characters.</span>
              </div>
              <div className="k-field">
                <label htmlFor={`${id}-again`}>New password again</label>
                <input id={`${id}-again`} className="k-input" type="password" autoComplete="new-password" value={again}
                  onChange={(event) => setAgain(event.target.value)} />
              </div>
              <Button type="submit" variant="primary" size="large" busy={busy}>
                Continue
              </Button>
            </form>
          </Card>
        ) : null}

        {step.kind === 'code' ? (
          <Card title={step.setup ? 'Add the fund to your code app' : 'Your 6-digit code'}>
            <ConfirmWithCode confirmLabel="Sign in" busy={busy} onConfirm={(code) => void send([`--code=${code}`, '--device', deviceName()])}>
              {step.setup ? (
                <div className="k-demo" style={{ gap: 12 }}>
                  <p>
                    A code app (Google Authenticator, 1Password, Authy and others) makes the code you are asked for at every sign-in. On this
                    phone, open the link; on a computer, type the secret into the app on your phone.
                  </p>
                  <p>
                    <a className="k-btn k-btn-secondary" href={step.setup.link}>
                      Open in your code app
                    </a>
                  </p>
                  <p className="k-label">Secret</p>
                  <p className="k-secret">{step.setup.secret}</p>
                  <p>Then type the code it shows:</p>
                </div>
              ) : (
                <p>Open your code app and type the code it shows for Beyond Hedge Fund.</p>
              )}
            </ConfirmWithCode>
          </Card>
        ) : null}

        <details className="foot">
          <summary>Advanced</summary>
          <p>
            The fund’s owner can also <Link to="/connect">Connect with an API key</Link>.
          </p>
        </details>
      </div>
    </Section>
  )
}
