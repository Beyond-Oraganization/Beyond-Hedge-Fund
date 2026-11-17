// The mock bot's published backtests (Fund/PublishedBacktests.cs, Cli/Commands/PublishedCommands.cs in Beyond-Bot-Bybit):
// `published list|add|update|delete`, in the real bot's words. Figures only; the strategy and its setup are left out for a
// client the fund does not trust. One published to start with, for the menu's "Gold trend, steady".
const option = (args, name) => {
  const inline = args.find((a) => a.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const at = args.indexOf(name)
  return at >= 0 ? (args[at + 1] ?? null) : null
}
const answer = (json, text, asJson) => ({ exitCode: 0, output: asJson ? JSON.stringify(json, null, 2) : text, blocks: [{ type: 'text', text }], error: null, json: asJson ? json : null })
const failed = (message) => ({ exitCode: 1, output: message, blocks: [], error: { message, hint: null }, json: null })
const round2 = (value) => Math.round(value * 100) / 100
const utc = (text) => (text ? new Date(/Z$|[+-]\d\d:\d\d$/.test(text) ? text : `${text}Z`).toISOString().replace(/\.\d+Z$/, 'Z') : null)

/** `setupOf(id)`: the menu setup of that id ({ id, name, strategy, market, sizing }), or null. `sees(person)`: whether they see how a strategy trades. */
export function createPublished({ setupOf, sees, now = () => Date.now() }) {
  const at = () => new Date(now()).toISOString().replace(/\.\d+Z$/, 'Z')
  const rows = [
    {
      id: 1, setupId: 1, title: 'Gold 2024–2026', note: 'Before fees.', strategy: 'sample', market: 'XAUUSD 1h', strategySetup: 'length=20 spread=1 lines=2, rules: open long on cross down below 2; close long on cross up above 2',
      sizing: 'percent:25', from: '2024-01-01T00:00:00Z', to: '2026-11-01T00:00:00Z', candles: 12_000, initialBalance: 1000, finalBalance: 1412, trades: 86, wins: 51, losses: 35,
      maxDrawdownPercent: 9.4, backtestId: null, publishedBy: 'sam', publishedAt: '2026-11-10T09:00:00Z', updatedAt: '2026-11-10T09:00:00Z',
    },
  ]
  let next = 2

  const view = (row, person) => {
    const shown = {
      ...row,
      setupName: row.setupId != null ? (setupOf(row.setupId)?.name ?? null) : null,
      returnPercent: row.initialBalance > 0 ? round2(((row.finalBalance - row.initialBalance) / row.initialBalance) * 100) : 0,
      winRate: row.trades > 0 ? round2((row.wins / row.trades) * 100) : 0,
    }
    return sees(person) ? shown : { ...shown, strategy: '', strategySetup: '' }
  }
  const said = (v) => `${v.id}: ${v.title}${v.setupName ? ` (${v.setupName})` : ''}, ${v.market}, ${v.from.slice(0, 10)} → ${v.to.slice(0, 10)}`

  function figures(args, row) {
    const number = (name) => (option(args, name) == null ? null : Number(option(args, name)))
    const changed = {
      from: utc(option(args, '--from')) ?? row.from, to: utc(option(args, '--to')) ?? row.to, candles: number('--candles') ?? row.candles,
      initialBalance: number('--initial') ?? row.initialBalance, finalBalance: number('--final') ?? row.finalBalance, trades: number('--trades') ?? row.trades,
      wins: number('--wins') ?? row.wins, losses: number('--losses') ?? row.losses, maxDrawdownPercent: number('--drawdown') ?? row.maxDrawdownPercent,
    }
    const typed = ['--from', '--to', '--candles', '--initial', '--final', '--trades', '--wins', '--losses', '--drawdown'].some((name) => option(args, name) != null)
    return { ...row, ...changed, backtestId: typed ? null : row.backtestId }
  }

  function check(row) {
    if (row.title.length < 1 || row.title.length > 80) return 'A title has 1 to 80 characters, e.g. "Gold 2024–2026".'
    if (!(Date.parse(row.from) < Date.parse(row.to))) return 'The period\'s start (--from) must come before its end (--to).'
    if (!(row.initialBalance > 0) || row.finalBalance < 0) return 'The starting balance (--initial) is above 0, and the final one (--final) at least 0.'
    if (row.wins < 0 || row.losses < 0 || row.wins + row.losses > row.trades) return 'Wins and losses are at least 0 and add up to no more than the trades.'
    if (row.maxDrawdownPercent < 0 || row.maxDrawdownPercent > 100) return 'The deepest drawdown (--drawdown) is a percent from 0 to 100.'
    return null
  }

  return {
    run(args, person) {
      const json = args.includes('--json')
      if (args[1] === 'list') {
        const setup = option(args, '--setup')
        const list = [...rows].reverse().filter((row) => setup == null || row.setupId === Number(setup)).map((row) => view(row, person))
        return answer(list, list.length ? list.map(said).join('\n') : 'Nothing is published yet.', json)
      }
      if (args[1] === 'add') {
        const setupId = option(args, '--setup') == null ? null : Number(option(args, '--setup'))
        if (setupId == null) return failed('Publish a menu setup\'s backtest (--setup ID, with its figures) or a stored one (--backtest ID).')
        const setup = setupOf(setupId)
        if (!setup) return failed(`No menu setup ${setupId}. 'menu list' shows them.`)
        const title = option(args, '--title')
        if (title == null) return failed('Give the --title people read, e.g. "Gold 2024–2026".')
        const missing = ['--from', '--to', '--initial', '--final', '--trades', '--wins', '--losses', '--drawdown'].filter((name) => option(args, name) == null)
        if (missing.length) return failed(`A setup's backtest needs its figures: give ${missing.join(', ')} (or copy a stored one with --backtest ID).`)
        const row = figures(args, {
          id: next, setupId, title: title.trim(), note: option(args, '--note')?.trim() || null, strategy: setup.strategy, market: setup.market, strategySetup: setup.describe ?? '',
          sizing: setup.sizing, backtestId: null, publishedBy: person?.login ?? 'owner', publishedAt: at(), updatedAt: at(),
        })
        const why = check(row)
        if (why) return failed(why)
        rows.push(row)
        next++
        const v = view(row, person)
        return answer(v, `Published ${said(v)}. Everyone sees it with: published list.`, json)
      }
      const id = Number(args[2])
      const at_ = rows.findIndex((row) => row.id === id)
      if (at_ < 0 || !['update', 'delete'].includes(args[1])) return failed(`No published backtest ${args[2]}. 'published list' shows them.`)
      if (args[1] === 'delete') {
        const [gone] = rows.splice(at_, 1)
        return answer(null, `Deleted published backtest ${said(view(gone, person))}.`, false)
      }
      const title = option(args, '--title')
      const note = args.includes('--no-note') ? null : option(args, '--note') != null ? option(args, '--note').trim() || null : rows[at_].note
      const row = { ...figures(args, rows[at_]), title: title?.trim() ?? rows[at_].title, note, setupId: args.includes('--no-setup') ? null : rows[at_].setupId, updatedAt: at() }
      const why = check(row)
      if (why) return failed(why)
      rows[at_] = row
      const v = view(row, person)
      return answer(v, `Published backtest ${said(v)}.`, json)
    },
  }
}
