// The mock bot's audit log (Fund/AuditTrail.cs, `audit --json` in Beyond-Bot-Bybit): every command that changes something,
// refused ones too, newest first, with who sent it. Reads are not logged, as on the real bot.
const CHANGES = new Set(['people add', 'people role', 'people disable', 'people enable', 'people reset-code', 'people reset-password', 'clients add', 'clients link',
  'clients unlink', 'fund manage', 'fund unmanage', 'cashflows add', 'trading start', 'trading stop', 'orders place', 'orders close', 'orders clear', 'register', 'credentials', 'signin', 'signout'])
const SECRET = ['--password', '--new-password', '--credential', '--code']

const option = (args, name) => {
  const inline = args.find((a) => a.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const at = args.indexOf(name)
  return at >= 0 ? (args[at + 1] ?? null) : null
}
const hide = (args) => args.map((a, i) => (SECRET.includes(args[i - 1] ?? '') ? '***' : SECRET.some((s) => a.startsWith(`${s}=`)) ? `${a.split('=')[0]}=***` : a)).join(' ')
const keyOf = (args) => (['people', 'clients', 'fund', 'cashflows', 'trading', 'orders'].includes(args[0]) ? `${args[0]} ${args[1]}` : args[0])

export function createAudit(now = () => Date.now()) {
  const entries = []
  let next = 1
  return {
    /** Logs a command if it changes something. `caller`: { kind: 'apiKey' } or { kind: 'person', person }. */
    record(args, caller, result) {
      if (!CHANGES.has(keyOf(args))) return
      const person = caller?.kind === 'person' ? caller.person : null
      entries.unshift({
        id: next++, at: new Date(now()).toISOString().replace(/\.\d+Z$/, 'Z'), via: person ? 'person' : caller?.kind === 'apiKey' ? 'apiKey' : 'anonymous',
        person: person?.login ?? (args[0] === 'signin' ? (args[1] ?? null) : null), role: person?.role ?? null, account: null,
        command: hide(args), outcome: result.refused ? 'refused' : result.exitCode === 0 ? 'done' : 'failed', exitCode: result.refused ? null : result.exitCode, error: result.error?.message ?? null,
      })
    },
    run(args) {
      const last = Number(option(args, '--last') ?? 50)
      const person = option(args, '--person')?.toLowerCase()
      const list = entries.filter((e) => !person || e.person === person).slice(0, last)
      const asJson = args.includes('--json')
      return { exitCode: 0, output: asJson ? JSON.stringify(list, null, 2) : list.map((e) => `${e.at} ${e.person ?? e.via} ${e.command} ${e.outcome}`).join('\n'), blocks: [], error: null, json: asJson ? list : null }
    },
  }
}
