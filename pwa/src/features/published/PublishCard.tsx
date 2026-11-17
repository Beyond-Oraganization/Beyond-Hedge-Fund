import { useId, useMemo, useState, type FormEvent } from 'react'
import { useAction } from '../../api/bot.ts'
import type { StrategyDefinition } from '../../api/parse/strategies.ts'
import type { DeviceRun } from '../../backtest/runs.ts'
import { Banner, Button, Card } from '../../shared/ui/index.ts'
import { useMenu } from '../menu/menu.ts'
import { publishArgs, ranSetup } from './published.ts'

/**
 * Publishes a backtest this device ran (staff and the owner): its figures, for everyone, clients too, under a menu setup it
 * ran exactly. Only such setups are offered, so the figures clients read are of what the setup trades.
 */
export function PublishCard({ run, definitions, onClose, onDone }: { run: DeviceRun; definitions: StrategyDefinition[] | null; onClose: () => void; onDone: (text: string) => void }) {
  const id = useId()
  const action = useAction()
  const menu = useMenu(true)
  const definition = definitions?.find((d) => d.name === run.input.strategy)
  const matching = useMemo(
    () => (menu.data?.parsed.ok ? menu.data.parsed.value : []).filter((setup) => !setup.withdrawn && ranSetup(run.input, setup, definition)),
    [menu.data, run.input, definition],
  )
  const [setupId, setSetupId] = useState<number | null>(null)
  const chosen = matching.find((setup) => setup.id === setupId) ?? matching[0] ?? null
  const years = `${run.result.start.slice(0, 4)}–${run.result.end.slice(0, 4)}`
  const [title, setTitle] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const shownTitle = title ?? (chosen ? `${chosen.name}, ${years}` : '')

  async function publish(event: FormEvent) {
    event.preventDefault()
    if (!chosen) return
    setBusy(true)
    setProblem(null)
    try {
      await action(publishArgs(chosen.id, run.result, { title: shownTitle.trim(), note }), { invalidate: ['published'] })
      onDone(`Published “${shownTitle.trim()}” for ${chosen.name}: every client who reads the menu sees it.`)
      onClose()
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Publish this backtest">
      {menu.isPending ? (
        <p className="k-hint">Reading the menu…</p>
      ) : !matching.length ? (
        <>
          <Banner tone="info" title="No menu setup trades exactly this">
            Clients read a published backtest as their setup’s, so it must be of the same strategy, market, parameters, rules and sizing. Offer this run as a setup first, or
            backtest a setup as the menu fixes it.
          </Banner>
          <div className="k-row">
            <Button variant="quiet" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      ) : (
        <form className="k-form" onSubmit={publish}>
          <div className="k-field">
            <label htmlFor={`${id}-setup`}>The setup it tested</label>
            <select id={`${id}-setup`} className="k-input" value={chosen?.id ?? ''} onChange={(event) => setSetupId(Number(event.target.value))}>
              {matching.map((setup) => (
                <option key={setup.id} value={setup.id}>
                  {setup.name}
                </option>
              ))}
            </select>
          </div>
          <div className="k-field">
            <label htmlFor={`${id}-title`}>Title clients read</label>
            <input id={`${id}-title`} className="k-input" value={shownTitle} maxLength={80} onChange={(event) => setTitle(event.target.value)} required />
          </div>
          <div className="k-field">
            <label htmlFor={`${id}-note`}>A note (optional)</label>
            <textarea id={`${id}-note`} className="k-input k-textarea" value={note} maxLength={1000} rows={2} onChange={(event) => setNote(event.target.value)} />
            <p className="k-hint">In words a client understands, e.g. “Before fees; prices of 2024 and 2025.” Everyone sees the figures; only the fund and trusted clients see the setup’s parameters.</p>
          </div>
          {problem ? <Banner tone="error" title={problem} /> : null}
          <div className="k-row">
            <Button type="submit" variant="primary" busy={busy} disabled={!shownTitle.trim()}>
              Publish
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}
