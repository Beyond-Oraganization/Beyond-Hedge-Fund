import { useQueries } from '@tanstack/react-query'
import { CommandFailure } from '../../api/client.ts'
import { queryKey, useBot } from '../../api/bot.ts'
import { marketLabel } from '../../api/intervals.ts'
import { parseStrategies, sessionName } from '../../api/session.ts'
import type { TradingSessionState } from '../../api/types.ts'
import { Section, Skeleton } from '../../components/ui.tsx'
import { fmtMoney } from '../../format.ts'
import { useAccounts } from '../../hooks/accounts.ts'
import { outcomeWords } from '../../words.ts'
import { Badge, Banner, Card, DataTable, type Column } from '../../shared/ui/index.ts'

type Row = TradingSessionState & { account: string }

/** "14:00" (UTC). */
const hhmm = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(11, 16) : '–')

/** "4,000.00 EUR, room 4, 1 open", or "Whole balance" for a session without a budget. */
function budgetWords(row: Row) {
  const budget = row.budget
  if (!budget) return 'Whole balance'
  const money = fmtMoney(budget.money ?? budget.amount, budget.currency)
  if (budget.room == null) return money
  return `${money}, room ${budget.room}${budget.open ? `, ${budget.open} open` : ''}`
}

function lastTick(row: Row) {
  const tick = row.lastTick
  if (!tick) return <span>Not yet</span>
  if (tick.outcome === 'Failed')
    return (
      <span className="k-cell-stack">
        <Badge tone="error">Failed {hhmm(tick.time)}</Badge>
        {tick.error ? <span className="k-hint">{tick.error}</span> : null}
      </span>
    )
  return <span>{`${outcomeWords(tick.outcome)} ${hhmm(tick.time)}`}</span>
}

/**
 * Every strategy session of every account this connection holds (two or more), in one table (docs/fund-app-redesign-plan.md,
 * step 13): staff see all the fund's managed accounts at once. Each account's sessions are its own read
 * (`session strategies --json` for that account), so one account that fails does not hide the others.
 */
export function AllSessions() {
  const { connection, queue, ready } = useBot()
  const { accounts } = useAccounts()
  const logins = accounts.map((account) => account.login)
  const reads = useQueries({
    queries: logins.map((login) => ({
      queryKey: queryKey(connection?.id, 'strategies-of', [login]),
      enabled: ready && Boolean(queue),
      refetchInterval: 30_000,
      staleTime: 10_000,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const outcome = await queue!.run(['session', 'strategies', '--json'], { priority: 'view', signal, account: login })
        if (outcome.kind !== 'ok') throw new CommandFailure(outcome)
        const reading = parseStrategies(outcome.result)
        if (!reading.ok) throw new Error(reading.reason)
        return reading.value.map((session): Row => ({ ...session, account: login }))
      },
    })),
  })

  // With one account, the screen's own session cards already show every session.
  if (logins.length < 2) return null
  const rows = reads.flatMap((read) => read.data ?? [])
  const failed = reads.map((read, index) => (read.error ? `${logins[index]}: ${read.error.message}` : null)).filter(Boolean)

  const columns: Column<Row>[] = [
    { key: 'account', header: 'Account', card: 'sub', render: (row) => row.account },
    { key: 'name', header: 'Session', card: 'title', render: (row) => sessionName(row) },
    { key: 'market', header: 'Market', render: (row) => `${marketLabel(row.market)} · ${row.strategy}` },
    { key: 'budget', header: 'Trades with', wrap: true, render: budgetWords },
    { key: 'trades', header: 'Trades', align: 'right', render: (row) => String(row.trades) },
    { key: 'last', header: 'Last tick (UTC)', wrap: true, render: lastTick },
    { key: 'next', header: 'Next', align: 'right', render: (row) => hhmm(row.nextTickAt) },
  ]

  return (
    <Section label="Every session">
    <Card title="Every session, every account">
      {failed.length ? <Banner tone="warn" title="Some accounts could not be read">{failed.join(' · ')}</Banner> : null}
      {reads.some((read) => read.isPending) && !rows.length ? (
        <Skeleton lines={3} />
      ) : rows.length ? (
        <DataTable surface="paper" columns={columns} rows={rows} rowKey={(row) => `${row.account}/${sessionName(row)}`} caption="Strategy sessions" />
      ) : (
        <p className="k-hint">No strategy trades on any of these accounts.</p>
      )}
    </Card>
    </Section>
  )
}
