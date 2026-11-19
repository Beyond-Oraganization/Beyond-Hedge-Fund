import { useId, useState, type FormEvent } from 'react'
import { useAction } from '../../api/bot.ts'
import { Section } from '../../components/ui.tsx'
import { fmtCount, fmtPercent, fmtSignedPercent } from '../../format.ts'
import { Banner, Button, Card, DataTable, EmptyState, PageHeader, type Column } from '../../shared/ui/index.ts'
import { ClientRead } from '../portfolio/ClientRead.tsx'
import { renameArgs, usePublished, type PublishedBacktest } from './published.ts'

type Outcome = { tone: 'ok' | 'error'; text: string }

function Rename({ backtest, onClose, onOutcome }: { backtest: PublishedBacktest; onClose: () => void; onOutcome: (outcome: Outcome) => void }) {
  const id = useId()
  const action = useAction()
  const [title, setTitle] = useState(backtest.title)
  const [note, setNote] = useState(backtest.note ?? '')
  const [busy, setBusy] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await action(renameArgs(backtest.id, { title, note }), { invalidate: ['published'] })
      onOutcome({ tone: 'ok', text: `Published backtest ${backtest.id} is now “${title.trim()}”.` })
      onClose()
    } catch (failure) {
      onOutcome({ tone: 'error', text: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title={`Change “${backtest.title}”`}>
      <form className="k-form" onSubmit={save}>
        <div className="k-field">
          <label htmlFor={`${id}-title`}>Title clients read</label>
          <input id={`${id}-title`} className="k-input" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} required />
        </div>
        <div className="k-field">
          <label htmlFor={`${id}-note`}>Note</label>
          <textarea id={`${id}-note`} className="k-input k-textarea" value={note} maxLength={1000} rows={2} onChange={(event) => setNote(event.target.value)} />
        </div>
        <div className="k-row">
          <Button type="submit" variant="primary" busy={busy} disabled={!title.trim()}>
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

/**
 * Published backtests (staff and the owner): what everyone, clients too, reads of how a menu setup was tested. Publish one
 * from Backtest; change its words or take it down here.
 */
export default function PublishedPage() {
  const published = usePublished()
  const action = useAction()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [editing, setEditing] = useState<PublishedBacktest | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  async function remove(backtest: PublishedBacktest) {
    setBusy(backtest.id)
    try {
      await action(['published', 'delete', String(backtest.id)], { invalidate: ['published'] })
      setOutcome({ tone: 'ok', text: `Took “${backtest.title}” down: no client sees it any more.` })
      setDeleting(null)
    } catch (failure) {
      setOutcome({ tone: 'error', text: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<PublishedBacktest>[] = [
    { key: 'title', header: 'Published', card: 'title', wrap: true, render: (p) => <span><strong>{p.title}</strong> <span className="k-feed-account">#{p.id}</span></span> },
    { key: 'setup', header: 'Setup', wrap: true, render: (p) => p.setupName ?? '–' },
    { key: 'period', header: 'Period', render: (p) => `${p.from.slice(0, 10)} → ${p.to.slice(0, 10)}` },
    { key: 'return', header: 'Return', align: 'right', render: (p) => fmtSignedPercent(p.returnPercent) },
    { key: 'trades', header: 'Trades', align: 'right', render: (p) => fmtCount(p.trades) },
    { key: 'drawdown', header: 'Deepest fall', align: 'right', render: (p) => fmtPercent(p.maxDrawdownPercent, 1) },
    { key: 'sharpe', header: 'Sharpe', align: 'right', render: (p) => p.measures?.sharpe?.toFixed(2) ?? '–' },
    { key: 'beta', header: 'Beta', align: 'right', render: (p) => p.measures?.beta?.toFixed(2) ?? '–' },
    { key: 'by', header: 'By', render: (p) => `${p.publishedBy}${p.backtestId != null ? ` · backtest #${p.backtestId}` : ''}` },
  ]

  return (
    <Section>
      <div className="k-demo">
        <PageHeader title="Published backtests" meta="What every client reads of how a setup was tested: the figures only, never how the strategy trades. Publish one from Backtest." />
        {outcome ? <Banner tone={outcome.tone === 'ok' ? 'ok' : 'error'} title={outcome.text} /> : null}
        <ClientRead query={published} what="published backtests">
          {(rows) =>
            rows.length ? (
              <DataTable
                surface="paper"
                columns={columns}
                rows={rows}
                rowKey={(p) => String(p.id)}
                caption="Published backtests"
                actions={(p) =>
                  deleting === p.id ? (
                    <div className="k-row">
                      <Button variant="danger" busy={busy === p.id} onClick={() => void remove(p)} aria-label={`Delete ${p.title} for good`}>
                        Delete for good
                      </Button>
                      <Button variant="quiet" onClick={() => setDeleting(null)}>
                        Keep
                      </Button>
                    </div>
                  ) : (
                    <div className="k-row">
                      <Button variant="quiet" onClick={() => setEditing(p)} aria-label={`Change ${p.title}`}>
                        Change
                      </Button>
                      <Button variant="quiet" disabled={busy !== null} onClick={() => setDeleting(p.id)} aria-label={`Delete ${p.title}`}>
                        Delete
                      </Button>
                    </div>
                  )
                }
              />
            ) : (
              <Card>
                <EmptyState title="Nothing is published yet">Run a backtest of a menu setup, then Publish it: clients see its figures on their Strategies.</EmptyState>
              </Card>
            )
          }
        </ClientRead>
        {editing ? <Rename key={editing.id} backtest={editing} onClose={() => setEditing(null)} onOutcome={setOutcome} /> : null}
      </div>
    </Section>
  )
}
