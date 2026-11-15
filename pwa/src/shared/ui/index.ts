/**
 * The redesign's component kit (docs/fund-app-redesign-plan.md, section 8, in Beyond-Bot-Bybit): the website's
 * palette and type, calmer for daily data. Paper surfaces, sentence case, 2 px rules, the hard shadow only on
 * the main action. Styles in src/styles/kit.css (`k-` classes), so nothing here changes today's screens; they
 * move to it in step 3. `#/design` shows every piece in development builds.
 */
export { Button, ButtonLink } from './Button.tsx'
export { ConfirmWithCode } from './ConfirmWithCode.tsx'
export { Change, KeyFigure, Stat } from './figures.tsx'
export { Card, PageHeader, type Crumb } from './layout.tsx'
export { Badge, Banner, EmptyState, type Tone } from './status.tsx'
export { DataTable, type Column } from '../../components/DataTable.tsx'
