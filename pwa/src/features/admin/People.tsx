import { useId, useState, type FormEvent } from 'react'
import { useAction, useBot } from '../../api/bot.ts'
import { Section } from '../../components/ui.tsx'
import { Badge, Banner, Button, Card, DataTable, EmptyState, PageHeader, type Column } from '../../shared/ui/index.ts'
import { ClientRead } from '../portfolio/ClientRead.tsx'
import { signInWords, temporaryPassword, usePeople, type Person } from './admin.ts'

type Outcome = { tone: 'ok' | 'error'; text: string; password?: { login: string; value: string } }

/** Runs one change to people and says how it went; a temporary password is shown once, to hand over. */
function useChange() {
  const run = useAction()
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  async function change(key: string, args: string[], password?: { login: string; value: string }) {
    setBusy(key)
    setOutcome(null)
    try {
      const result = await run(args, { invalidate: ['people', 'audit'] })
      setOutcome({ tone: 'ok', text: result.output.trim().split('\n')[0] ?? 'Done.', password })
      return true
    } catch (failure) {
      setOutcome({ tone: 'error', text: failure instanceof Error ? failure.message : String(failure) })
      return false
    } finally {
      setBusy(null)
    }
  }
  return { change, busy, outcome }
}

function TemporaryPassword({ login, value }: { login: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="k-demo">
      <p>
        Give <strong>{login}</strong> this temporary password, by a different way than their login (in person, or a message). It is shown only now.
      </p>
      <p className="k-secret">{value}</p>
      <div className="k-row">
        <Button variant="secondary" icon="copy" onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true))}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}

function AddPerson({ change, busy }: { change: ReturnType<typeof useChange>['change']; busy: string | null }) {
  const id = useId()
  const [login, setLogin] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Person['role']>('client')
  const [error, setError] = useState<string | null>(null)

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!login.trim() || !name.trim()) return setError('Give a login and a name.')
    setError(null)
    const password = temporaryPassword()
    const args = ['people', 'add', login.trim(), '--name', name.trim(), '--role', role, ...(email.trim() ? ['--email', email.trim()] : []), `--password=${password}`]
    if (await change('add', args, { login: login.trim().toLowerCase(), value: password })) {
      setLogin('')
      setName('')
      setEmail('')
    }
  }

  return (
    <Card title="Add a person">
      <form className="k-form" onSubmit={add} noValidate>
        <div className="k-row">
          <div className="k-field k-grow">
            <label htmlFor={`${id}-login`}>Login</label>
            <input id={`${id}-login`} className="k-input" value={login} autoCapitalize="none" spellCheck={false} onChange={(event) => setLogin(event.target.value)} />
          </div>
          <div className="k-field k-grow">
            <label htmlFor={`${id}-name`}>Name</label>
            <input id={`${id}-name`} className="k-input" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
        </div>
        <div className="k-row">
          <div className="k-field k-grow">
            <label htmlFor={`${id}-email`}>E-mail (optional)</label>
            <input id={`${id}-email`} className="k-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="k-field k-grow">
            <label htmlFor={`${id}-role`}>Role</label>
            <select id={`${id}-role`} className="k-input" value={role} onChange={(event) => setRole(event.target.value as Person['role'])}>
              <option value="client">Client: sees their own accounts</option>
              <option value="staff">Staff: every client, trading and research</option>
              <option value="owner">Owner: everything</option>
            </select>
          </div>
        </div>
        {error ? <p className="k-field-error">{error}</p> : null}
        <div className="k-row">
          <Button type="submit" variant="primary" busy={busy === 'add'}>
            Add person
          </Button>
        </div>
        <p className="k-hint">The app makes a temporary password. At their first sign-in they choose their own and add a code app. A client still needs linking to their client, on the Clients page.</p>
      </form>
    </Card>
  )
}

/**
 * The people who sign in (docs/fund-app-redesign-plan.md, section 6: the owner's): their role, how far their sign-in got,
 * and the owner's controls. Every change here is reversible, so none asks first; each goes in the audit log.
 */
export default function People() {
  const people = usePeople()
  // The signed-in owner's own row: no demoting or disabling yourself from here (the API key and the terminal still can).
  const me = useBot().connection?.person?.login ?? null
  const { change, busy, outcome } = useChange()

  const columns: Column<Person>[] = [
    { key: 'name', header: 'Person', card: 'title', render: (p) => <span><strong>{p.name}</strong> <span className="k-feed-account">{p.login}{p.login === me ? ' (you)' : ''}</span></span> },
    {
      key: 'role',
      header: 'Role',
      render: (p) => (
        <select className="k-input k-input-small" aria-label={`Role of ${p.login}`} value={p.role} disabled={busy !== null || p.login === me} onChange={(event) => void change(`role:${p.login}`, ['people', 'role', p.login, event.target.value])}>
          <option value="client">Client</option>
          <option value="staff">Staff</option>
          <option value="owner">Owner</option>
        </select>
      ),
    },
    { key: 'signin', header: 'Sign-in', wrap: true, render: (p) => (p.disabled ? <Badge tone="warn">Disabled</Badge> : signInWords(p)) },
  ]

  const actions = (p: Person) => (
    <div className="k-row">
      {p.login === me ? null : p.disabled ? (
        <Button variant="quiet" busy={busy === `enable:${p.login}`} disabled={busy !== null} onClick={() => void change(`enable:${p.login}`, ['people', 'enable', p.login])} aria-label={`Enable ${p.login}`}>
          Enable
        </Button>
      ) : (
        <Button variant="quiet" busy={busy === `disable:${p.login}`} disabled={busy !== null} onClick={() => void change(`disable:${p.login}`, ['people', 'disable', p.login])} aria-label={`Disable ${p.login}`}>
          Disable
        </Button>
      )}
      <Button variant="quiet" busy={busy === `code:${p.login}`} disabled={busy !== null} onClick={() => void change(`code:${p.login}`, ['people', 'reset-code', p.login])} aria-label={`Reset code of ${p.login}`}>
        Reset code
      </Button>
      <Button
        variant="quiet"
        busy={busy === `password:${p.login}`}
        disabled={busy !== null}
        aria-label={`Reset password of ${p.login}`}
        onClick={() => {
          const password = temporaryPassword()
          void change(`password:${p.login}`, ['people', 'reset-password', p.login, `--password=${password}`], { login: p.login, value: password })
        }}
      >
        Reset password
      </Button>
    </div>
  )

  return (
    <Section>
      <div className="k-demo">
        <PageHeader title="People" meta="Everyone who signs in to the app, their role, and how far their sign-in got. Only the owner sees this page." />
        {outcome ? (
          <Banner tone={outcome.tone === 'ok' ? 'ok' : 'error'} title={outcome.text}>
            {outcome.password ? <TemporaryPassword {...outcome.password} /> : null}
          </Banner>
        ) : null}
        <ClientRead query={people} what="people">
          {(all) =>
            all.length ? (
              <DataTable surface="paper" columns={columns} rows={all} rowKey={(p) => p.login} caption="People who sign in" actions={actions} />
            ) : (
              <Card>
                <EmptyState title="Nobody yet">Add the first person below.</EmptyState>
              </Card>
            )
          }
        </ClientRead>
        <AddPerson change={change} busy={busy} />
        <p className="k-hint">Disable stops someone signing in and signs them out everywhere (a lost phone, someone who left). Reset code makes them add their code app again at the next sign-in. Reset password gives them a new temporary one.</p>
      </div>
    </Section>
  )
}
