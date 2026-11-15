import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useTitle } from '../../hooks/env.ts'
import { cx } from './cx.ts'

export type Crumb = { label: string; to?: string }

/**
 * A working screen's header: a sentence-case title (it names the window too), an optional line under it, and
 * the screen's one main action beside it. Replaces the hero (kicker, 72 px uppercase title, lead paragraph) on
 * every screen but the client's Home and the staff's Overview.
 */
export function PageHeader({
  title,
  meta,
  actions,
  crumbs,
}: {
  title: string
  meta?: ReactNode
  actions?: ReactNode
  crumbs?: Crumb[]
}) {
  useTitle(title)
  return (
    <header className="k-page-head">
      {crumbs?.length ? (
        <nav className="k-crumbs" aria-label="Breadcrumb">
          {crumbs.map((crumb) => (
            <span key={crumb.label}>
              {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : crumb.label}
              <span aria-hidden="true"> / </span>
            </span>
          ))}
        </nav>
      ) : null}
      <div className="k-page-head-row">
        <h1 className="k-title">{title}</h1>
        {actions ? <div className="k-actions">{actions}</div> : null}
      </div>
      {meta ? <p className="k-meta">{meta}</p> : null}
    </header>
  )
}

/** A paper surface for data: a region named by its title when it has one, with actions on the title's line. */
export function Card({
  title,
  level = 2,
  actions,
  children,
  className,
}: {
  title?: string
  level?: 2 | 3
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const id = useId()
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <section className={cx('k-card', className)} aria-labelledby={title ? id : undefined}>
      {title || actions ? (
        <div className="k-card-head">
          {title ? (
            <Heading className="k-card-title" id={id}>
              {title}
            </Heading>
          ) : null}
          {actions ? <div className="k-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
