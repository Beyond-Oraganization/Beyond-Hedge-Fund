import { useId, useState, type FormEvent } from 'react'
import { useAction } from '../../api/bot.ts'
import { Banner, Button, Card } from '../../shared/ui/index.ts'
import { ClientRead } from '../portfolio/ClientRead.tsx'
import { riskWord, useLimits, useMenu, type ClientLimits, type MenuSetup } from './menu.ts'

const text = (value: number | null) => (value == null ? '' : String(value))

/** A limit as typed: empty is no limit ("none" to the bot), else a number. */
const limitArg = (typed: string) => (typed.trim() === '' ? 'none' : typed.trim().replace(/,/g, ''))

type Outcome = { tone: 'ok' | 'error'; text: string }

// The form starts afresh from the saved limits after each save (its key), so the outcome lives in the card.
function LimitsForm({ client, limits, setups, onOutcome }: { client: number; limits: ClientLimits; setups: MenuSetup[]; onOutcome: (outcome: Outcome | null) => void }) {
  const id = useId()
  const run = useAction()
  const [chosen, setChosen] = useState<number[]>(limits.setups)
  const [maxBudget, setMaxBudget] = useState(text(limits.maxBudget))
  const [maxPercent, setMaxPercent] = useState(text(limits.maxBudgetPercent))
  const [maxSessions, setMaxSessions] = useState(text(limits.maxSessions))
  const [live, setLive] = useState(limits.liveAllowed)
  const [busy, setBusy] = useState(false)
  const offered = setups.filter((s) => !s.withdrawn || limits.setups.includes(s.id))

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    onOutcome(null)
    try {
      await run(
        ['clients', 'limits', String(client), '--setups', chosen.length ? chosen.join(',') : 'none', '--max-budget', limitArg(maxBudget), '--max-budget-percent', limitArg(maxPercent),
          '--max-sessions', limitArg(maxSessions), '--live', live ? 'yes' : 'no', '--json'],
        { invalidate: ['limits'] },
      )
      onOutcome({ tone: 'ok', text: 'Limits saved. The client’s Strategies offer exactly these setups now.' })
    } catch (failure) {
      onOutcome({ tone: 'error', text: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="k-form" onSubmit={save}>
      {limits.updatedAt == null ? <Banner tone="warn" title="No limits yet: this client may start nothing" /> : null}
      <fieldset className="k-fieldset">
        <legend>Setups they may start</legend>
        {offered.length ? (
          offered.map((setup) => (
            <label key={setup.id} className="k-check">
              <input type="checkbox" checked={chosen.includes(setup.id)} onChange={(event) => setChosen((list) => (event.target.checked ? [...list, setup.id] : list.filter((x) => x !== setup.id)))} />
              {setup.name} <span className="k-feed-account">· {riskWord(setup.risk)}{setup.withdrawn ? ', withdrawn' : ''}</span>
            </label>
          ))
        ) : (
          <p className="k-hint">The menu is empty: the owner adds setups in Admin, Strategy menu.</p>
        )}
      </fieldset>
      <div className="k-row">
        <div className="k-field k-grow">
          <label htmlFor={`${id}-budget`}>Largest budget (amount)</label>
          <input id={`${id}-budget`} className="k-input" inputMode="decimal" value={maxBudget} onChange={(event) => setMaxBudget(event.target.value)} />
        </div>
        <div className="k-field k-grow">
          <label htmlFor={`${id}-percent`}>Largest budget (% of the balance)</label>
          <input id={`${id}-percent`} className="k-input" inputMode="decimal" value={maxPercent} onChange={(event) => setMaxPercent(event.target.value)} />
        </div>
        <div className="k-field k-grow">
          <label htmlFor={`${id}-sessions`}>Sessions at once</label>
          <input id={`${id}-sessions`} className="k-input" inputMode="numeric" value={maxSessions} onChange={(event) => setMaxSessions(event.target.value)} />
        </div>
      </div>
      <p className="k-hint">Empty is no limit. With both budget limits, the smaller counts. The bot checks them before anything reaches the broker.</p>
      <label className="k-check">
        <input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} />
        May start on a Live account (real money)
      </label>
      <div className="k-row">
        <Button type="submit" variant="primary" busy={busy}>
          Save limits
        </Button>
      </div>
    </form>
  )
}

/** What a client may start from the menu (plan, section 7: a client's page, their limits), set by staff. */
export function LimitsCard({ client }: { client: number }) {
  const limits = useLimits(client)
  const menu = useMenu(true)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  return (
    <Card title="Limits">
      {outcome ? <Banner tone={outcome.tone === 'ok' ? 'ok' : 'error'} title={outcome.text} /> : null}
      <ClientRead query={limits} what="limits">
        {(own) => (
          <ClientRead query={menu} what="menu">
            {(setups) => <LimitsForm key={own.updatedAt ?? 'none'} client={client} limits={own} setups={setups} onOutcome={setOutcome} />}
          </ClientRead>
        )}
      </ClientRead>
    </Card>
  )
}
