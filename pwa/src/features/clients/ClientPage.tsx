import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { useAction } from '../../api/bot.ts'
import { Section } from '../../components/ui.tsx'
import { Badge, Banner, Button, ButtonLink, Card, EmptyState, PageHeader } from '../../shared/ui/index.ts'
import { AccountValue } from '../portfolio/Home.tsx'
import { ClientRead } from '../portfolio/ClientRead.tsx'
import { usePortfolio } from '../portfolio/portfolio.ts'
import { LimitsCard } from '../menu/LimitsCard.tsx'
import { readiness, useClients, useManaged, type Client } from './clients.ts'

/** Runs one change to a client (link or unlink) and keeps the bot's refusal to show it in place. */
function useChange() {
  const run = useAction()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function change(key: string, args: string[]) {
    setBusy(key)
    setError(null)
    try {
      await run(args, { invalidate: ['clients', 'portfolio', 'managed'] })
      return true
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      return false
    } finally {
      setBusy(null)
    }
  }
  return { change, busy, error }
}

/** A list of linked things, each with Unlink (a link is undone by linking again, so it asks nothing). */
function Linked({ items, describe, onUnlink, busy, empty }: { items: string[]; describe?: (item: string) => ReactNode; onUnlink: (item: string) => void; busy: string | null; empty: string }) {
  if (!items.length) return <p className="k-hint">{empty}</p>
  return (
    <ul className="k-feed">
      {items.map((item) => (
        <li key={item} className="k-linked">
          <span className="k-feed-text">
            <strong>{item}</strong>
            {describe ? <span className="k-feed-account"> · {describe(item)}</span> : null}
          </span>
          <Button variant="quiet" busy={busy === `unlink:${item}`} disabled={busy !== null} onClick={() => onUnlink(item)} aria-label={`Unlink ${item}`}>
            Unlink
          </Button>
        </li>
      ))}
    </ul>
  )
}

function Accounts({ client }: { client: Client }) {
  const id = useId()
  const managed = useManaged()
  const clients = useClients()
  const { change, busy, error } = useChange()
  const [chosen, setChosen] = useState('')
  const all = managed.data?.parsed.ok ? managed.data.parsed.value : []
  const taken = new Set((clients.data?.parsed.ok ? clients.data.parsed.value : []).flatMap((c) => c.accounts))
  const free = all.filter((a) => !taken.has(a.login))
  const describe = (login: string) => {
    const account = all.find((a) => a.login === login)
    return account ? [account.broker, account.mode].filter(Boolean).join(' ') || 'managed' : 'managed'
  }

  async function link(event: FormEvent) {
    event.preventDefault()
    if (chosen && (await change('link', ['clients', 'link', String(client.id), '--account', chosen]))) setChosen('')
  }

  return (
    <Card title="Accounts">
      {error ? <Banner tone="error" title={error} /> : null}
      <Linked items={client.accounts} describe={describe} busy={busy} empty="No account linked yet." onUnlink={(login) => void change(`unlink:${login}`, ['clients', 'unlink', String(client.id), '--account', login])} />
      {free.length ? (
        <form className="k-row" onSubmit={link}>
          <div className="k-field k-grow">
            <label htmlFor={id}>Managed account</label>
            <select id={id} className="k-input" value={chosen} onChange={(event) => setChosen(event.target.value)}>
              <option value="">Choose one</option>
              {free.map((a) => (
                <option key={a.login} value={a.login}>
                  {a.login} ({describe(a.login)})
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" busy={busy === 'link'} disabled={!chosen || busy !== null}>
            Link account
          </Button>
        </form>
      ) : (
        <p className="k-hint">Every managed account belongs to a client already. The owner makes another account managed with <code>fund manage</code>.</p>
      )}
    </Card>
  )
}

function People({ client }: { client: Client }) {
  const id = useId()
  const { change, busy, error } = useChange()
  const [login, setLogin] = useState('')

  async function link(event: FormEvent) {
    event.preventDefault()
    if (login.trim() && (await change('link', ['clients', 'link', String(client.id), '--person', login.trim()]))) setLogin('')
  }

  return (
    <Card title="Who signs in">
      {error ? <Banner tone="error" title={error} /> : null}
      <Linked items={client.people} busy={busy} empty="Nobody signs in for this client yet." onUnlink={(person) => void change(`unlink:${person}`, ['clients', 'unlink', String(client.id), '--person', person])} />
      <form className="k-row" onSubmit={link}>
        <div className="k-field k-grow">
          <label htmlFor={id}>Login of a person with the client role</label>
          <input id={id} className="k-input" value={login} autoCapitalize="none" spellCheck={false} onChange={(event) => setLogin(event.target.value)} />
        </div>
        <Button type="submit" busy={busy === 'link'} disabled={!login.trim() || busy !== null}>
          Link person
        </Button>
      </form>
      <p className="k-hint">The owner adds people (<code>people add … --role client</code>); they sign in with a temporary password and their own code app.</p>
    </Card>
  )
}

/** What the client sees on their Home: each linked account's value and returns, and the way to see their whole Home. */
function WhatTheClientSees({ client }: { client: Client }) {
  const portfolio = usePortfolio()
  return (
    <Card title="What the client sees" actions={<ButtonLink to={`/clients/${client.id}/view`} variant="secondary">View as client</ButtonLink>}>
      <ClientRead query={portfolio} what="portfolio">
        {(all) => {
          const accounts = all.filter((a) => client.accounts.includes(a.login))
          return accounts.length ? (
            <div className="k-demo">
              {accounts.map((account) => (
                <AccountValue key={account.login} account={account} named={accounts.length > 1} />
              ))}
            </div>
          ) : (
            <p className="k-hint">No account linked: the client sees “No account is linked to you yet”.</p>
          )
        }}
      </ClientRead>
    </Card>
  )
}

/** One client (plan, section 7): what they see, their accounts, who signs in for them, and what they may start (limits). */
export default function ClientPage() {
  const { id } = useParams()
  const clients = useClients()
  const portfolio = usePortfolio()
  const portfolios = portfolio.data?.parsed.ok ? portfolio.data.parsed.value : []
  return (
    <Section>
      <div className="k-demo k-narrow">
        <ClientRead query={clients} what="clients">
          {(all) => {
            const client = all.find((c) => String(c.id) === id)
            if (!client)
              return (
                <>
                  <PageHeader title="Client not found" crumbs={[{ label: 'Clients', to: '/clients' }]} />
                  <Card>
                    <EmptyState title={`No client ${id ?? ''}`} action={<ButtonLink to="/clients">All clients</ButtonLink>} />
                  </Card>
                </>
              )
            const ready = readiness(client, portfolios)
            return (
              <>
                <PageHeader title={client.name} crumbs={[{ label: 'Clients', to: '/clients' }]} meta={<Badge tone={ready.tone}>{ready.words}</Badge>} />
                <WhatTheClientSees client={client} />
                <Accounts client={client} />
                <People client={client} />
                <LimitsCard client={client.id} />
              </>
            )
          }}
        </ClientRead>
      </div>
    </Section>
  )
}
