import { Fragment, useState } from 'react'
import { useNavigate } from 'react-router'
import { explain, runCommand } from '../api/client.ts'
import { useBot } from '../api/bot.ts'
import { Section } from '../components/ui.tsx'
import { Banner, Button, Card, PageHeader } from '../shared/ui/index.ts'
import { useConnections } from '../state/connections.ts'
import { usePortfolio } from '../features/portfolio/portfolio.ts'

/** A client's accounts at the broker, and where their money goes in and out. */
function AtTheBroker() {
  const portfolio = usePortfolio()
  const accounts = portfolio.data?.parsed.ok ? portfolio.data.parsed.value : null
  return (
    <Card title={accounts && accounts.length > 1 ? 'Your accounts at the broker' : 'Your account at the broker'}>
      {accounts === null ? (
        <p className="k-hint">{portfolio.error ? 'Your accounts could not be loaded just now.' : 'Loading…'}</p>
      ) : accounts.length ? (
        <dl className="k-facts">
          {accounts.map((account) => (
            <Fragment key={account.login}>
              <dt>Account</dt>
              <dd>
                {account.login}
                {account.currency ? `, in ${account.currency}` : ''}
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p>No account is linked to you yet. The fund links it for you.</p>
      )}
      <p className="k-hint">Deposits and withdrawals happen at the broker. They show in your activity within the hour. To change your password or your code app, ask the fund.</p>
    </Card>
  )
}

const ROLE: Record<string, string> = { owner: 'The fund’s owner', staff: 'Staff of the fund', client: 'Client of the fund' }

/**
 * A person's own sign-in: who they are signed in as, where, and signing out of this device or of every one. Signing out
 * forgets everything this device kept for that sign-in. For a client, this is their Account place: their account at the
 * broker, and their sign-in.
 */
export default function Me() {
  const navigate = useNavigate()
  const { connection, key } = useBot()
  const remove = useConnections((state) => state.remove)
  const [busy, setBusy] = useState<'one' | 'all' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const person = connection?.person

  if (!connection || !person)
    return (
      <Section>
        <PageHeader title="Your sign-in" />
        <Card>
          <p>This device is connected with the API key, which acts as the fund’s owner. People sign in with their own login instead.</p>
        </Card>
      </Section>
    )

  async function signOut(everywhere: boolean) {
    setBusy(everywhere ? 'all' : 'one')
    setError(null)
    try {
      const outcome = key ? await runCommand({ url: connection!.url, key, person: true }, everywhere ? ['signout', '--all'] : ['signout']) : null
      // A sign-in the bot no longer knows (401) is signed out already; anything else that failed is said, and nothing is forgotten.
      if (outcome && outcome.kind !== 'ok' && outcome.kind !== 'unauthorized') return setError(explain(outcome).message)
      await remove(connection!.id)
      navigate(`/signin?login=${encodeURIComponent(person!.login)}`, { replace: true })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section>
      <div className="k-demo" style={{ maxWidth: 720 }}>
        <PageHeader title={person.role === 'client' ? 'Your account' : 'Your sign-in'} meta={ROLE[person.role]} />
        {error ? <Banner tone="error" title={error} /> : null}
        {person.role === 'client' ? <AtTheBroker /> : null}
        <Card title="Signed in as">
          <dl className="k-facts">
            <dt>Name</dt>
            <dd>{person.name}</dd>
            <dt>Login</dt>
            <dd>{person.login}</dd>
            <dt>Server</dt>
            <dd>{connection.url}</dd>
            <dt>This device</dt>
            <dd>{person.device ?? 'This browser'}{connection.storage === 'device' ? ', remembered' : ', for this visit only'}</dd>
          </dl>
        </Card>
        <Card title="Signing out">
          <p className="k-hint">Signing out forgets what this device kept for your sign-in. Signing out everywhere also ends it on your other devices, for example a lost phone.</p>
          <div className="k-row">
            <Button variant="primary" busy={busy === 'one'} disabled={busy !== null} onClick={() => void signOut(false)}>
              Sign out
            </Button>
            <Button variant="danger" busy={busy === 'all'} disabled={busy !== null} onClick={() => void signOut(true)}>
              Sign out everywhere
            </Button>
          </div>
        </Card>
      </div>
    </Section>
  )
}
