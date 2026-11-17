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

/** Changes what the app calls a person: their name and e-mail (an emptied e-mail is removed). */
function EditPerson({ person, change, busy, onClose }: { person: Person; change: ReturnType<typeof useChange>['change']; busy: string | null; onClose: () => void }) {
  const id = useId()
  const [name, setName] = useState(person.name)
  const [email, setEmail] = useState(person.email ?? '')

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    const args = ['people', 'change', person.login, '--name', name.trim(), ...(email.trim() ? ['--email', email.trim()] : ['--no-email'])]
    if (await change(`edit:${person.login}`, args)) onClose()
  }

  return (
    <Card title={`Edit ${person.login}`}>
      <form className="k-form" onSubmit={save}>
        <div className="k-field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} className="k-input" value={name} maxLength={100} required onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="k-field">
          <label htmlFor={`${id}-email`}>E-mail (optional)</label>
          <input id={`${id}-email`} className="k-input" type="email" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="k-row">
          <Button type="submit" variant="primary" busy={busy === `edit:${person.login}`} disabled={!name.trim()}>
            Save
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
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
 * and the owner's controls. Every change here is reversible, so none asks first, except Delete, which asks in place; each
 * goes in the audit log.
 */
export default function People() {
  const people = usePeople()
  // The signed-in owner's own row: no demoting or disabling yourself from here (the API key and the terminal still can).
  const me = useBot().connection?.person?.login ?? null
  const { change, busy, outcome } = useChange()
  const [editing, setEditing] = useState<Person | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

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
    {
      key: 'trusted',
      header: 'Strategies',
      wrap: true,
      // The owner's trust in a client: they get the strategy pack, backtest, and see how a strategy trades. Reversible, and in
      // force from their next request, so it applies at once without asking.
      render: (p) =>
        p.role === 'client' ? (
          <label className="check small">
            <input type="checkbox" checked={p.trusted} disabled={busy !== null} aria-label={`Trust ${p.login} with the strategies`} onChange={(event) => void change(`trust:${p.login}`, ['people', 'trust', p.login, event.target.checked ? 'on' : 'off'])} />
            {p.trusted ? 'Trusted' : 'By name only'}
          </label>
        ) : (
          <span className="k-hint">By role</span>
        ),
    },
    { key: 'signin', header: 'Sign-in', wrap: true, render: (p) => (p.disabled ? <Badge tone="warn">Disabled</Badge> : signInWords(p)) },
  ]

  const actions = (p: Person) =>
    deleting === p.login ? (
      <div className="k-row" role="group" aria-label={`Delete ${p.login}?`}>
        <span className="k-hint">For good: signed out, unlinked from their client; the audit log keeps what they did.</span>
        <Button variant="danger" busy={busy === `delete:${p.login}`} disabled={busy !== null} onClick={() => void change(`delete:${p.login}`, ['people', 'delete', p.login, '--yes']).then(() => setDeleting(null))}>
          Delete for good
        </Button>
        <Button variant="quiet" onClick={() => setDeleting(null)}>
          Keep
        </Button>
      </div>
    ) : (
    <div className="k-row">
      <Button variant="quiet" disabled={busy !== null} onClick={() => setEditing(p)} aria-label={`Edit ${p.login}`}>
        Edit
      </Button>
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
      {p.login === me ? null : (
        <Button variant="quiet" disabled={busy !== null} onClick={() => setDeleting(p.login)} aria-label={`Delete ${p.login}`}>
          Delete
        </Button>
      )}
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
        {editing ? <EditPerson key={editing.login} person={editing} change={change} busy={busy} onClose={() => setEditing(null)} /> : null}
        <AddPerson change={change} busy={busy} />
        <p className="k-hint">Disable stops someone signing in and signs them out everywhere (a lost phone, someone who left); Enable undoes it. Delete removes them for good. Reset code makes them add their code app again at the next sign-in. Reset password gives them a new temporary one. A trusted client gets the strategies’ code, backtests, and sees how a strategy trades; any other client chooses setups by name.</p>
      </div>
    </Section>
  )
}
