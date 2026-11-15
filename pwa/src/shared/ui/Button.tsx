import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import { Icon, type IconName } from '../../components/Icon.tsx'
import { cx } from './cx.ts'

type Look = {
  /** primary: the screen's one main action (the only one with the hard shadow); danger: stops or removes. */
  variant?: 'primary' | 'secondary' | 'danger' | 'quiet'
  /** large: the main action on a phone screen (56 px); the default is 44 px. */
  size?: 'default' | 'large'
  icon?: IconName
}

const classes = ({ variant = 'secondary', size = 'default' }: Look, className?: string) =>
  cx('k-btn', `k-btn-${variant}`, size === 'large' && 'k-btn-large', className)

/** A button in sentence case. While `busy`, it shows so and cannot be pressed again. */
export function Button({
  variant,
  size,
  icon,
  busy,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & Look & { busy?: boolean }) {
  return (
    <button
      type={type}
      className={classes({ variant, size }, className)}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

/** A link that looks like a button, for actions that go to another screen. */
export function ButtonLink({ to, variant, size, icon, children }: Look & { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={classes({ variant, size })}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </Link>
  )
}
