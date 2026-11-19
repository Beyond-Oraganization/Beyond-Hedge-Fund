import { NavLink } from 'react-router'

const TABS = [
  { to: '/backtest', label: 'One strategy', end: true },
  { to: '/backtest/combined', label: 'Several strategies', end: false },
]

/** One strategy · Several strategies: the kinds of backtest, as links that look like the app's segmented choices. */
export function BacktestTabs() {
  return (
    <nav className="seg backtest-tabs" aria-label="Kind of backtest">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end}>
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
