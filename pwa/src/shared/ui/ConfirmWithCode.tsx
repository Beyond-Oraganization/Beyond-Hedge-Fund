import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from './Button.tsx'

const DIGITS = 6

/**
 * The last step before an action on real money: the 6-digit code from the person's code app (TOTP), asked again
 * even though they signed in with one. The field takes what a phone offers (`one-time-code`) or a pasted code
 * with spaces or dashes, and the action stays disabled until six digits are in. The server checks the code; a
 * refusal comes back as `error`.
 */
export function ConfirmWithCode({
  confirmLabel,
  onConfirm,
  busy,
  error,
  children,
}: {
  confirmLabel: string
  onConfirm: (code: string) => void
  busy?: boolean
  error?: string | null
  /** What is about to happen, said once more above the field. */
  children?: ReactNode
}) {
  const [code, setCode] = useState('')
  const id = useId()
  const complete = code.length === DIGITS
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (complete && !busy) onConfirm(code)
  }
  return (
    <form className="k-code" onSubmit={submit} noValidate>
      {children ? <div className="k-code-what">{children}</div> : null}
      <div className="k-field">
        <label htmlFor={`${id}-code`}>6-digit code</label>
        <input
          id={`${id}-code`}
          className="k-code-input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          spellCheck={false}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, DIGITS))}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        />
        <span className="k-hint" id={`${id}-hint`}>
          From your code app, for Beyond Hedge Fund.
        </span>
        {error ? (
          <span className="k-field-error" id={`${id}-error`}>
            {error}
          </span>
        ) : null}
      </div>
      <Button type="submit" variant="primary" busy={busy} disabled={!complete}>
        {confirmLabel}
      </Button>
    </form>
  )
}
