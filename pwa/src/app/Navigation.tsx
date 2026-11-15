import { useId } from 'react'
import { Link, useLocation } from 'react-router'
import { Icon } from '../components/Icon.tsx'
import { itemAt, sectionOf, type NavSection } from './nav.ts'

/**
 * The app's navigation, in three pieces the stylesheet shows by width: on a computer (from 1,024 px) a sidebar
 * with every screen under its section; on a phone a bottom bar of sections, and the open section's screens as
 * tabs above the page.
 */

/** Computers: each section's screens, under the section's name. */
export function SideNav({ sections }: { sections: NavSection[] }) {
  const { pathname } = useLocation()
  const current = itemAt(sections, pathname)
  return (
    <nav className="side" aria-label="Main navigation">
      {sections.map((section) => (
        <SideGroup key={section.id} section={section} current={current?.to} />
      ))}
    </nav>
  )
}

function SideGroup({ section, current }: { section: NavSection; current?: string }) {
  const id = useId()
  return (
    <div className="side-group">
      <p className="side-label" id={id}>
        <Icon name={section.icon} />
        {section.label}
      </p>
      <ul aria-labelledby={id}>
        {section.items.map((item) => (
          <li key={item.to}>
            <Link to={item.to} aria-current={item.to === current ? 'page' : undefined}>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Phones: one tab per section; a section opens at its first screen. */
export function BottomNav({ sections }: { sections: NavSection[] }) {
  const { pathname } = useLocation()
  const open = sectionOf(sections, pathname)
  return (
    <nav className="bnav" aria-label="Sections" style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}>
      {sections.map((section) => (
        <Link key={section.id} to={section.items[0]!.to} aria-current={section === open ? 'page' : undefined}>
          <Icon name={section.icon} />
          {section.label}
        </Link>
      ))}
    </nav>
  )
}

/** Phones: the open section's screens, as tabs at the top of the page. */
export function SectionTabs({ sections }: { sections: NavSection[] }) {
  const { pathname } = useLocation()
  const open = sectionOf(sections, pathname)
  if (!open) return null
  const current = itemAt(sections, pathname)
  return (
    <nav className="subnav" aria-label={`${open.label} screens`}>
      {open.items.map((item) => (
        <Link key={item.to} to={item.to} aria-current={item.to === current?.to ? 'page' : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  )
}
