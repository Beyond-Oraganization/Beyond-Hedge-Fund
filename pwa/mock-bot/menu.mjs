// The mock bot's strategy menu and clients' limits (Fund/Menu.cs, Cli/Commands/MenuCommands.cs in Beyond-Bot-Bybit):
// `menu list|add|change|withdraw`, `clients limits`, and `trading start|check --setup` turned into the bot's own arguments,
// with a client's limits checked first, in the real bot's words. Two setups to start with, both allowed to Carol's client:
// "Gold trend, steady" (XAUUSD 1h) and "Euro range, careful" (EURUSD 4h); her largest budget is 40% of the balance, two
// sessions at once, no Live.
const RISKS = ['careful', 'steady', 'bold']

const option = (args, name) => {
  const inline = args.find((a) => a.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const at = args.indexOf(name)
  return at >= 0 ? (args[at + 1] ?? null) : null
}
const options = (args, name) => args.flatMap((a, i) => (a === name ? [args[i + 1]] : a.startsWith(`${name}=`) ? [a.slice(name.length + 1)] : [])).filter((v) => v != null)
const answer = (json, text, asJson) => ({ exitCode: 0, output: asJson ? JSON.stringify(json, null, 2) : text, blocks: [{ type: 'text', text }], error: null, json: asJson ? json : null })
const failed = (message) => ({ exitCode: 1, output: message, blocks: [], error: { message, hint: null }, json: null })
const money = (value) => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** MenuInput.SessionName: "Gold trend, steady" → "Gold trend steady". */
export const sessionNameOf = (name) => {
  const kept = [...name].filter((c) => /[\p{L}\p{N} ._-]/u.test(c)).join('').split(' ').filter(Boolean).join(' ')
  return kept.length > 40 ? kept.slice(0, 40).trimEnd() : kept || 'menu setup'
}

/** `clientOf(login)`: the client id a person signs in for, or null. */
export function createMenu({ clientOf, now = () => Date.now() }) {
  const at = () => new Date(now()).toISOString().replace(/\.\d+Z$/, 'Z')
  const setups = [
    { id: 1, name: 'Gold trend, steady', description: 'Buys gold when it dips inside a rising trend and sells into strength. Loses in sideways weeks, when the dips keep going.', risk: 'steady', strategy: 'drcs', market: 'XAUUSD 1h', parameters: { depth: 23, deviation: 1, 'moving-count': 2 }, rules: ['open long on cross down lower 2', 'close long on cross up upper 2'], sizing: 'percent:25', backtestId: null, withdrawn: false, createdAt: '2026-11-02T10:00:00Z' },
    { id: 2, name: 'Euro range, careful', description: 'Trades the euro back and forth inside its usual range, with small positions. Loses when the euro breaks out of the range.', risk: 'careful', strategy: 'drcs', market: 'EURUSD 4h', parameters: { depth: 30, deviation: 1, 'moving-count': 2 }, rules: ['open long on cross down lower 1', 'close long on cross up upper 1'], sizing: 'percent:10', backtestId: null, withdrawn: false, createdAt: '2026-11-03T10:00:00Z' },
  ]
  const limits = new Map([[1, { client: 1, setups: [1, 2], maxBudget: null, maxBudgetPercent: 40, maxSessions: 2, liveAllowed: false, updatedAt: '2026-11-03T11:00:00Z' }]])

  const largestOf = (own, balance) => {
    const share = own.maxBudgetPercent != null ? Math.floor(balance * own.maxBudgetPercent) / 100 : null
    return own.maxBudget != null && share != null ? Math.min(own.maxBudget, share) : (own.maxBudget ?? share)
  }

  /** StrategyMenu.CheckClientAsync: why a client's start is refused, and their largest budget; null for anyone else. */
  function checkClient(person, id, budget, { balance, currency, sessions, live }) {
    if (person?.role !== 'client') return null
    const own = limits.get(clientOf(person.login))
    if (!own) return { refusal: 'The fund has not set what you may start yet; ask them.', largest: null }
    const largest = largestOf(own, balance)
    let refusal = null
    if (!own.setups.includes(id)) refusal = `Menu setup ${id} is not one you may start; 'menu list' shows yours.`
    else if (live && !own.liveAllowed) refusal = 'This account trades real money, and your limits do not allow that; ask the fund.'
    else if (largest != null && budget == null) refusal = `Give a budget of at most ${money(largest)} ${currency}.`
    else if (largest != null && budget > largest)
      refusal = `A budget of ${money(budget)} ${currency} is more than your largest here, ${money(largest)} ${currency}${own.maxBudgetPercent != null ? ` (${own.maxBudgetPercent}% of the ${money(balance)} ${currency} balance)` : ''}.`
    else if (own.maxSessions != null && sessions >= own.maxSessions) refusal = `This account has ${sessions} session(s), the most you may run at once (${own.maxSessions}); stop one first.`
    return { refusal, largest }
  }

  return {
    sessionNameOf,

    run(args, person) {
      const asJson = args.includes('--json')
      if (args[0] === 'clients' && args[1] === 'limits') return this.limits(args)
      switch (args[1]) {
        case 'list': {
          const client = person?.role === 'client' ? clientOf(person.login) : null
          const allowed = person?.role === 'client' ? (limits.get(client)?.setups ?? []) : null
          const list = setups.filter((s) => (allowed ? allowed.includes(s.id) && !s.withdrawn : args.includes('--all') || !s.withdrawn))
          return answer(list, list.map((s) => `${s.id} ${s.name}`).join('\n') || 'The menu is empty.', asJson)
        }
        case 'add': {
          const name = option(args, '--name'), description = option(args, '--description'), risk = option(args, '--risk')
          const symbol = option(args, '--symbol'), interval = option(args, '--interval')
          if (!name) return failed('Give --name: what clients read, e.g. "Gold trend, steady".')
          if (!description) return failed('Give --description: what it does and when it loses, in plain words.')
          if (!risk) return failed('Give --risk: careful, steady, bold.')
          if (!RISKS.includes(risk)) return failed(`'${risk}' is not a risk: careful, steady, bold.`)
          if (!symbol || !interval) return failed('Give --symbol and --interval: a setup trades one market.')
          const parameters = Object.fromEntries(options(args, '--set').map((p) => p.split('=')).map(([k, v]) => [k, Number(v)]))
          const setup = { id: setups.length + 1, name, description, risk, strategy: args[2] ?? 'drcs', market: `${symbol.toUpperCase()} ${interval}`, parameters, rules: options(args, '--rule'),
            sizing: option(args, '--sizing') ?? 'percent:50', backtestId: option(args, '--backtest') ? Number(option(args, '--backtest')) : null, withdrawn: false, createdAt: at() }
          setups.push(setup)
          return answer(setup, `Added menu setup ${setup.id}: ${name} (${risk}), ${setup.strategy} on ${setup.market}, ${setup.sizing}.`, asJson)
        }
        case 'change': {
          const setup = setups.find((s) => s.id === Number(args[2]))
          if (!setup) return failed(`No menu setup ${args[2]}. 'menu list' shows them.`)
          const risk = option(args, '--risk')
          if (risk && !RISKS.includes(risk)) return failed(`'${risk}' is not a risk: careful, steady, bold.`)
          setup.name = option(args, '--name') ?? setup.name
          setup.description = option(args, '--description') ?? setup.description
          setup.risk = risk ?? setup.risk
          return answer(null, `Menu setup ${setup.id} is now: ${setup.name} (${setup.risk}). To trade differently, add a new setup and withdraw this one.`, false)
        }
        case 'withdraw': {
          const setup = setups.find((s) => s.id === Number(args[2]))
          if (!setup) return failed(`No menu setup ${args[2]}. 'menu list' shows them.`)
          setup.withdrawn = true
          return answer(null, `Menu setup ${setup.id} is withdrawn: no one starts it again. Sessions running it keep running until stopped.`, false)
        }
        default:
          return failed(`Unknown command '${args[1] ?? ''}'.`)
      }
    },

    limits(args) {
      const id = Number(args[2])
      const asJson = args.includes('--json')
      if (!Number.isInteger(id) || id < 1) return failed(`'${args[2]}' is not a whole number above 0.`)
      const given = ['--setups', '--max-budget', '--max-budget-percent', '--max-sessions', '--live'].some((o) => option(args, o) != null)
      const none = (v) => v?.trim().toLowerCase() === 'none'
      if (given) {
        const current = limits.get(id) ?? { client: id, setups: [], maxBudget: null, maxBudgetPercent: null, maxSessions: null, liveAllowed: false, updatedAt: null }
        const setupsText = option(args, '--setups')
        const ids = setupsText == null ? current.setups : none(setupsText) ? [] : setupsText.split(',').map((x) => Number(x.trim()))
        const unknown = ids.find((x) => !setups.some((s) => s.id === x))
        if (unknown != null) return failed(`No menu setup ${unknown}. 'menu list' shows them.`)
        const num = (o) => { const v = option(args, o); return v == null ? undefined : none(v) ? null : Number(v) }
        const budget = num('--max-budget'), percent = num('--max-budget-percent'), sessions = num('--max-sessions')
        if (budget != null && !(budget > 0)) return failed('The largest budget is an amount above 0.')
        if (percent != null && !(percent > 0 && percent <= 100)) return failed('The largest budget as a percent of the balance is above 0 and at most 100.')
        if (sessions != null && !(Number.isInteger(sessions) && sessions >= 1)) return failed(`'${option(args, '--max-sessions')}' is not a whole number above 0.`)
        const live = option(args, '--live')
        if (live != null && !['yes', 'no'].includes(live)) return failed(`--live takes yes or no, not '${live}'.`)
        limits.set(id, { client: id, setups: [...new Set(ids)].sort((a, b) => a - b), maxBudget: budget === undefined ? current.maxBudget : budget, maxBudgetPercent: percent === undefined ? current.maxBudgetPercent : percent,
          maxSessions: sessions === undefined ? current.maxSessions : sessions, liveAllowed: live == null ? current.liveAllowed : live === 'yes', updatedAt: at() })
      }
      const view = limits.get(id) ?? { client: id, setups: [], maxBudget: null, maxBudgetPercent: null, maxSessions: null, liveAllowed: false, updatedAt: null }
      return answer(view, view.updatedAt ? `Client ${id} may start: menu setups ${view.setups.join(', ') || 'none'}.` : `Client ${id} has no limits yet, so they may start nothing.`, asJson)
    },

    /**
     * `trading start|check --setup ID`: the bot's own arguments for the setup, or why not (a refusal is the answer to send).
     * `context`: the account's balance, currency, sessions (names) and whether it is Live.
     */
    expand(args, person, context) {
      const id = Number(option(args, '--setup'))
      const setup = setups.find((s) => s.id === id)
      if (!setup) return { answer: failed(`No menu setup ${option(args, '--setup')}. 'menu list' shows them.`) }
      if (setup.withdrawn) return { answer: failed(`Menu setup ${id} (${setup.name}) is withdrawn: it can no longer be started.`) }
      const widened = ['--sizing', '--set', '--rule', '--symbol', '--interval'].filter((o) => option(args, o) != null)
      if (widened.length) return { answer: failed(`--setup fixes the strategy, market, parameters, rules and sizing; leave out ${widened.join(', ')}.`) }
      const budgetText = option(args, '--budget')
      const budget = budgetText == null ? null : Number(budgetText)
      const name = option(args, '--name') ?? option(args, '-n') ?? sessionNameOf(setup.name)
      const sessions = context.sessions.filter((n) => n.toLowerCase() !== name.toLowerCase()).length
      const check = checkClient(person, id, budget, { ...context, sessions })
      const [symbol, interval] = setup.market.split(' ')
      const expanded = [args[0], args[1], setup.strategy, '--symbol', symbol, '--interval', interval, ...Object.entries(setup.parameters).flatMap(([k, v]) => ['--set', `${k}=${v}`]),
        ...setup.rules.flatMap((r) => ['--rule', r]), '--sizing', setup.sizing, ...(budget != null ? ['--budget', String(budget)] : []), '--name', name, '-d',
        ...(args.includes('--live') ? ['--live'] : []), ...(args.includes('--json') ? ['--json'] : [])]
      return { args: expanded, check }
    },
  }
}
