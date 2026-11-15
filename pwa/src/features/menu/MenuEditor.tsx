import { useId, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router'
import { useAction } from '../../api/bot.ts'
import { StrategyForm } from '../../components/StrategyForm.tsx'
import { Section, Skeleton } from '../../components/ui.tsx'
import { useMarkets, useStrategies } from '../../hooks/data.ts'
import { Badge, Banner, Button, Card, DataTable, EmptyState, PageHeader, type Column } from '../../shared/ui/index.ts'
import { initialConfig, toInput, validateConfig, type StrategyConfig } from '../../strategy/config.ts'
import { ClientRead } from '../portfolio/ClientRead.tsx'
import { menuAddArgs, offered, RISKS, riskWord, sizingWords, useMenu, type MenuSetup, type Risk } from './menu.ts'

type Outcome = { tone: 'ok' | 'error'; text: string }

/** The words clients read: a name, a description, and the risk. */
function Words({ id, name, description, risk, onChange }: { id: string; name: string; description: string; risk: Risk; onChange: (patch: Partial<{ name: string; description: string; risk: Risk }>) => void }) {
  return (
    <>
      <div className="k-field">
        <label htmlFor={`${id}-name`}>Name clients read</label>
        <input id={`${id}-name`} className="k-input" value={name} maxLength={80} placeholder="Gold trend, steady" onChange={(event) => onChange({ name: event.target.value })} />
      </div>
      <div className="k-field">
        <label htmlFor={`${id}-description`}>What it does, and when it loses</label>
        <textarea id={`${id}-description`} className="k-input k-textarea" value={description} maxLength={1000} rows={3} onChange={(event) => onChange({ description: event.target.value })} />
        <p className="k-hint">In words a client understands: no strategy codes, ticks or parameters.</p>
      </div>
      <div className="k-field">
        <label htmlFor={`${id}-risk`}>Risk</label>
        <select id={`${id}-risk`} className="k-input" value={risk} onChange={(event) => onChange({ risk: event.target.value as Risk })}>
          {RISKS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.words}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}

function AddSetup({ onOutcome }: { onOutcome: (outcome: Outcome) => void }) {
  const id = useId()
  const run = useAction()
  const strategies = useStrategies()
  const markets = useMarkets()
  const [params] = useSearchParams()
  const offer = useMemo(() => offered(params.get('offer')), [params])
  const [edited, setConfig] = useState<StrategyConfig | null>(null)
  const [words, setWords] = useState({ name: '', description: '', risk: 'steady' as Risk })
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const definitions = strategies.data?.parsed.ok ? strategies.data.parsed.value : null
  const rows = markets.data?.parsed.ok ? markets.data.parsed.value : null
  const config = edited ?? offer ?? (definitions && rows ? initialConfig(definitions, rows) : null)
  const definition = definitions?.find((d) => d.name === config?.strategy)
  const errors = useMemo(() => (config ? validateConfig(config, definition) : {}), [config, definition])
  const missing = !words.name.trim() ? 'Give the setup a name clients read.' : !words.description.trim() ? 'Say what it does and when it loses.' : null

  if (!definitions || !rows || !config) return <Skeleton lines={4} />

  async function add(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (Object.keys(errors).length || missing) return
    setBusy(true)
    try {
      const result = await run(menuAddArgs(toInput(config!, definition), { name: words.name.trim(), description: words.description.trim(), risk: words.risk }), { invalidate: ['menu', 'menu-all'] })
      onOutcome({ tone: 'ok', text: result.output.trim().split('\n')[0] ?? 'Added.' })
      setWords({ name: '', description: '', risk: 'steady' })
      setTouched(false)
    } catch (failure) {
      onOutcome({ tone: 'error', text: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={offer && !edited ? 'Offer this backtest to clients' : 'Add a setup'}>
      <form className="k-form" onSubmit={add} noValidate>
        {offer && !edited ? <Banner tone="info" title="From your backtest">Its strategy, market, parameters, rules and sizing are filled in below; give it the words clients read.</Banner> : null}
        <Words id={id} {...words} onChange={(patch) => setWords((current) => ({ ...current, ...patch }))} />
        <StrategyForm definitions={definitions} markets={rows} config={config} onChange={setConfig} errors={touched ? errors : {}} />
        {touched && missing ? <p className="k-field-error">{missing}</p> : null}
        <div className="k-row">
          <Button type="submit" variant="primary" busy={busy}>
            Add to the menu
          </Button>
        </div>
        <p className="k-hint">What it trades never changes once added: to trade differently, add a new setup and withdraw this one. Clients see it once their limits allow it (a client’s page, Limits).</p>
      </form>
    </Card>
  )
}

function ChangeWords({ setup, onClose, onOutcome }: { setup: MenuSetup; onClose: () => void; onOutcome: (outcome: Outcome) => void }) {
  const id = useId()
  const run = useAction()
  const [words, setWords] = useState({ name: setup.name, description: setup.description, risk: setup.risk })
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await run(['menu', 'change', String(setup.id), '--name', words.name.trim(), '--description', words.description.trim(), '--risk', words.risk], { invalidate: ['menu', 'menu-all'] })
      onOutcome({ tone: 'ok', text: result.output.trim().split('\n')[0] ?? 'Changed.' })
      onClose()
    } catch (failure) {
      onOutcome({ tone: 'error', text: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={`Change the words of “${setup.name}”`}>
      <form className="k-form" onSubmit={save}>
        <Words id={id} {...words} onChange={(patch) => setWords((current) => ({ ...current, ...patch }))} />
        <div className="k-row">
          <Button type="submit" variant="primary" busy={busy}>
            Save words
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}

/**
 * The owner's strategy menu (docs/fund-app-redesign-plan.md, section 7): the setups clients may start, each a strategy on one
 * market with everything but the budget fixed, under words clients read. Add one (or offer a backtest from Backtest), change
 * its words, or withdraw it: its running sessions keep running.
 */
export default function MenuEditor() {
  const menu = useMenu(true)
  const run = useAction()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [editing, setEditing] = useState<MenuSetup | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  async function withdraw(setup: MenuSetup) {
    setBusy(setup.id)
    try {
      const result = await run(['menu', 'withdraw', String(setup.id)], { invalidate: ['menu', 'menu-all'] })
      setOutcome({ tone: 'ok', text: result.output.trim().split('\n')[0] ?? 'Withdrawn.' })
    } catch (failure) {
      setOutcome({ tone: 'error', text: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<MenuSetup>[] = [
    { key: 'name', header: 'Setup', card: 'title', wrap: true, render: (s) => <span><strong>{s.name}</strong> <span className="k-feed-account">#{s.id}</span></span> },
    { key: 'risk', header: 'Risk', render: (s) => riskWord(s.risk) },
    { key: 'market', header: 'Market', render: (s) => `${s.market} · ${s.strategy}` },
    { key: 'sizing', header: 'Sizing', wrap: true, render: (s) => sizingWords(s.sizing) },
    { key: 'state', header: 'State', render: (s) => (s.withdrawn ? <Badge tone="neutral">Withdrawn</Badge> : <Badge tone="ok">Offered</Badge>) },
  ]

  return (
    <Section>
      <div className="k-demo">
        <PageHeader title="Strategy menu" meta="The setups clients may start, each fixed but for the budget, under words clients read. Only the owner changes the menu." />
        {outcome ? <Banner tone={outcome.tone === 'ok' ? 'ok' : 'error'} title={outcome.text} /> : null}
        <ClientRead query={menu} what="menu">
          {(setups) =>
            setups.length ? (
              <DataTable
                surface="paper"
                columns={columns}
                rows={setups}
                rowKey={(s) => String(s.id)}
                caption="The strategy menu"
                actions={(s) => (
                  <div className="k-row">
                    <Button variant="quiet" onClick={() => setEditing(s)} aria-label={`Change words of ${s.name}`}>
                      Change words
                    </Button>
                    {s.withdrawn ? null : (
                      <Button variant="quiet" busy={busy === s.id} disabled={busy !== null} onClick={() => void withdraw(s)} aria-label={`Withdraw ${s.name}`}>
                        Withdraw
                      </Button>
                    )}
                  </div>
                )}
              />
            ) : (
              <Card>
                <EmptyState title="The menu is empty">Add the first setup below, or offer one of your backtests to clients from Backtest.</EmptyState>
              </Card>
            )
          }
        </ClientRead>
        {editing ? <ChangeWords key={editing.id} setup={editing} onClose={() => setEditing(null)} onOutcome={setOutcome} /> : null}
        <AddSetup onOutcome={setOutcome} />
      </div>
    </Section>
  )
}
