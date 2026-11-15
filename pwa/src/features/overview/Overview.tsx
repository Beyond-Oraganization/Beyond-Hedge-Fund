import { Link } from 'react-router'
import { Section } from '../../components/ui.tsx'
import { fmtMoney } from '../../format.ts'
import { Badge, Card, Change, KeyFigure, PageHeader, Stat, type Tone } from '../../shared/ui/index.ts'
import { ClientRead } from '../portfolio/ClientRead.tsx'
import { placeOf, useOverview, type OverviewAlert, type Severity } from './overview.ts'

const SEVERITY: Record<Severity, { tone: Tone; words: string }> = {
  error: { tone: 'error', words: 'Error' },
  warn: { tone: 'warn', words: 'Check' },
  info: { tone: 'neutral', words: 'Note' },
}

function Alert({ alert }: { alert: OverviewAlert }) {
  const place = placeOf(alert)
  return (
    <li className="k-alert">
      <Badge tone={SEVERITY[alert.severity].tone}>{SEVERITY[alert.severity].words}</Badge>
      <span className="k-feed-text">{alert.text}</span>
      {place ? (
        <Link className="k-alert-link" to={place.to}>
          {place.label}
        </Link>
      ) : null}
    </li>
  )
}

/**
 * Staff's and the owner's first screen (docs/fund-app-redesign-plan.md, section 7): money under management and today's
 * result per currency, the fund's size, and what needs attention, each with the place to fix it. Errors come first.
 */
export default function Overview() {
  const overview = useOverview()
  return (
    <Section>
      <div className="k-demo">
        <PageHeader title="Overview" meta={overview.data?.parsed.ok && overview.data.parsed.value.at ? `As of ${new Date(overview.data.parsed.value.at).toISOString().slice(11, 16)} UTC. Today starts at midnight UTC; deposits and withdrawals are left out.` : undefined} />
        <ClientRead query={overview} what="overview">
          {(fund) => (
            <>
              {fund.totals.length ? (
                <div className="k-totals">
                  {fund.totals.map((total) => (
                    <Card key={total.currency}>
                      <KeyFigure label={`Under management, ${total.currency}`} value={fmtMoney(total.value, total.currency)}>
                        <Stat label="Today" value={<Change kind="money" value={total.today} currency={total.currency} />} />
                        <Stat label="Accounts" value={total.accounts} />
                      </KeyFigure>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <p className="k-hint">No account has a recorded value yet: the fund records each managed account’s value every hour.</p>
                </Card>
              )}
              {fund.totals.length > 1 ? <p className="k-hint">Each currency is shown on its own: accounts in different currencies are not added up.</p> : null}
              <Card>
                <div className="k-stats">
                  <Stat label="Clients" value={<Link to="/clients" aria-label={`${fund.clients} clients: open Clients`}>{fund.clients}</Link>} />
                  <Stat label="Managed accounts" value={fund.accounts} />
                  <Stat label="Strategy sessions" value={<Link to="/trading" aria-label={`${fund.sessions} strategy sessions: open Trading`}>{fund.sessions}</Link>} />
                </div>
              </Card>
              <Card title="Needs attention">
                {fund.alerts.length ? (
                  <ul className="k-feed">
                    {fund.alerts.map((alert, index) => (
                      <Alert key={`${alert.kind}-${alert.account ?? alert.client ?? ''}-${alert.session ?? ''}-${index}`} alert={alert} />
                    ))}
                  </ul>
                ) : (
                  <p className="k-hint">Nothing needs attention: every session ticked, every account is open and valued, every client is set up.</p>
                )}
              </Card>
            </>
          )}
        </ClientRead>
      </div>
    </Section>
  )
}
