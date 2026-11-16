import { useParams } from 'react-router'
import { Section } from '../../components/ui.tsx'
import { fmtMoney, fmtSignedMoney } from '../../format.ts'
import { Banner, Button, ButtonLink, Change, DataTable, type Column } from '../../shared/ui/index.ts'
import { useTitle } from '../../hooks/env.ts'
import { ClientRead } from '../portfolio/ClientRead.tsx'
import { isMonth, monthName, useStatement, type AccountStatement, type Statement as StatementData, type StatementStrategy, type StatementTrade } from './statements.ts'

/** "31 Oct 2026". */
const day = (at: string) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
/** "31 Oct 2026, 14:00 UTC". */
const moment = (at: string) => `${day(at)}, ${new Date(at).toISOString().slice(11, 16)} UTC`
const percent = (fraction: number | null) => (fraction == null ? null : fraction * 100)
const size = (quantity: number) => quantity.toLocaleString('en-GB', { maximumFractionDigits: 8 })

/** The money in a row of the summary: plain, or signed for what was made. */
function Figure({ value, currency, signed = false }: { value: number | null; currency: string; signed?: boolean }) {
  return <>{signed ? <Change kind="money" value={value} currency={currency} /> : fmtMoney(value, currency)}</>
}

/** One account's month (or the accounts of one currency added up): the value as it began and ended, and what moved it. */
function Summary({ title, currency, opening, openingAt, closing, closingAt, deposits, withdrawals, change, monthReturn, statement }: {
  title: string
  currency: string
  opening: number | null
  openingAt?: string | null
  closing: number | null
  closingAt?: string | null
  deposits: number
  withdrawals: number
  change: number | null
  monthReturn?: number | null
  statement: StatementData
}) {
  const began = openingAt && Date.parse(openingAt) > Date.parse(statement.from) ? `Value on ${day(openingAt)}, when recording began` : `Value as the month began`
  const ended = statement.isComplete ? 'Value as the month ended' : `Value on ${day(closingAt ?? statement.to)}`
  return (
    <section className="k-statement-block" aria-label={title}>
      <h2 className="k-statement-h">{title}</h2>
      <table className="k-statement-sum">
        <tbody>
          <tr>
            <th scope="row">{began}</th>
            <td>{fmtMoney(opening, currency)}</td>
          </tr>
          <tr>
            <th scope="row">Deposits</th>
            <td>{deposits ? `+${fmtMoney(deposits, currency)}` : fmtMoney(0, currency)}</td>
          </tr>
          <tr>
            <th scope="row">Withdrawals</th>
            <td>{withdrawals ? `-${fmtMoney(withdrawals, currency)}` : fmtMoney(0, currency)}</td>
          </tr>
          <tr>
            <th scope="row">What trading made</th>
            <td>
              <Figure value={change} currency={currency} signed />
            </td>
          </tr>
          <tr className="k-statement-total">
            <th scope="row">{ended}</th>
            <td>{fmtMoney(closing, currency)}</td>
          </tr>
          {monthReturn !== undefined ? (
            <tr>
              <th scope="row">Return for the month</th>
              <td>
                <Change kind="percent" value={percent(monthReturn)} />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  )
}

const strategyColumns = (currency: string): Column<StatementStrategy>[] => [
  { key: 'name', header: 'Strategy', render: (s) => s.name ?? 'Placed by the fund', card: 'title' },
  { key: 'trades', header: 'Closed', render: (s) => s.trades, align: 'right' },
  { key: 'wins', header: 'Gains', render: (s) => s.wins, align: 'right' },
  { key: 'losses', header: 'Losses', render: (s) => s.losses, align: 'right' },
  { key: 'result', header: 'Result', render: (s) => <Change kind="money" value={s.result} currency={currency} />, align: 'right' },
]

const tradeColumns = (currency: string): Column<StatementTrade>[] => [
  { key: 'closed', header: 'Closed', render: (t) => day(t.closedAt), card: 'sub' },
  { key: 'market', header: 'Market', render: (t) => `${t.symbol} ${t.side}`, card: 'title' },
  { key: 'size', header: 'Size', render: (t) => size(t.quantity), align: 'right' },
  { key: 'strategy', header: 'Strategy', render: (t) => t.strategy ?? 'By the fund' },
  { key: 'result', header: 'Result', render: (t) => <Change kind="money" value={t.result} currency={currency} />, align: 'right' },
]

function AccountDetail({ account, named, statement }: { account: AccountStatement; named: boolean; statement: StatementData }) {
  const currency = account.currency ?? ''
  const prefix = named ? `Account ${account.login}: ` : ''
  return (
    <>
      <Summary
        title={named ? `Account ${account.login}${currency ? `, in ${currency}` : ''}` : `Your account${currency ? `, in ${currency}` : ''}`}
        currency={currency}
        opening={account.opening}
        openingAt={account.openingAt}
        closing={account.closing}
        closingAt={account.closingAt}
        deposits={account.deposits}
        withdrawals={account.withdrawals}
        change={account.change}
        monthReturn={account.return}
        statement={statement}
      />
      {!account.cashFlowsConfirmed ? (
        <p className="k-statement-note">
          <strong>Return not confirmed yet.</strong> The fund has not yet checked this month’s deposits and withdrawals with the broker, so a deposit could still show as a gain.
        </p>
      ) : null}

      <section className="k-statement-block" aria-label={`${prefix}strategies`}>
        <h2 className="k-statement-h">{prefix}By strategy</h2>
        {account.strategies.length ? (
          <DataTable columns={strategyColumns(currency)} rows={account.strategies} rowKey={(s) => s.name ?? '(by hand)'} surface="paper" />
        ) : (
          <p className="k-hint">No position closed this month.</p>
        )}
      </section>

      {account.tradeList.length ? (
        <section className="k-statement-block" aria-label={`${prefix}closed positions`}>
          <h2 className="k-statement-h">
            {prefix}Positions closed ({account.trades}: {account.wins} with a gain, {account.losses} with a loss)
          </h2>
          <DataTable columns={tradeColumns(currency)} rows={account.tradeList} rowKey={(t, index) => `${t.closedAt}-${index}`} surface="paper" />
          <p className="k-hint">Results are after the broker’s charges. Altogether: {fmtSignedMoney(account.realized, currency)}.</p>
        </section>
      ) : null}

      <section className="k-statement-block" aria-label={`${prefix}deposits and withdrawals`}>
        <h2 className="k-statement-h">{prefix}Deposits and withdrawals</h2>
        {account.cashFlows.length ? (
          <ul className="k-statement-list">
            {account.cashFlows.map((flow) => (
              <li key={`${flow.at}-${flow.amount}`}>
                <span>{moment(flow.at)}</span>
                <span>
                  {flow.amount >= 0 ? 'Deposit' : 'Withdrawal'}
                  {flow.note ? `: ${flow.note}` : ''}
                </span>
                <span className="k-statement-num">{fmtSignedMoney(flow.amount, currency)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="k-hint">None this month.</p>
        )}
      </section>

      {account.events.length ? (
        <section className="k-statement-block" aria-label={`${prefix}strategies started and stopped`}>
          <h2 className="k-statement-h">{prefix}Strategies started and stopped</h2>
          <ul className="k-statement-list">
            {account.events.map((event) => (
              <li key={`${event.at}-${event.text}`}>
                <span>{moment(event.at)}</span>
                <span>{event.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}

/** The statement itself: what prints. */
function StatementDocument({ statement }: { statement: StatementData }) {
  const named = statement.accounts.length > 1
  const period = statement.isComplete ? `${day(statement.from)} to ${day(new Date(Date.parse(statement.to) - 1).toISOString())}` : `${day(statement.from)} to ${moment(statement.to)}, so far`
  return (
    <article className="k-statement" aria-labelledby="statement-title">
      <header className="k-statement-head">
        <p className="k-statement-brand">Beyond Hedge Fund</p>
        <h1 id="statement-title" className="k-statement-title">
          Statement for {monthName(statement.month)}
        </h1>
        <dl className="k-facts">
          <dt>Client</dt>
          <dd>{statement.client}</dd>
          <dt>Period</dt>
          <dd>{period}</dd>
          <dt>Made</dt>
          <dd>{statement.generatedAt ? moment(statement.generatedAt) : '–'}</dd>
        </dl>
      </header>

      {!statement.isComplete ? (
        <p className="k-statement-note">
          <strong>This month is not over.</strong> The figures are so far and will change until it ends.
        </p>
      ) : null}

      {statement.accounts.length === 0 ? <p>No account is linked to this client.</p> : null}

      {named
        ? statement.totals
            .filter((total) => total.accounts > 1)
            .map((total) => (
              <Summary
                key={total.currency}
                title={`All your accounts in ${total.currency}`}
                currency={total.currency}
                opening={total.opening}
                closing={total.closing}
                deposits={total.deposits}
                withdrawals={total.withdrawals}
                change={total.change}
                statement={statement}
              />
            ))
        : null}

      {statement.accounts.map((account) => (
        <AccountDetail key={account.login} account={account} named={named} statement={statement} />
      ))}

      <footer className="k-statement-foot">
        <p>
          Deposits and withdrawals are not counted as gains or losses: the return for the month is time-weighted, so it shows how the money that was invested did. “What trading made” is the value as the month ended, less the value as it began and the money moved in and out.
        </p>
        <p>Times are in UTC. Values are recorded every hour, including open positions at their price then.</p>
      </footer>
    </article>
  )
}

/**
 * A month's statement, ready to print (docs/fund-app-redesign-plan.md, step 17): the browser's Print turns it into a PDF.
 * At `/me/statements/:month` a client sees their own; at `/clients/:id/statements/:month` staff see that client's.
 */
export default function Statement() {
  const { id, month } = useParams()
  const client = id != null && /^\d+$/.test(id) ? Number(id) : undefined
  const valid = isMonth(month)
  const statement = useStatement(valid ? month : null, client)
  const name = valid ? monthName(month) : 'Statement'
  useTitle(`Statement, ${name}`)
  const back = client != null ? { label: 'Back to the client', to: `/clients/${client}` } : { label: 'Back to your account', to: '/me' }

  return (
    <Section>
      <div className="k-demo k-narrow">
        <div className="k-statement-tools k-noprint">
          <ButtonLink to={back.to} variant="quiet" icon="back">
            {back.label}
          </ButtonLink>
          {valid && statement.data?.parsed.ok ? (
            <Button variant="primary" onClick={() => window.print()}>
              Print or save as PDF
            </Button>
          ) : null}
        </div>
        {valid && statement.data?.parsed.ok ? null : <h1 className="vh">{`Statement for ${name}`}</h1>}
        {!valid ? (
          <Banner tone="warn" title={`“${month ?? ''}” is not a month`} action={<ButtonLink to={back.to}>{back.label}</ButtonLink>} />
        ) : (
          <ClientRead query={statement} what="statement">
            {(data) => <StatementDocument statement={data} />}
          </ClientRead>
        )}
      </div>
    </Section>
  )
}
