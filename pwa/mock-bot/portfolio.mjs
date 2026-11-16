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

const MONTH = /^(\d{4})-(\d{2})$/
const monthOf = (ms) => new Date(ms).toISOString().slice(0, 7)

/**
 * `statement --json` (Fund/Statements.cs) for the client holding "demo": the month's values from the same history, the
 * deposit when it falls in the month, and a closed position every fifth day, alternately Gold's gain and a loss by hand.
 */
function statementOf(client, month, t) {
  const { days, deposit } = history(t)
  const [, year, number] = MONTH.exec(month)
  const from = Date.UTC(Number(year), Number(number) - 1, 1)
  const end = Date.UTC(Number(year), Number(number), 1)
  const complete = end <= t
  const inMonth = days.filter((day) => Date.parse(day.date) >= from && Date.parse(day.date) < end && Date.parse(day.date) <= t)
  const before = days.filter((day) => Date.parse(day.date) < from).at(-1)
  const opening = before ?? inMonth[0] ?? null
  const closing = inMonth.at(-1) ?? null
  const flows = Date.parse(deposit.at) >= from && Date.parse(deposit.at) < end ? [deposit] : []
  const deposits = flows.reduce((sum, flow) => sum + flow.amount, 0)
  const moved = opening && closing && Date.parse(deposit.at) > Date.parse(opening.date) && Date.parse(deposit.at) <= Date.parse(closing.date) + DAY ? deposit.amount : 0
  const trades = inMonth.filter((_, index) => index % 5 === 4).map((day, index) => ({
    openedAt: `${day.date}T08:00:00Z`, closedAt: `${day.date}T15:00:00Z`, symbol: index % 2 ? 'EURUSD' : 'XAUUSD', side: index % 2 ? 'sell' : 'buy',
    quantity: index % 2 ? 0.5 : 2, entryPrice: index % 2 ? 1.0842 : 2391.4, result: index % 2 ? -12.4 : round(84.1 + index * 3.5), strategy: index % 2 ? null : 'Gold',
  }))
  const byStrategy = [...new Set(trades.map((trade) => trade.strategy))].map((name) => {
    const own = trades.filter((trade) => trade.strategy === name)
    return { name, trades: own.length, wins: own.filter((trade) => trade.result > 0).length, losses: own.filter((trade) => trade.result < 0).length, result: round(own.reduce((sum, trade) => sum + trade.result, 0)) }
  })
  const started = Math.floor(t / DAY) * DAY - 9 * DAY
  const realized = round(trades.reduce((sum, trade) => sum + trade.result, 0))
  const account = {
    login: ACCOUNT, currency: CURRENCY,
    opening: opening?.value ?? null, openingAt: opening ? `${opening.date}T23:00:00Z` : null,
    closing: closing?.value ?? null, closingAt: closing ? `${closing.date}T23:00:00Z` : null,
    deposits, withdrawals: 0,
    change: opening && closing ? round(closing.value - opening.value - moved) : null,
    return: opening && closing && closing !== opening ? round(closing.growth / opening.growth - 1, 6) : null,
    cashFlowsConfirmed: true,
    trades: trades.length, wins: trades.filter((trade) => trade.result > 0).length, losses: trades.filter((trade) => trade.result < 0).length, realized,
    strategies: byStrategy, tradeList: trades, cashFlows: flows,
    events: started >= from && started < end ? [{ at: iso(started + 9 * 3600_000), text: 'Strategy started: drcs, Gold' }] : [],
    days: inMonth.map((day) => ({ date: day.date, value: day.value, cashFlow: day.cashFlow, return: opening ? round(day.growth / opening.growth - 1, 6) : null })),
  }
  const total = { currency: CURRENCY, accounts: 1, opening: account.opening, closing: account.closing, deposits, withdrawals: 0, change: account.change, realized }
  return {
    clientId: client.id, client: client.name, month, from: iso(from), to: iso(complete ? end : t), isComplete: complete, generatedAt: iso(t),
    accounts: client.accounts.includes(ACCOUNT) ? [account] : [], totals: client.accounts.includes(ACCOUNT) ? [total] : [],
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

    /** `client`: the client the statement is for ({ id, name, accounts }), already checked against the caller. */
    statement(args, client) {
      const t = now()
      const asJson = args.includes('--json')
      const first = history(t).days[0].date
      if (args.includes('--list')) {
        const months = []
        if (client.accounts.includes(ACCOUNT))
          for (let at = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), 1); monthOf(at) >= first.slice(0, 7); at = Date.UTC(new Date(at).getUTCFullYear(), new Date(at).getUTCMonth() - 1, 1)) months.push(monthOf(at))
        return answer({ clientId: client.id, client: client.name, months }, months.length ? `${client.name}: ${months.join(', ')}` : `No statement for ${client.name} yet.`, asJson)
      }
      const month = option(args, '--month')
      if (!month) return failed('Give the month: --month 2026-10 (or --list for the months there are).')
      if (!MONTH.test(month)) return failed(`'${month}' is not a month: write it 2026-10.`)
      if (Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1) > t) return failed(`${month} has not begun: a statement covers a month that has.`)
      const view = statementOf(client, month, t)
      return answer(view, `${client.name}, statement for ${month}`, asJson)
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
