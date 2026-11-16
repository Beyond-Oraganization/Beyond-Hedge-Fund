import { fmtSignedMoney } from '../../format.ts'
import { Change } from '../../shared/ui/index.ts'
import type { ActivityItem } from './portfolio.ts'
import { plainActivity } from './words.ts'

/** "14:02" (UTC). */
const clock = (at: string) => new Date(at).toISOString().slice(11, 16)

/** "Today", "Yesterday", or "Fri 7 Nov" (UTC days, like the returns' "today"). */
export function dayName(at: string, now = Date.now()): string {
  const day = at.slice(0, 10)
  const today = new Date(now).toISOString().slice(0, 10)
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10)
  if (day === today) return 'Today'
  if (day === yesterday) return 'Yesterday'
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** The items of one day, or a few of the latest: time, what happened in a client's words, and the money it made or moved. */
export function ActivityList({
  items,
  currencyOf = () => null,
  showAccount = false,
  stamp = 'time',
}: {
  items: ActivityItem[]
  /** The time of day (the items of one day), or the day (a few of the latest, from several days). */
  stamp?: 'time' | 'day'
  /** Each account's currency, from the portfolio (the activity names only the account). */
  currencyOf?: (account: string) => string | null
  showAccount?: boolean
}) {
  return (
    <ul className="k-feed">
      {items.map((item, index) => (
        <li key={`${item.at}-${index}`}>
          <time className="k-feed-time" dateTime={item.at}>
            {stamp === 'day' ? dayName(item.at) : clock(item.at)}
          </time>
          <span className="k-feed-text">
            {plainActivity(item.text)}
            {showAccount ? <span className="k-feed-account"> · {item.account}</span> : null}
          </span>
          {item.amount == null ? null : item.kind === 'close' ? (
            <Change kind="money" value={item.amount} currency={currencyOf(item.account) ?? undefined} />
          ) : (
            <span className="k-feed-amount">{fmtSignedMoney(item.amount, currencyOf(item.account) ?? '')}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Items grouped by their UTC day, newest day first (the bot sends them newest first). */
export function byDay(items: ActivityItem[], now = Date.now()): { day: string; items: ActivityItem[] }[] {
  const groups: { day: string; items: ActivityItem[] }[] = []
  for (const item of items) {
    const day = dayName(item.at, now)
    const last = groups.at(-1)
    if (last?.day === day) last.items.push(item)
    else groups.push({ day, items: [item] })
  }
  return groups
}
