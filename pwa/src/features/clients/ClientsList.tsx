import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAction } from '../../api/bot.ts'
import { Section } from '../../components/ui.tsx'
import { fmtMoney } from '../../format.ts'
import { Badge, Banner, Button, Card, Change, DataTable, EmptyState, PageHeader, type Column } from '../../shared/ui/index.ts'
import { ClientRead } from '../portfolio/ClientRead.tsx'
import { usePortfolio, type AccountPortfolio } from '../portfolio/portfolio.ts'
import { addedId, readiness, useClients, type Client } from './clients.ts'

/** A client's accounts as one line: "10,472.72 EUR", or each in its own currency (they are not added up). */
const values = (client: Client, portfolios: AccountPortfolio[]) =>
  client.accounts.map((login) => portfolios.find((p) => p.login === login)).filter((p): p is AccountPortfolio => p?.value != null)

/** Adds a client by name and opens their page, where people and accounts are linked. */
function AddClient() {
  const id = useId()
  const run = useAction()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setError('Give the client a name.')
    setBusy(true)
    setError(null)
    try {
      const result = await run(['clients', 'add', name.trim(), '--json'], { invalidate: ['clients'] })
      const added = addedId(result)
      setName('')
      if (added != null) navigate(`/clients/${added}`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Add a client">
      <form className="k-row" onSubmit={add} noValidate>
        <div className="k-field k-grow">
          <label htmlFor={id}>Name</label>
          <input id={id} className="k-input" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} />
        </div>
        <Button type="submit" variant="primary" busy={busy}>
          Add client
        </Button>
      </form>
      {error ? (
        <p className="k-field-error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
      <p className="k-hint">Then link the person who signs in for them and their managed account at the broker.</p>
    </Card>
  )
}

/**
 * The fund's clients (docs/fund-app-redesign-plan.md, section 7): one row each, with their accounts' value and this
 * month's return (deposits left out), who signs in for them, and what is still missing, in words.
 */
export default function ClientsList() {
  const clients = useClients()
  const portfolio = usePortfolio()
  const portfolios = portfolio.data?.parsed.ok ? portfolio.data.parsed.value : []

  const columns: Column<Client>[] = [
    { key: 'name', header: 'Client', card: 'title', render: (c) => <Link to={`/clients/${c.id}`}>{c.name}</Link> },
    { key: 'accounts', header: 'Accounts', wrap: true, render: (c) => (c.accounts.length ? c.accounts.join(', ') : '–') },
    {
      key: 'value',
      header: 'Value',
      align: 'right',
      render: (c) => values(c, portfolios).map((p) => fmtMoney(p.value, p.currency ?? '')).join(', ') || '–',
    },
    {
      key: 'month',
      header: 'This month',
      align: 'right',
      render: (c) => {
        const shown = values(c, portfolios)
        return shown.length === 1 ? <Change kind="percent" value={shown[0]!.returns.month == null ? null : shown[0]!.returns.month * 100} /> : '–'
      },
    },
    { key: 'people', header: 'Signs in', wrap: true, render: (c) => (c.people.length ? c.people.join(', ') : '–') },
    {
      key: 'status',
      header: 'Status',
      render: (c) => {
        const ready = readiness(c, portfolios)
        return <Badge tone={ready.tone}>{ready.words}</Badge>
      },
    },
  ]

  return (
    <Section>
      <div className="k-demo">
        <PageHeader title="Clients" meta="Each client’s managed accounts, who signs in for them, and what is still missing. Returns leave deposits out." />
        {portfolio.error && !portfolio.data ? <Banner tone="warn" title="Values could not be loaded">{portfolio.error.message}</Banner> : null}
        <ClientRead query={clients} what="clients">
          {(all) =>
            all.length ? (
              <DataTable surface="paper" columns={columns} rows={all} rowKey={(c) => String(c.id)} caption="The fund’s clients" />
            ) : (
              <Card>
                <EmptyState title="No client yet">Add the first one below, then link the person who signs in and their managed account.</EmptyState>
              </Card>
            )
          }
        </ClientRead>
        <AddClient />
      </div>
    </Section>
  )
}
