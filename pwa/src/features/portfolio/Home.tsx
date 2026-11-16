import { sessionName } from '../../api/session.ts'
import type { TradingSessionState } from '../../api/types.ts'
import { Section } from '../../components/ui.tsx'
import { fmtMoney } from '../../format.ts'
import { useNow, useTitle } from '../../hooks/env.ts'
import { Banner, ButtonLink, Card, Change, EmptyState, KeyFigure, Stat } from '../../shared/ui/index.ts'
import { useMenu, useMySessions } from '../menu/menu.ts'
import { ActivityList } from './ActivityList.tsx'
import { ClientRead } from './ClientRead.tsx'
import { cashFlowsUnconfirmed, useActivity, usePortfolio, type AccountPortfolio } from './portfolio.ts'
import { shortDate, ValueChart } from './ValueChart.tsx'
import { marketName, strategyName } from './words.ts'

/** A return as the kit's Change shows it: the bot's fraction (0.021) in percent units (2.1). */
const percent = (fraction: number | null) => (fraction == null ? null : fraction * 100)

/** "14:00 UTC today" or "7 Nov, 14:00 UTC". */
function valuedWhen(at: string, now = Date.now()) {
  const time = `${new Date(at).toISOString().slice(11, 16)} UTC`
  return at.slice(0, 10) === new Date(now).toISOString().slice(0, 10) ? `${time} today` : `${shortDate(at)}, ${time}`
}

export function AccountValue({ account, named }: { account: AccountPortfolio; named: boolean }) {
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

/** A session whose last tick failed, or that failed since its last tick: the fund has to look at it. */
export const failing = (session: TradingSessionState) =>
  session.lastTick?.outcome === 'Failed' || (session.lastError != null && (!session.lastTick || (session.lastErrorAt ?? '') >= session.lastTick.time))

/** Older than this, the recorded value is late: the fund records it every hour. */
const LATE_MS = 3 * 3600_000

/**
 * "Is anything wrong?" and "What is trading for me?" (plan, section 7): one line that says everything is running, or what
 * needs the fund's attention, and the strategies trading for the client under the menu's names.
 */
function Running({ valuedAt }: { valuedAt: string | null }) {
  const now = useNow(60_000)
  const sessions = useMySessions()
  const menu = useMenu()
  const setups = menu.data?.parsed.ok ? menu.data.parsed.value : []
  return (
    <ClientRead query={sessions} what="strategies">
      {(running) => {
        const troubled = running.filter(failing)
        const late = valuedAt != null && now - Date.parse(valuedAt) > LATE_MS
        return (
          <>
            {troubled.length ? (
              <Banner tone="warn" title={`${troubled.length === 1 ? 'A strategy' : `${troubled.length} strategies`} could not trade just now`}>
                {troubled.map((session) => strategyName(session, setups)).join(', ')}. The fund sees this too and looks after it. Nothing else needs you.
              </Banner>
            ) : late ? (
              <Banner tone="warn" title="Your value is late">
                The fund records it every hour; the last one is from {valuedWhen(valuedAt!, now)}. The fund sees this too.
              </Banner>
            ) : (
              <Banner tone="ok" title="Everything is running">
                {running.length ? 'Your strategies trade as usual.' : 'Nothing trades for you right now.'}
              </Banner>
            )}
            <Card title="Trading for you" actions={<ButtonLink to="/my-strategies" variant="quiet">Strategies</ButtonLink>}>
              {running.length ? (
                <ul className="k-feed">
                  {running.map((session) => (
                    <li key={sessionName(session)} className="k-running">
                      <span className="k-feed-text">
                        <strong>{strategyName(session, setups)}</strong>
                        <span className="k-feed-account"> · {marketName(session.market.symbol)}, since {shortDate(session.startedAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="k-hint">Nothing trades for you right now. Strategies lists what the fund offers you.</p>
              )}
            </Card>
          </>
        )
      }}
    </ClientRead>
  )
}

/**
 * What a client sees on Home: their accounts' value and returns, then the latest of what happened. `only` limits it to
 * some accounts (staff viewing as a client, who reach every managed account themselves); `preview` leaves out the link
 * to the client's Activity, which is the client's place, not staff's.
 */
export function HomeView({ only, preview = false }: { only?: string[]; preview?: boolean }) {
  const portfolio = usePortfolio()
  // Staff reach every account: read more, then keep the client's.
  const activity = useActivity(only ? 50 : 5)
  const mine = <T extends { login?: string; account?: string }>(items: T[]) => (only ? items.filter((item) => only.includes(item.login ?? item.account ?? '')) : items)
  // The newest recorded value of the accounts shown: late when the fund's hourly recording stopped.
  const valuedAt = portfolio.data?.parsed.ok ? (portfolio.data.parsed.value.filter((a) => !only || only.includes(a.login)).map((a) => a.valuedAt).filter((at): at is string => at != null).sort().at(-1) ?? null) : null
  const currencyOf = (login: string) => (portfolio.data?.parsed.ok ? (portfolio.data.parsed.value.find((a) => a.login === login)?.currency ?? null) : null)

  return (
    <>
      <ClientRead query={portfolio} what="portfolio">
        {(all) => {
          const accounts = mine(all)
          return accounts.length === 0 ? (
            <Card>
              <EmptyState title="No account is linked to you yet">The fund links your account at the broker for you. It shows here once it is linked.</EmptyState>
            </Card>
          ) : (
            accounts.map((account) => <AccountValue key={account.login} account={account} named={accounts.length > 1} />)
          )
        }}
      </ClientRead>
      {/* Staff viewing as a client read their own connection's sessions, not the client's: shown on the client's own Home only. */}
      {preview ? null : <Running valuedAt={valuedAt} />}
      <Card title="Latest" actions={preview ? null : <ButtonLink to="/activity" variant="quiet">All activity</ButtonLink>}>
        <ClientRead query={activity} what="activity">
          {(all) => {
            const items = mine(all).slice(0, 3)
            return items.length ? (
              <ActivityList items={items} currencyOf={currencyOf} stamp="day" />
            ) : (
              <p className="k-hint">Nothing has happened on your account yet. Trades, deposits and strategies show here.</p>
            )
          }}
        </ClientRead>
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
  return (
    <Section>
      <div className="k-demo k-narrow">
        <h1 className="vh">Home</h1>
        <HomeView />
      </div>
    </Section>
  )
}
