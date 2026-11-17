import { useEffect, useId, useMemo, useState } from 'react'
import { useAction, useRead } from '../../api/bot.ts'
import { sessionName } from '../../api/session.ts'
import type { TradingSessionState } from '../../api/types.ts'
import { Section } from '../../components/ui.tsx'
import { fmtMoney } from '../../format.ts'
import { useAccounts } from '../../hooks/accounts.ts'
import { Badge, Banner, Button, Card, Change, EmptyState, PageHeader } from '../../shared/ui/index.ts'
import { ClientRead } from '../portfolio/ClientRead.tsx'
import { inSentence, marketName, strategyName } from '../portfolio/words.ts'
import { readBudget, readCheck, type StartCheck } from '../trading/check.ts'
import { newestBySetup, testedWords, usePublished, type PublishedBacktest } from '../published/published.ts'
import { riskWord, sizingWords, useMenu, useMySessions, type MenuSetup } from './menu.ts'

/** "7 Nov" (UTC). */
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * One strategy trading for the client, under the menu's name: what it trades, since when, what it trades with and has made,
 * and Stop, which asks in place. Stop names the session as the bot does.
 */
function Running({ session, menu }: { session: TradingSessionState; menu: MenuSetup[] }) {
  const run = useAction()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = sessionName(session)
  const shown = strategyName(session, menu)
  const spoken = inSentence(shown)
  const budget = session.budget
  const open = budget?.open ?? 0

  async function stop() {
    setBusy(true)
    setError(null)
    try {
      await run(['trading', 'stop', '--name', name], { invalidate: ['my-sessions', 'activity'] })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  return (
    <li className="k-strategy">
      <div className="k-row k-strategy-head">
        <strong className="k-grow-text">{shown}</strong>
        {open ? <Badge tone="neutral">{open === 1 ? '1 trade open' : `${open} trades open`}</Badge> : null}
      </div>
      <p className="k-hint">
        {marketName(session.market.symbol)} · since {day(session.startedAt)}
        {budget ? ` · budget ${fmtMoney(budget.amount, budget.currency)}` : ''} · {session.trades === 1 ? '1 trade' : `${session.trades} trades`}
      </p>
      {budget?.results != null ? (
        <p>
          Result so far <Change kind="money" value={budget.results} currency={budget.currency} />
        </p>
      ) : null}
      {error ? <Banner tone="error" title={error} /> : null}
      {asking ? (
        <div className="k-confirm" role="group" aria-label={`Stop ${spoken}?`}>
          <p>
            <strong>Stop {spoken}?</strong> It won’t open new trades.{' '}
            {open ? `${open === 1 ? 'Its open trade stays' : `Its ${open} open trades stay`} open until the fund closes ${open === 1 ? 'it' : 'them'}.` : 'It has no trade open now.'}
          </p>
          <div className="k-row">
            <Button variant="danger" busy={busy} onClick={() => void stop()}>
              Stop it
            </Button>
            <Button variant="quiet" disabled={busy} onClick={() => setAsking(false)}>
              Keep it running
            </Button>
          </div>
        </div>
      ) : (
        <div className="k-row">
          <Button variant="secondary" icon="stop" onClick={() => setAsking(true)} aria-label={`Stop ${spoken}`}>
            Stop
          </Button>
        </div>
      )}
    </li>
  )
}

/** Choosing a budget for a setup: the largest the client's limits allow, the bot's check of it, then Start. */
function AddForm({ setup, onDone }: { setup: MenuSetup; onDone: (text: string) => void }) {
  const id = useId()
  const read = useRead()
  const run = useAction()
  const { current } = useAccounts()
  const live = current?.live ?? false
  const [text, setText] = useState('')
  const [largest, setLargest] = useState<number | null>(null)
  const [check, setCheck] = useState<{ budget: number | null; result: StartCheck } | null>(null)
  const [busy, setBusy] = useState<'check' | 'start' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const budget = readBudget(text)
  const currency = current?.currency ?? ''
  const checked = check && check.budget === budget.amount ? check.result : null

  // The largest budget their limits allow here, from a check without one.
  useEffect(() => {
    let live = true
    void read(['trading', 'check', '--setup', String(setup.id), '--json'])
      .then((result) => {
        if (live) setLargest(readCheck(result) ? ((result.json as { largestBudget?: number | null }).largestBudget ?? null) : null)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [read, setup.id])

  async function runCheck() {
    if (budget.error) return
    setBusy('check')
    setError(null)
    try {
      const result = readCheck(await read(['trading', 'check', '--setup', String(setup.id), ...(budget.amount != null ? ['--budget', String(budget.amount)] : []), '--json']))
      if (result) setCheck({ budget: budget.amount, result })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(null)
    }
  }

  async function start() {
    setBusy('start')
    setError(null)
    try {
      await run(['trading', 'start', '--setup', String(setup.id), ...(budget.amount != null ? ['--budget', String(budget.amount)] : []), ...(live ? ['--live'] : [])], {
        invalidate: ['my-sessions', 'activity'],
      })
      onDone(`${setup.name} is trading for you${budget.amount != null ? ` with ${fmtMoney(budget.amount, currency)}` : ''}. Its first trade can come at the next candle’s close.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="k-demo k-add">
      <div className="k-field">
        <label htmlFor={id}>Budget{currency ? `, in ${currency}` : ''}</label>
        <input
          id={id}
          className="k-input"
          inputMode="decimal"
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setError(null)
          }}
          aria-invalid={budget.error ? true : undefined}
          aria-describedby={`${id}-hint`}
        />
        <p className="k-hint" id={`${id}-hint`}>
          {budget.error ?? (largest != null ? `At most ${fmtMoney(largest, currency)} on this account. The strategy trades with this money plus what it makes or loses.` : 'The strategy trades with this money plus what it makes or loses.')}
        </p>
      </div>
      {live ? <Banner tone="warn" title="This account trades real money" /> : null}
      {checked ? (
        checked.wouldStart ? (
          <Banner tone="ok" title="It would start">
            {checked.text}
          </Banner>
        ) : (
          <Banner tone="error" title="It would not start">
            {checked.refusal ?? checked.text}
          </Banner>
        )
      ) : null}
      {error ? <Banner tone="error" title={error} /> : null}
      <div className="k-row">
        {checked?.wouldStart ? (
          <Button variant="primary" icon="play" busy={busy === 'start'} disabled={busy !== null} onClick={() => void start()}>
            Start {setup.name}
          </Button>
        ) : (
          <Button variant="primary" busy={busy === 'check'} disabled={busy !== null || Boolean(budget.error)} onClick={() => void runCheck()}>
            Check
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * A setup of the menu, as a client reads it: its name, risk and description, how it sizes, and how the fund tested it (its
 * newest published backtest); Choose opens the budget.
 */
function Offer({ setup, tested, chosen, onChoose, onDone }: { setup: MenuSetup; tested: PublishedBacktest | undefined; chosen: boolean; onChoose: () => void; onDone: (text: string) => void }) {
  return (
    <li className="k-strategy">
      <div className="k-row k-strategy-head">
        <strong className="k-grow-text">{setup.name}</strong>
        <Badge tone={setup.risk === 'bold' ? 'warn' : 'neutral'}>{riskWord(setup.risk)}</Badge>
      </div>
      <p>{setup.description}</p>
      <p className="k-hint">{sizingWords(setup.sizing)}.</p>
      {tested ? (
        <p className="k-hint">
          <strong>{tested.title}.</strong> {testedWords(tested)}
          {tested.note ? ` ${tested.note}` : ''}
        </p>
      ) : null}
      {chosen ? (
        <AddForm setup={setup} onDone={onDone} />
      ) : (
        <div className="k-row">
          <Button variant="secondary" onClick={onChoose} aria-label={`Choose ${setup.name}`}>
            Choose
          </Button>
        </div>
      )}
    </li>
  )
}

/**
 * A client's Strategies (docs/fund-app-redesign-plan.md, section 7): what trades for them now, with Stop; and Add a strategy
 * from the menu the fund allows them, with a budget the bot checks against their limits before Start.
 */
export default function ClientStrategies() {
  const sessions = useMySessions()
  const menu = useMenu()
  const published = usePublished()
  const tested = useMemo(() => newestBySetup(published.data?.parsed.ok ? published.data.parsed.value : []), [published.data])
  const [chosen, setChosen] = useState<number | null>(null)
  const [done, setDone] = useState<string | null>(null)

  return (
    <Section>
      <div className="k-demo k-narrow">
        <PageHeader title="Strategies" meta="What trades for you, and the strategies the fund offers you. Each was approved by the fund." />
        {done ? <Banner tone="ok" title={done} /> : null}
        <Card title="Trading for you">
          <ClientRead query={sessions} what="strategies">
            {(running) =>
              running.length ? (
                <ul className="k-strategies">
                  {running.map((session) => (
                    <Running key={sessionName(session)} session={session} menu={menu.data?.parsed.ok ? menu.data.parsed.value : []} />
                  ))}
                </ul>
              ) : (
                <EmptyState title="Nothing trades for you right now">Add a strategy below, from the fund’s menu.</EmptyState>
              )
            }
          </ClientRead>
        </Card>
        <Card title="Add a strategy">
          <ClientRead query={menu} what="menu">
            {(setups) =>
              setups.length ? (
                <ul className="k-strategies">
                  {setups.map((setup) => (
                    <Offer
                      key={setup.id}
                      setup={setup}
                      tested={tested.get(setup.id)}
                      chosen={chosen === setup.id}
                      onChoose={() => {
                        setChosen(setup.id)
                        setDone(null)
                      }}
                      onDone={(text) => {
                        setChosen(null)
                        setDone(text)
                      }}
                    />
                  ))}
                </ul>
              ) : (
                <EmptyState title="The fund has not offered you a strategy yet">Ask the fund which strategies you may start.</EmptyState>
              )
            }
          </ClientRead>
        </Card>
      </div>
    </Section>
  )
}
