import { Link } from 'react-router'
import { Card } from '../../shared/ui/index.ts'
import { ClientRead } from '../portfolio/ClientRead.tsx'
import { monthName, useStatementMonths } from './statements.ts'

/**
 * Statements by month (plan, section 7): one link per month, newest first, to the month's printable statement. `client`
 * is staff's choice of client; a client's own when left out. `base`: where the statement pages are (`/me/statements` for a
 * client, `/clients/1/statements` for staff).
 */
export function StatementsCard({ client, base }: { client?: number; base: string }) {
  const months = useStatementMonths(client)
  const thisMonth = new Date().toISOString().slice(0, 7)
  return (
    <Card title="Statements">
      <ClientRead query={months} what="statements">
        {({ months: all }) =>
          all.length ? (
            <>
              <ul className="k-months">
                {all.map((month) => (
                  <li key={month}>
                    <Link to={`${base}/${month}`}>{monthName(month)}</Link>
                    {month === thisMonth ? <span className="k-hint"> (so far)</span> : null}
                  </li>
                ))}
              </ul>
              <p className="k-hint">Each statement opens as a page you can print or save as a PDF.</p>
            </>
          ) : (
            <p className="k-hint">The first statement shows here once the fund has recorded your account’s value.</p>
          )
        }
      </ClientRead>
    </Card>
  )
}
