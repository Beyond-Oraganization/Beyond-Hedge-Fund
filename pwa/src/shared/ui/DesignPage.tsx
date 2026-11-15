import { useState } from 'react'
import { Section } from '../../components/ui.tsx'
import { toast } from '../../components/Toasts.tsx'
import { fmtMoney } from '../../format.ts'
import {
  Badge,
  Banner,
  Button,
  Card,
  Change,
  ConfirmWithCode,
  DataTable,
  EmptyState,
  KeyFigure,
  PageHeader,
  Stat,
  type Column,
} from './index.ts'

/**
 * Every piece of the kit with example data, at `#/design` in development builds only (App.tsx leaves the route
 * out of production). The header's theme button switches between the two themes.
 */
export default function DesignPage() {
  return (
    <Section>
      <div className="k-demo">
        <PageHeader
          title="Design kit"
          crumbs={[{ label: 'Settings', to: '/settings' }]}
          meta="Development builds only. The theme button in the header shows the other theme. Example data."
          actions={<Button variant="primary">Main action</Button>}
        />
        <Colours />
        <Figures />
        <Statuses />
        <Buttons />
        <Table />
        <Card title="Empty state">
          <EmptyState title="No strategy trades for you yet" action={<Button variant="primary">Add a strategy</Button>}>
            Strategies you start from the fund’s menu show here, with their results.
          </EmptyState>
        </Card>
        <Code />
      </div>
    </Section>
  )
}

const SCALES: [string, number][] = [
  ['grey', 8],
  ['gain', 5],
  ['loss', 5],
  ['warn', 5],
]

function Colours() {
  return (
    <Card title="Colours">
      <p className="k-hint">
        Paper for data, greys mixed from the ink into it, and five shades per status: 1–2 tints, 3 borders, 4–5 text.
      </p>
      <div className="k-swatches">
        {['paper', 'c-bg', 'c-fg'].map((name) => (
          <Swatch key={name} name={name} />
        ))}
      </div>
      {SCALES.map(([name, steps]) => (
        <div key={name} className="k-swatches">
          {Array.from({ length: steps }, (_, i) => (
            <Swatch key={i} name={`${name}-${i + 1}`} />
          ))}
        </div>
      ))}
    </Card>
  )
}

const Swatch = ({ name }: { name: string }) => (
  <div className="k-swatch">
    <span style={{ background: `var(--${name})` }} />
    <span>--{name}</span>
  </div>
)

function Figures() {
  return (
    <Card title="Key figure and stats">
      <KeyFigure label="Your portfolio" value={fmtMoney(10420, 'EUR')}>
        <Stat label="Today" value={<Change value={0.4} kind="percent" />} />
        <Stat label="This month" value={<Change value={1.24} kind="percent" />} sub="Deposits not counted" />
        <Stat label="Realized" value={<Change value={-41.3} kind="money" currency="EUR" />} />
        <Stat label="Unchanged" value={<Change value={0} kind="percent" />} />
      </KeyFigure>
    </Card>
  )
}

function Statuses() {
  return (
    <Card title="Badges and banners">
      <div className="k-row">
        <Badge tone="ok">All running</Badge>
        <Badge tone="warn">Room full</Badge>
        <Badge tone="error">Stopped by an error</Badge>
        <Badge>Demo</Badge>
      </div>
      <Banner tone="info" title="A new version is ready" action={<Button>Reload</Button>}>
        It opens where you are.
      </Banner>
      <Banner tone="ok" title="Euro range started">
        It trades on the next hourly candle.
      </Banner>
      <Banner tone="warn" title="EURPLN hourly candles are 17 h old">
        Euro range sessions skip their ticks until the market data is fresh.
      </Banner>
      <Banner tone="error" title="The bot did not answer">
        Check the address, and that port 8443 is open to this device.
      </Banner>
    </Card>
  )
}

function Buttons() {
  return (
    <Card title="Buttons">
      <div className="k-row">
        <Button variant="primary">Start Euro range</Button>
        <Button>View as client</Button>
        <Button variant="danger" icon="stop">
          Stop
        </Button>
        <Button variant="quiet">Keep it running</Button>
      </div>
      <div className="k-row">
        <Button variant="primary" size="large">
          Add a strategy
        </Button>
        <Button busy>Saving…</Button>
        <Button disabled>Not available</Button>
      </div>
    </Card>
  )
}

type ClientRow = {
  name: string
  account: string
  value: string
  month: number
  status: ['ok' | 'warn' | 'neutral', string]
}

const CLIENTS: ClientRow[] = [
  {
    name: 'Client A',
    account: 'cTrader · Live',
    value: fmtMoney(10420, 'EUR'),
    month: 1.24,
    status: ['ok', 'All running'],
  },
  {
    name: 'Client B',
    account: 'Bybit · Live',
    value: fmtMoney(52310.75, 'USDT'),
    month: 0.6,
    status: ['warn', 'Cash flows unconfirmed'],
  },
  {
    name: 'Client C',
    account: 'cTrader · Live',
    value: fmtMoney(23880.1, 'EUR'),
    month: -1.2,
    status: ['warn', 'Waiting for sign-in'],
  },
  {
    name: 'Client D',
    account: 'cTrader · Demo',
    value: fmtMoney(10000, 'EUR'),
    month: 0,
    status: ['neutral', 'No strategy yet'],
  },
]

const COLUMNS: Column<ClientRow>[] = [
  { key: 'name', header: 'Client', render: (row) => <strong>{row.name}</strong>, card: 'title' },
  { key: 'account', header: 'Account', render: (row) => row.account, card: 'sub' },
  { key: 'value', header: 'Value', render: (row) => row.value, align: 'right' },
  { key: 'month', header: 'This month', render: (row) => <Change value={row.month} kind="percent" />, align: 'right' },
  { key: 'status', header: 'Status', render: (row) => <Badge tone={row.status[0]}>{row.status[1]}</Badge> },
]

function Table() {
  return (
    <Card title="Data table on paper">
      <DataTable surface="paper" caption="Clients" columns={COLUMNS} rows={CLIENTS} rowKey={(row) => row.name} />
    </Card>
  )
}

function Code() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirm = (code: string) => {
    setBusy(true)
    setError(null)
    // The example accepts 123456 and refuses anything else, after a moment.
    window.setTimeout(() => {
      setBusy(false)
      if (code === '123456') toast.success('Started', 'Euro range trades on the next hourly candle.')
      else setError('That code is not the one your code app shows now. Codes change every 30 seconds.')
    }, 700)
  }
  return (
    <Card title="Confirm with the 6-digit code">
      <ConfirmWithCode confirmLabel="Start Euro range" onConfirm={confirm} busy={busy} error={error}>
        <p>
          <strong>This account trades real money.</strong> Euro range will use up to {fmtMoney(3000, 'EUR')} of it.
        </p>
      </ConfirmWithCode>
      <p className="k-hint">Example: 123456 is accepted, any other code is refused.</p>
    </Card>
  )
}
