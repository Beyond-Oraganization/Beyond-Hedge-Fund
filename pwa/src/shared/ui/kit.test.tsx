import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Badge, Banner, Button, Card, Change, ConfirmWithCode, PageHeader } from './index.ts'

afterEach(cleanup)

describe('PageHeader', () => {
  it('names the page in its heading and in the window title', () => {
    render(<PageHeader title="Clients" />, { wrapper: MemoryRouter })
    expect(screen.getByRole('heading', { level: 1, name: 'Clients' })).toBeInTheDocument()
    expect(document.title).toBe('Clients · Beyond Bot')
  })

  it('shows the way back when it has breadcrumbs', () => {
    render(<PageHeader title="Client A" crumbs={[{ label: 'Clients', to: '/clients' }]} />, { wrapper: MemoryRouter })
    expect(screen.getByRole('link', { name: 'Clients' })).toHaveAttribute('href', '/clients')
    expect(screen.getByRole('heading', { level: 1, name: 'Client A' })).toBeInTheDocument()
  })
})

describe('Card', () => {
  it('is a region named by its title', () => {
    render(<Card title="Needs attention">4 alerts</Card>)
    expect(screen.getByRole('region', { name: 'Needs attention' })).toHaveTextContent('4 alerts')
  })
})

describe('Change', () => {
  it('says a rise in words as well as with the arrow and the colour', () => {
    render(<Change value={1.5} kind="percent" />)
    const change = screen.getByText(/\+1\.50%/)
    expect(change).toHaveClass('k-gain')
    expect(change).toHaveTextContent('▲')
    expect(screen.getByText('up')).toHaveClass('vh')
  })

  it('says a fall the same way, with the currency', () => {
    render(<Change value={-41.3} kind="money" currency="EUR" />)
    const change = screen.getByText(/-41\.30 EUR/)
    expect(change).toHaveClass('k-loss')
    expect(change).toHaveTextContent('▼')
    expect(screen.getByText('down')).toHaveClass('vh')
  })

  it('shows no arrow and no tone for no change', () => {
    render(<Change value={0} kind="percent" />)
    const change = screen.getByText('0.00%')
    expect(change).not.toHaveClass('k-gain')
    expect(change).not.toHaveClass('k-loss')
    expect(change).not.toHaveTextContent(/[▲▼]/)
  })
})

describe('Badge', () => {
  it('marks a warning with a symbol, not with colour alone', () => {
    render(
      <>
        <Badge tone="ok">All running</Badge>
        <Badge tone="warn">Room full</Badge>
      </>,
    )
    const ok = screen.getByText('All running').closest('.k-badge')!
    const warn = screen.getByText('Room full').closest('.k-badge')!
    const symbol = (badge: Element) => badge.querySelector('[aria-hidden="true"]')?.textContent
    expect(symbol(warn)).toBe('!')
    expect(symbol(ok)).not.toBe(symbol(warn))
  })
})

describe('Banner', () => {
  it('interrupts for an error, and only for an error', () => {
    render(
      <>
        <Banner tone="error" title="The bot did not answer">
          Check the address.
        </Banner>
        <Banner tone="info" title="A new version is ready" />
      </>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('The bot did not answer')
    expect(screen.getByRole('status')).toHaveTextContent('A new version is ready')
  })
})

describe('Button', () => {
  it('cannot be pressed twice while its action runs', async () => {
    const onClick = vi.fn()
    render(
      <Button busy onClick={onClick}>
        Save limits
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Save limits' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('ConfirmWithCode', () => {
  const setup = (props: Partial<Parameters<typeof ConfirmWithCode>[0]> = {}) => {
    const onConfirm = vi.fn()
    render(<ConfirmWithCode confirmLabel="Start Euro range" onConfirm={onConfirm} {...props} />)
    return {
      onConfirm,
      input: screen.getByLabelText('6-digit code'),
      button: screen.getByRole('button', { name: 'Start Euro range' }),
    }
  }

  it('asks the phone for a one-time code with a number pad', () => {
    const { input } = setup()
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveAttribute('autocomplete', 'one-time-code')
  })

  it('confirms only once six digits are in, and sends them', async () => {
    const { onConfirm, input, button } = setup()
    await userEvent.type(input, '12345')
    expect(button).toBeDisabled()
    await userEvent.type(input, '6')
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(onConfirm).toHaveBeenCalledWith('123456')
  })

  it('takes a pasted code with a space or a dash in it', async () => {
    const { onConfirm, input } = setup()
    await userEvent.click(input)
    await userEvent.paste('123 456')
    expect(input).toHaveValue('123456')
    await userEvent.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledWith('123456')
  })

  it('shows why a code was refused, next to the field', () => {
    const { input } = setup({ error: 'That code is not the one your code app shows now.' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(/not the one your code app shows/)
  })

  it('cannot be confirmed twice while the first one runs', async () => {
    const { onConfirm, input, button } = setup({ busy: true })
    await userEvent.type(input, '123456')
    expect(button).toBeDisabled()
    await userEvent.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
