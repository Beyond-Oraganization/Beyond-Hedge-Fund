import type { ReactNode } from 'react'
import { useTitle } from '../hooks/env.ts'
import { Breadcrumbs, Section } from './ui.tsx'

/**
 * A screen's opening: breadcrumbs, the screen's name as a small label, its status as a sentence-case title, a
 * line about it, and its actions. Compact, so the data starts on the first screen of a phone; it replaced the
 * website-style hero (red kicker, 72 px uppercase title) in step 3 of the redesign. Every head sits on the
 * page's own background.
 */
export function ScreenHead({
  kicker,
  title,
  lead,
  actions,
  crumbs,
  children,
}: {
  kicker: string
  title: string
  lead?: ReactNode
  actions?: ReactNode
  crumbs?: { label: string; to?: string }[]
  children?: ReactNode
}) {
  useTitle(crumbs?.at(-1)?.label ?? kicker)
  return (
    <Section className="sec-head" labelledBy="screen-title">
      {crumbs ? <Breadcrumbs trail={crumbs} /> : null}
      <div className="k-page-head-row">
        <div className="k-head-text">
          <p className="k-label">{kicker}</p>
          <h1 className="k-title" id="screen-title">
            {title}
          </h1>
          {lead ? <div className="k-lead">{lead}</div> : null}
        </div>
        {actions ? <div className="btn-row">{actions}</div> : null}
      </div>
      {children ? <div style={{ marginTop: 20 }}>{children}</div> : null}
    </Section>
  )
}
