import { Section } from '../../components/ui.tsx'
import { Card, EmptyState, PageHeader } from '../../shared/ui/index.ts'
import { ActivityList, byDay } from './ActivityList.tsx'
import { ClientRead } from './ClientRead.tsx'
import { useActivity, usePortfolio } from './portfolio.ts'

/** What happened on a client's accounts, newest first, one card per day, in plain words (plan, section 7). */
export default function Activity() {
  const activity = useActivity(200)
  const portfolio = usePortfolio()
  const accounts = portfolio.data?.parsed.ok ? portfolio.data.parsed.value : []
  const currencyOf = (login: string) => accounts.find((account) => account.login === login)?.currency ?? null

  return (
    <Section>
      <div className="k-demo k-narrow">
        <PageHeader title="Activity" meta="Trades closed, deposits and withdrawals, strategies started and stopped. Newest first; times in UTC." />
        <ClientRead query={activity} what="activity">
          {(items) =>
            items.length ? (
              byDay(items).map((group) => (
                <Card key={group.day} title={group.day}>
                  <ActivityList items={group.items} currencyOf={currencyOf} showAccount={accounts.length > 1} />
                </Card>
              ))
            ) : (
              <Card>
                <EmptyState title="Nothing has happened yet">Trades, deposits and withdrawals, and strategies started or stopped show here, newest first.</EmptyState>
              </Card>
            )
          }
        </ClientRead>
      </div>
    </Section>
  )
}
