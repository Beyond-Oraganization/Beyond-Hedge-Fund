import type { ReactNode } from 'react'
import { fmtSignedMoney, fmtSignedPercent } from '../../format.ts'
import { cx } from './cx.ts'

/**
 * A rise or a fall: "▲ +1.50%" or "▼ -41.30 EUR". The arrow and the colour show it at a glance, and a word
 * ("up", "down") says it to a screen reader, so neither the colour nor the arrow carries it alone.
 * `kind="percent"` takes percent units (1.5 means 1.5%), as the bot's figures do.
 */
export function Change({
  value,
  kind,
  currency,
}: {
  value: number | null | undefined
  kind: 'percent' | 'money'
  currency?: string
}) {
  const text = kind === 'percent' ? fmtSignedPercent(value) : fmtSignedMoney(value, currency)
  const direction = value == null || value === 0 ? null : value > 0 ? 'up' : 'down'
  return (
    <span className={cx('k-change', direction === 'up' && 'k-gain', direction === 'down' && 'k-loss')}>
      {direction ? (
        <>
          <span aria-hidden="true">{direction === 'up' ? '▲' : '▼'} </span>
          <span className="vh">{direction} </span>
        </>
      ) : null}
      {text}
    </span>
  )
}

/** The one number a screen exists for (the portfolio's value, money under management), with smaller ones below. */
export function KeyFigure({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <div className="k-key">
      <p className="k-label">{label}</p>
      <p className="k-key-value">{value}</p>
      {children ? <div className="k-stats">{children}</div> : null}
    </div>
  )
}

/** A labelled number in a row of them. */
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="k-stat">
      <span className="k-stat-label">{label}</span>
      <span className="k-stat-value">{value}</span>
      {sub ? <span className="k-stat-sub">{sub}</span> : null}
    </div>
  )
}
