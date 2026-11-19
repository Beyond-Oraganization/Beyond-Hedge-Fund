import { useId, useState } from 'react'
import {
  CURRENCIES,
  isPlain,
  quoteOf,
  type ConditionErrors,
  type ConditionsForm,
  type MarketCosts,
} from '../../backtest/conditions.ts'
import type { FillAt } from '../../engine/types.ts'
import { describedBy, Field, Segmented } from '../Field.tsx'

const FILLS: { value: FillAt; label: string }[] = [
  { value: 'Close', label: 'The signal’s close' },
  { value: 'NextOpen', label: 'The next candle’s open' },
]

const COSTS: { key: keyof MarketCosts; label: string; hint: string }[] = [
  {
    key: 'spread',
    label: 'Bid–ask spread',
    hint: 'Ask minus bid, in the price’s units: 0.30 for gold. Each fill pays half.',
  },
  { key: 'slippage', label: 'Slippage', hint: 'How much worse each fill is on top, in the price’s units.' },
  {
    key: 'commission',
    label: 'Commission, % a side',
    hint: 'Of what the position is worth, when it opens and when it closes.',
  },
  {
    key: 'swapLong',
    label: 'Swap long, % a year',
    hint: 'As the broker lists it: −4 charges 4 % a year. Charged every night held.',
  },
  { key: 'swapShort', label: 'Swap short, % a year', hint: 'The same for a short.' },
]

/**
 * How much like the broker a backtest trades: the market's costs (remembered on this device per market), when a signal
 * fills, whether it holds no more positions than a live budget, and the currency it is measured in. Closed while nothing
 * is set, so the form stays as short as it was.
 */
export function ConditionsFields({
  form,
  onChange,
  errors,
  symbol,
  route,
  withCurrency = true,
}: {
  form: ConditionsForm
  onChange: (form: ConditionsForm) => void
  errors: ConditionErrors
  symbol: string
  /** How the chosen currency is reached ("÷ EURUSD 4h"), or why it cannot be; null while unknown or for the market's own. */
  route: { text: string; ok: boolean } | null
  /** False for a leg of a combined backtest, whose currency is the combined one. */
  withCurrency?: boolean
}) {
  const base = useId()
  const currencyId = `${base}-currency`
  const budgetId = `${base}-budget`
  const quote = quoteOf(symbol)
  const set = (change: Partial<ConditionsForm>) => onChange({ ...form, ...change })
  // Open once conditions are set (typed, or restored from a saved run) or wrong; closed only by the person.
  const wanted = !isPlain(form) || Object.keys(errors).length > 0
  const [open, setOpen] = useState(wanted)
  const [wasWanted, setWasWanted] = useState(wanted)
  if (wanted !== wasWanted) {
    setWasWanted(wanted)
    if (wanted) setOpen(true)
  }
  const routeError = form.currency && route && !route.ok ? route.text : undefined
  const routeHint = routeError
    ? undefined
    : form.currency
      ? (route?.text ?? 'Working out which markets convert it…')
      : `Every amount in ${quote ?? 'the market’s own currency'}, as before.`
  return (
    <details className="more-box" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Costs and conditions</summary>
      <div className="stack">
        <p className="hint">
          Left empty, a backtest pays nothing and fills at the signal’s close, as it always did. The costs are
          remembered on this device for {symbol || 'each market'}; take them from the broker’s tables.
        </p>
        <div className="form-grid">
          {COSTS.map(({ key, label, hint }) => {
            const id = `${base}-${key}`
            return (
              <Field key={key} id={id} label={label} hint={hint} error={errors[key]}>
                <input
                  id={id}
                  className="mono"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={form[key]}
                  onChange={(event) => set({ [key]: event.target.value })}
                  aria-invalid={errors[key] ? true : undefined}
                  aria-describedby={describedBy(id, hint, errors[key])}
                />
              </Field>
            )
          })}
        </div>
        <Segmented
          name={`${base}-fill`}
          legend="Fill at"
          value={form.fill}
          onChange={(fill) => set({ fill })}
          options={FILLS}
          hint="Live trading fills a moment after the candle closes; the next candle’s open is closer to that."
        />
        <div className="field">
          <label className="check" htmlFor={budgetId}>
            <input
              id={budgetId}
              type="checkbox"
              checked={form.budgeted}
              onChange={(event) => set({ budgeted: event.target.checked })}
              aria-describedby={`${budgetId}-hint`}
            />
            Trade like a live budget of the starting balance
          </label>
          <p className="hint" id={`${budgetId}-hint`}>
            No more positions open at once than the budget has room for, as a session with a budget trades: percent:30
            holds 3. The signals it skips are counted.
          </p>
        </div>
        {withCurrency ? (
          <Field id={currencyId} label="Measured in" hint={routeHint} error={routeError}>
            <select
              id={currencyId}
              value={form.currency}
              onChange={(event) => set({ currency: event.target.value })}
              aria-invalid={routeError ? true : undefined}
              aria-describedby={describedBy(currencyId, routeHint, routeError)}
            >
              <option value="">The market’s own{quote ? ` (${quote})` : ''}</option>
              {CURRENCIES.filter((currency) => currency !== quote).map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
    </details>
  )
}
