import { useId, useState } from 'react'
import { Section } from '../../components/ui.tsx'
import { Badge, Button, Card, DataTable, EmptyState, PageHeader, type Column, type Tone } from '../../shared/ui/index.ts'
import { ClientRead } from '../portfolio/ClientRead.tsx'
import { useAudit, type AuditEntry } from './admin.ts'

const OUTCOME: Record<string, { tone: Tone; words: string }> = {
  done: { tone: 'ok', words: 'Done' },
  refused: { tone: 'warn', words: 'Refused' },
  failed: { tone: 'error', words: 'Failed' },
}

/** "2026-11-15 18:14" (UTC). */
const when = (at: string) => at.slice(0, 16).replace('T', ' ')

/** Who sent it: the person, or the API key or the server's terminal. */
const who = (entry: AuditEntry) => entry.person ?? (entry.via === 'apiKey' ? 'API key' : entry.via === 'terminal' ? 'Terminal' : entry.via)

/**
 * What changed, who asked, and how it ended (docs/fund-app-redesign-plan.md, section 6: staff read it, the owner too):
 * every command that changes something, refused ones too, and sign-ins. Reads are not logged. Passwords show as ***.
 */
export default function Audit() {
  const id = useId()
  const [last, setLast] = useState(50)
  const [person, setPerson] = useState('')
  const [filter, setFilter] = useState<string | null>(null)
  const audit = useAudit(last, filter)

  const columns: Column<AuditEntry>[] = [
    { key: 'at', header: 'When (UTC)', card: 'sub', render: (e) => when(e.at) },
    { key: 'who', header: 'Who', render: (e) => (e.role ? `${who(e)} (${e.role})` : who(e)) },
    { key: 'command', header: 'Command', card: 'title', wrap: true, render: (e) => <code className="k-code">{e.command}</code> },
    { key: 'account', header: 'Account', render: (e) => e.account ?? '–' },
    {
      key: 'outcome',
      header: 'Outcome',
      wrap: true,
      render: (e) => (
        <span className="k-cell-stack">
          <Badge tone={OUTCOME[e.outcome]?.tone ?? 'neutral'}>{OUTCOME[e.outcome]?.words ?? e.outcome}</Badge>
          {e.error ? <span className="k-hint">{e.error}</span> : null}
        </span>
      ),
    },
  ]

  return (
    <Section>
      <div className="k-demo">
        <PageHeader title="Audit log" meta="Every command that changed something, refused ones and sign-ins too, newest first. Reads are not logged; passwords show as ***." />
        <Card>
          <form
            className="k-row"
            onSubmit={(event) => {
              event.preventDefault()
              setFilter(person.trim().toLowerCase() || null)
            }}
          >
            <div className="k-field k-grow">
              <label htmlFor={id}>Only this person (login)</label>
              <input id={id} className="k-input" value={person} autoCapitalize="none" spellCheck={false} onChange={(event) => setPerson(event.target.value)} />
            </div>
            <Button type="submit">Show</Button>
            {filter ? (
              <Button
                variant="quiet"
                onClick={() => {
                  setPerson('')
                  setFilter(null)
                }}
              >
                Everyone
              </Button>
            ) : null}
          </form>
        </Card>
        <ClientRead query={audit} what="audit log">
          {(entries) =>
            entries.length ? (
              <>
                <DataTable surface="paper" columns={columns} rows={entries} rowKey={(e) => String(e.id)} caption="Audit log" />
                {entries.length >= last && last < 500 ? (
                  <div className="k-row">
                    <Button variant="secondary" onClick={() => setLast(Math.min(500, last * 4))}>
                      Show more
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <Card>
                <EmptyState title={filter ? `Nothing from ${filter}` : 'Nothing logged yet'}>Changes, refusals and sign-ins show here as they happen.</EmptyState>
              </Card>
            )
          }
        </ClientRead>
      </div>
    </Section>
  )
}
