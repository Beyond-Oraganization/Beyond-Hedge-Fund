import { Section } from '../../components/ui.tsx'
import { fmtMoney } from '../../format.ts'
import { useTitle } from '../../hooks/env.ts'
import { Banner, ButtonLink, Card, Change, EmptyState, KeyFigure, Stat } from '../../shared/ui/index.ts'
import { ActivityList } from './ActivityList.tsx'
import { ClientRead } from './ClientRead.tsx'
import { cashFlowsUnconfirmed, useActivity, usePortfolio, type AccountPortfolio } from './portfolio.ts'
import { shortDate, ValueChart } from './ValueChart.tsx'

/** A return as the kit's Change shows it: the bot's fraction (0.021) in percent units (2.1). */
const percent = (fraction: number | null) => (fraction == null ? null : fraction * 100)

/** "14:00 UTC today" or "7 Nov, 14:00 UTC". */
function valuedWhen(at: string, now = Date.now()) {
  const time = `${new Date(at).toISOString().slice(11, 16)} UTC`
  return at.slice(0, 10) === new Date(now).toISOString().slice(0, 10) ? `${time} today` : `${shortDate(at)}, ${time}`
}

function AccountValue({ account, named }: { account: AccountPortfolio; named: boolean }) {
  const currency = account.currency ?? ''
  if (account.value == null)
    return (
      <Card title={named ? `Account ${account.login}` : undefined}>
        <EmptyState title="Your portfolio is being set up">
          The fund records your account’s value every hour. It shows here after the first one.
        </EmptyState>
      </Card>
    )
  const first = account.series[0]
  return (
    <>
      <Card title={named ? `Account ${account.login}` : undefined}>
        <KeyFigure label="Your portfolio" value={fmtMoney(account.value, currency)}>
          <Stat label="Today" value={<Change kind="percent" value={percent(account.returns.today)} />} />
          <Stat label="This month" value={<Change kind="percent" value={percent(account.returns.month)} />} />
          <Stat label="Since joining" value={<Change kind="percent" value={percent(account.returns.sinceStart)} />} />
        </KeyFigure>
        <p className="k-hint">
          Deposits and withdrawals are not counted as gains or losses.{account.valuedAt ? ` Value at ${valuedWhen(account.valuedAt)}.` : ''}
        </p>
      </Card>
      {cashFlowsUnconfirmed(account) ? (
        <Banner tone="info" title="Deposits not confirmed yet">
          The fund has not checked this account’s latest deposits and withdrawals with the broker. Until it does, a recent deposit may show as a gain.
        </Banner>
      ) : null}
      <Card title="Value since joining" level={named ? 3 : 2} actions={first ? <span className="k-hint">{shortDate(first.date)} to today</span> : null}>
        {account.series.length >= 2 ? (
          <ValueChart series={account.series} currency={account.currency} title={`Value of account ${account.login} since joining`} />
        ) : (
          <EmptyState title="The chart starts tomorrow">It shows one value a day, so it needs two days.</EmptyState>
        )}
      </Card>
    </>
  )
}

/**
 * A client's Home (docs/fund-app-redesign-plan.md, section 7): one answer first, what the money is worth and how it did,
 * with deposits left out of the returns and marked on the chart; then the latest of what happened.
 */
export default function Home() {
  useTitle('Home')
  const portfolio = usePortfolio()
  const activity = useActivity(5)
  const currencyOf = (login: string) => portfolio.data?.parsed.ok ? (portfolio.data.parsed.value.find((a) => a.login === login)?.currency ?? null) : null

  return (
    <Section>
      <div className="k-demo k-narrow">
        <h1 className="vh">Home</h1>
        <ClientRead query={portfolio} what="portfolio">
          {(accounts) =>
            accounts.length === 0 ? (
              <Card>
                <EmptyState title="No account is linked to you yet">The fund links your account at the broker for you. It shows here once it is linked.</EmptyState>
              </Card>
            ) : (
              accounts.map((account) => <AccountValue key={account.login} account={account} named={accounts.length > 1} />)
            )
          }
        </ClientRead>
        <Card title="Latest" actions={<ButtonLink to="/activity" variant="quiet">All activity</ButtonLink>}>
          <ClientRead query={activity} what="activity">
            {(items) =>
              items.length ? (
                <ActivityList items={items.slice(0, 3)} currencyOf={currencyOf} stamp="day" />
              ) : (
                <p className="k-hint">Nothing has happened on your account yet. Trades, deposits and strategies show here.</p>
              )
            }
          </ClientRead>
        </Card>
      </div>
    </Section>
  )
}
