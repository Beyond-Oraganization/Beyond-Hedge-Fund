// The mock bot's clients (Fund/Clients.cs, Cli/Commands/ClientCommands.cs and FundCommands.cs in Beyond-Bot-Bybit):
// `clients list|add|link|unlink` and `fund accounts`, with the real bot's rules and messages. One client to start with:
// "Carol Example", whom carol signs in for, holding the managed account "demo".

const option = (args, name) => {
  const inline = args.find((a) => a.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const at = args.indexOf(name)
  return at >= 0 ? (args[at + 1] ?? null) : null
}
const answer = (json, text, asJson) => ({ exitCode: 0, output: asJson ? JSON.stringify(json, null, 2) : text, blocks: [{ type: 'text', text }], error: null, json: asJson ? json : null })
const failed = (message, hint = null) => ({ exitCode: 1, output: message, blocks: [], error: { message, hint }, json: null })

/** `roleOf(login)`: a person's role, or null when there is no such person. */
export function createClients(roleOf, now = () => Date.now()) {
  // The managed accounts (ManagedAccounts.cs): the mock's one trading account, managed from the start.
  const MANAGED = [{ login: 'demo', managedAt: '2026-11-01T09:00:00Z', open: true, broker: 'CTrader', mode: 'Demo', sessions: 1 }]
  const clients = [{ id: 1, name: 'Carol Example', createdAt: '2026-11-01T09:05:00Z', people: ['carol'], accounts: ['demo'] }]
  let next = 2

  const view = (client) => ({ ...client, people: [...client.people], accounts: [...client.accounts] })

  function link(args, linking) {
    const id = Number(args[2])
    const client = clients.find((c) => c.id === id)
    if (!client) return failed(`No client ${args[2]}. 'clients list' shows them.`)
    const person = option(args, '--person')?.toLowerCase()
    const account = option(args, '--account')?.toLowerCase()
    if ((person == null) === (account == null)) return failed('Give either --person <LOGIN> or --account <LOGIN>.')
    if (person != null) {
      const role = roleOf(person)
      if (!role) return failed(`No person '${person}'. 'people list' shows who there is.`)
      if (linking) {
        if (role !== 'client') return failed(`${person} is ${role}: staff and the owner reach every managed account already.`)
        const current = clients.find((c) => c.people.includes(person))
        if (current && current !== client) return failed(`${person} belongs to ${current.name}; unlink them there first.`)
        if (!client.people.includes(person)) client.people.push(person)
        return answer(null, `${person} signs in for client ${id}.`, false)
      }
      client.people = client.people.filter((p) => p !== person)
      return answer(null, `${person} no longer signs in for client ${id}.`, false)
    }
    if (linking) {
      if (!MANAGED.some((m) => m.login === account)) return failed(`${account} is not managed: manage it first (fund manage ${account}), so its client reaches it without its password.`)
      const current = clients.find((c) => c.accounts.includes(account))
      if (current && current !== client) return failed(`${account} belongs to ${current.name}; unlink it there first.`)
      if (!client.accounts.includes(account)) client.accounts.push(account)
      return answer(null, `${account} is client ${id}'s.`, false)
    }
    client.accounts = client.accounts.filter((a) => a !== account)
    return answer(null, `${account} is no longer client ${id}'s.`, false)
  }

  return {
    /** The client a person signs in for, or null. */
    clientOf: (login) => clients.find((c) => c.people.includes(login))?.id ?? null,

    /** One client as `clients list` shows it, or null. */
    get: (id) => {
      const client = clients.find((c) => c.id === id)
      return client ? view(client) : null
    },

    /** The accounts a client person reaches: their client's. */
    accountsOf: (login) => clients.find((c) => c.people.includes(login))?.accounts ?? [],

    run(args) {
      const asJson = args.includes('--json')
      if (args[0] === 'fund' && args[1] === 'accounts') return answer(MANAGED, MANAGED.map((m) => m.login).join('\n'), asJson)
      if (args[0] === 'fund' && args[1] === 'manage') {
        const login = args[2]?.toLowerCase()
        const password = option(args, '--password')
        // The mock's one trading account: demo / demo-password (bot.mjs).
        if (login !== 'demo' || password !== 'demo-password') return failed('Invalid login or password.')
        if (!MANAGED.some((m) => m.login === login)) MANAGED.push({ login, managedAt: new Date(now()).toISOString().replace(/\.\d+Z$/, 'Z'), open: true, broker: 'CTrader', mode: 'Demo', sessions: 1 })
        return answer(null, `${login} (CTrader Demo) is managed: the trading process keeps it open, and opens it again after every restart without its password.`, false)
      }
      if (args[0] === 'fund' && args[1] === 'unmanage') {
        const login = args[2]?.toLowerCase()
        const at = MANAGED.findIndex((m) => m.login === login)
        if (at >= 0) MANAGED.splice(at, 1)
        return answer(null, `${args[2]} is not managed any more: it closes once nothing trades or holds it, and its strategies keep trading until stopped.`, false)
      }
      switch (args[1]) {
        case 'list':
          return answer(clients.map(view), clients.length ? clients.map((c) => `${c.id} ${c.name}`).join('\n') : 'No client yet. Add one with: clients add <NAME>', asJson)
        case 'add': {
          const name = (args[2] ?? '').trim()
          if (!name || name.startsWith('-') || name.length > 100) return failed("A client's name has 1 to 100 characters.")
          const client = { id: next++, name, createdAt: new Date(now()).toISOString().replace('.000Z', 'Z'), people: [], accounts: [] }
          clients.push(client)
          return answer(view(client), `Added client ${client.id}: ${name}.`, asJson)
        }
        case 'link':
          return link(args, true)
        case 'unlink':
          return link(args, false)
        default:
          return failed(`Unknown command '${args[1] ?? ''}'.`)
      }
    },
  }
}
