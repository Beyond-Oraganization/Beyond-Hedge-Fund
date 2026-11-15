// The mock bot's `fund overview --json` (Fund/FundOverview.cs in Beyond-Bot-Bybit): totals per currency with today's
// result, the counts, and alerts, worked out from the mock's portfolio, clients and the trading sessions it runs.
const answer = (json, text, asJson) => ({ exitCode: 0, output: asJson ? JSON.stringify(json, null, 2) : text, blocks: [{ type: 'text', text }], error: null, json: asJson ? json : null })
const ORDER = ['error', 'warn', 'info']

/**
 * `portfolio`: the mock's createPortfolio; `clients`: its createClients (run is used for the list); `sessions()`: the bot's
 * sessions (name, key, lastTick); `now()`: the bot's clock.
 */
export function overview(args, { portfolio, clients, sessions, now }) {
  const accounts = portfolio.portfolio(['portfolio', '--json']).json.accounts
  const all = clients.run(['clients', 'list', '--json']).json
  const running = sessions()
  const totals = Object.values(
    accounts.filter((a) => a.value != null).reduce((byCurrency, a) => {
      const days = a.series
      const today = days.length >= 2 ? Math.round((days.at(-1).value - days.at(-2).value - days.at(-1).cashFlow) * 100) / 100 : null
      const total = (byCurrency[a.currency] ??= { currency: a.currency, value: 0, today: null, accounts: 0 })
      total.value = Math.round((total.value + a.value) * 100) / 100
      if (today != null) total.today = Math.round(((total.today ?? 0) + today) * 100) / 100
      total.accounts++
      return byCurrency
    }, {}),
  )
  const alerts = []
  for (const session of running)
    if (session.lastTick?.outcome === 'Failed')
      alerts.push({ severity: 'error', kind: 'tickFailed', text: `'${session.name}' on demo (${session.key}): its last tick failed${session.lastTick.error ? `: ${session.lastTick.error}` : '.'}`, account: 'demo', client: null, session: session.name })
  for (const client of all) {
    if (!client.accounts.length) alerts.push({ severity: 'warn', kind: 'clientNoAccount', text: `${client.name} has no account linked.`, account: null, client: client.id, session: null })
    else if (!client.people.length) alerts.push({ severity: 'warn', kind: 'clientNoPerson', text: `Nobody signs in for ${client.name}.`, account: null, client: client.id, session: null })
  }
  if (!all.some((c) => c.accounts.includes('demo'))) alerts.push({ severity: 'info', kind: 'accountNoClient', text: 'demo is managed but belongs to no client.', account: 'demo', client: null, session: null })
  alerts.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity))
  const json = { at: new Date(now()).toISOString(), totals, clients: all.length, accounts: 1, sessions: running.length, alerts }
  return answer(json, `${all.length} client(s), 1 managed account(s), ${running.length} strategy session(s).`, args.includes('--json'))
}
