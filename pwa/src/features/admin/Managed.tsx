import { useId, useState, type FormEvent } from 'react'
import { useAction, useBot } from '../../api/bot.ts'
import { Section } from '../../components/ui.tsx'
import { Badge, Banner, Button, Card, DataTable, EmptyState, PageHeader, type Column } from '../../shared/ui/index.ts'
import { useClients, useManaged, type ManagedAccount } from '../clients/clients.ts'
import { ClientRead } from '../portfolio/ClientRead.tsx'

/**
 * The managed accounts (ADR 0003): trading accounts the trading process keeps open for good and reopens after every
 * restart, so the fund's people reach them without the account's password. The owner manages and lets go; staff see them.
 */
export default function Managed() {
  const id = useId()
  const run = useAction()
  const { connection } = useBot()
  const owner = (connection?.person?.role ?? 'owner') === 'owner'
  const managed = useManaged()
  const clients = useClients()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const ownerOf = (account: string) => (clients.data?.parsed.ok ? clients.data.parsed.value.find((c) => c.accounts.includes(account))?.name : undefined)

  async function act(key: string, args: string[]) {
    setBusy(key)
    setOutcome(null)
    try {
      const result = await run(args, { invalidate: ['managed', 'clients', 'overview'] })
      setOutcome({ tone: 'ok', text: result.output.trim().split('\n')[0] ?? 'Done.' })
      return true
    } catch (failure) {
      setOutcome({ tone: 'error', text: failure instanceof Error ? failure.message : String(failure) })
      return false
    } finally {
      setBusy(null)
    }
  }

  async function manage(event: FormEvent) {
    event.preventDefault()
    if (!login.trim() || !password) return setOutcome({ tone: 'error', text: 'Give the account’s login and its password.' })
    if (await act('manage', ['fund', 'manage', login.trim(), `--password=${password}`])) {
      setLogin('')
      setPassword('')
    }
  }

  const columns: Column<ManagedAccount>[] = [
    { key: 'login', header: 'Account', card: 'title', render: (a) => <strong>{a.login}</strong> },
    { key: 'broker', header: 'Broker', render: (a) => [a.broker, a.mode].filter(Boolean).join(' ') || '–' },
    { key: 'open', header: 'Open', render: (a) => (a.open ? <Badge tone="ok">Open</Badge> : <Badge tone="error">Not open</Badge>) },
    { key: 'sessions', header: 'Sessions', align: 'right', render: (a) => String(a.sessions) },
    { key: 'client', header: 'Client', render: (a) => ownerOf(a.login) ?? 'None yet' },
    { key: 'since', header: 'Managed since (UTC)', render: (a) => a.managedAt.slice(0, 16).replace('T', ' ') },
  ]

  return (
    <Section>
      <div className="k-demo">
        <PageHeader title="Managed accounts" meta="The trading process keeps these open for good and reopens them after every restart, so staff and clients reach them without the account’s password." />
        {outcome ? <Banner tone={outcome.tone === 'ok' ? 'ok' : 'error'} title={outcome.text} /> : null}
        <ClientRead query={managed} what="managed accounts">
          {(accounts) =>
            accounts.length ? (
              <DataTable
                surface="paper"
                columns={columns}
                rows={accounts}
                rowKey={(a) => a.login}
                caption="Managed accounts"
                actions={
                  owner
                    ? (a) => (
                        <Button variant="quiet" busy={busy === `unmanage:${a.login}`} disabled={busy !== null} onClick={() => void act(`unmanage:${a.login}`, ['fund', 'unmanage', a.login])} aria-label={`Let go of ${a.login}`}>
                          Let go
                        </Button>
                      )
                    : undefined
                }
              />
            ) : (
              <Card>
                <EmptyState title="No managed account yet">{owner ? 'Manage one below with its login and password.' : 'The owner manages accounts.'}</EmptyState>
              </Card>
            )
          }
        </ClientRead>
        {owner ? (
          <Card title="Manage an account">
            <form className="k-form" onSubmit={manage} noValidate>
              <div className="k-row">
                <div className="k-field k-grow">
                  <label htmlFor={`${id}-login`}>Trading account login</label>
                  <input id={`${id}-login`} className="k-input" value={login} autoCapitalize="none" spellCheck={false} onChange={(event) => setLogin(event.target.value)} />
                </div>
                <div className="k-field k-grow">
                  <label htmlFor={`${id}-password`}>Its password</label>
                  <input id={`${id}-password`} className="k-input" type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} />
                </div>
              </div>
              <div className="k-row">
                <Button type="submit" variant="primary" busy={busy === 'manage'}>
                  Manage account
                </Button>
              </div>
              <p className="k-hint">The password is used once, to open it; the bot keeps the account open with its recovery key. Let go stops keeping it open: it closes once nothing trades or holds it, and its strategies keep trading until stopped.</p>
            </form>
          </Card>
        ) : null}
      </div>
    </Section>
  )
}
