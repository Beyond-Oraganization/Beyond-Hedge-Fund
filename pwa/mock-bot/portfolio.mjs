// The mock bot's portfolios (Fund/Portfolios.cs, Fund/Activity.cs in Beyond-Bot-Bybit): `portfolio --json` and
// `activity --json` for the one managed account, "demo", in EUR. Seventy days of values that grow slowly, with a 2,000
// deposit a week ago that the returns leave out (time-weighted, as the real bot counts them), read from the broker an
// hour ago. Everyone reaches "demo": carol as her client's account, staff and the owner as a managed one.
const ACCOUNT = 'demo'
const CURRENCY = 'EUR'
const DAY = 86_400_000

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z')
const date = (ms) => new Date(ms).toISOString().slice(0, 10)
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits

const option = (args, name) => {
  const inline = args.find((a) => a.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const at = args.indexOf(name)
  return at >= 0 ? (args[at + 1] ?? null) : null
}

const answer = (json, text, asJson) => ({ exitCode: 0, output: asJson ? JSON.stringify(json, null, 2) : text, blocks: [{ type: 'text', text }], error: null, json: asJson ? json : null })
const failed = (message, hint = null) => ({ exitCode: 1, output: message, blocks: [], error: { message, hint }, json: null })

/** The days' values, the deposit and the returns, worked out the way the bot does, as of `now`. */
function history(now) {
  const today = Math.floor(now / DAY) * DAY
  const start = today - 69 * DAY
  const depositDay = today - 7 * DAY
  const days = []
  let growth = 1
  let base = 8000
  for (let day = start; day <= today; day += DAY) {
    const index = (day - start) / DAY
    // A small, repeatable wobble around a steady 0.08% a day.
    if (index > 0) growth *= 1 + 0.0008 + 0.004 * Math.sin(index * 1.7)
    if (day === depositDay) base += 2000 / growth
    days.push({ date: date(day), value: round(base * growth), cashFlow: day === depositDay ? 2000 : 0, growth })
  }
  const at = (day) => days.find((entry) => entry.date === date(day))
  const since = (from) => (from ? round(days.at(-1).growth / from.growth - 1, 6) : null)
  const monthStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1)
  return {
    days,
    deposit: { id: 1, account: ACCOUNT, at: iso(depositDay + 11.5 * 3600_000), amount: 2000, kind: 'deposit', currency: CURRENCY, source: 'broker', note: 'Second transfer', createdBy: null },
    returns: { today: since(at(today - DAY)), month: since(monthStart <= start ? days[0] : (at(monthStart - DAY) ?? days[0])), sinceStart: since(days[0]) },
  }
}

export function createPortfolio(now) {
  const reachable = (args) => {
    const asked = option(args, '--account')
    return asked && asked.toLowerCase() !== ACCOUNT ? failed(`'${asked}' is not one of your accounts.`) : null
  }

  return {
    portfolio(args) {
      const no = reachable(args)
      if (no) return no
      const { days, deposit, returns } = history(now())
      const hour = Math.floor(now() / 3600_000) * 3600_000
      const last = days.at(-1)
      const account = {
        login: ACCOUNT, currency: CURRENCY, value: last.value, balance: round(last.value - 120.4), valuedAt: iso(hour), returns,
        series: days.map((day, index) => ({ date: day.date, value: day.value, cashFlow: day.cashFlow, return: index ? round(day.growth / days[0].growth - 1, 6) : 0 })),
        cashFlows: [deposit], cashFlowsConfirmedUntil: iso(hour),
      }
      return answer({ accounts: [account] }, `${ACCOUNT}: ${last.value} ${CURRENCY}`, args.includes('--json'))
    },

    activity(args) {
      const no = reachable(args)
      if (no) return no
      const t = now()
      const { deposit } = history(t)
      const items = [
        { at: iso(t - 2 * 3600_000), account: ACCOUNT, kind: 'close', text: 'Closed XAUUSD buy 2 at a gain of 84.10', amount: 84.1 },
        { at: iso(t - 26 * 3600_000), account: ACCOUNT, kind: 'close', text: 'Closed EURUSD sell 0.5 at a loss of 12.40', amount: -12.4 },
        { at: deposit.at, account: ACCOUNT, kind: 'cashFlow', text: 'Deposit: Second transfer', amount: 2000 },
        { at: iso(t - 9 * DAY), account: ACCOUNT, kind: 'strategy', text: 'Strategy started: drcs, Gold', amount: null },
      ]
      const last = Number(option(args, '--last') ?? 50)
      return answer(items.slice(0, last), items.map((item) => item.text).join('\n'), args.includes('--json'))
    },
  }
}
