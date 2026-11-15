import type { ReactNode } from 'react'
import { cx } from './cx.ts'

export type Tone = 'neutral' | 'ok' | 'warn' | 'error'

/** Each tone's symbol, so a status never rests on its colour alone. */
const SYMBOL: Record<Tone, string> = { neutral: '·', ok: '●', warn: '!', error: '×' }

/** A short status beside a name: "All running", "Room full", "Live". */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('k-badge', `k-${tone}`)}>
      <span className="k-badge-symbol" aria-hidden="true">
        {SYMBOL[tone]}
      </span>
      {children}
    </span>
  )
}

/**
 * A message about the whole screen or the app. Only an error interrupts a screen reader (role="alert"); the
 * others wait their turn (role="status").
 */
export function Banner({
  tone = 'neutral',
  title,
  children,
  action,
}: {
  tone?: Tone | 'info'
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  const shown: Tone = tone === 'info' ? 'neutral' : tone
  return (
    <div className={cx('k-banner', `k-${shown}`)} role={shown === 'error' ? 'alert' : 'status'}>
      <span className="k-banner-symbol" aria-hidden="true">
        {SYMBOL[shown]}
      </span>
      <div className="k-banner-text">
        <p className="k-banner-title">{title}</p>
        {children ? <div className="k-banner-body">{children}</div> : null}
      </div>
      {action ? <div className="k-actions">{action}</div> : null}
    </div>
  )
}

/** What a list or a screen shows before it has anything: what will be here, and how to add the first one. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="k-empty">
      <p className="k-empty-title">{title}</p>
      {children ? <div className="k-empty-body">{children}</div> : null}
      {action ? <div className="k-actions">{action}</div> : null}
    </div>
  )
}
