#!/usr/bin/env node
// The mock bot's HTTP side: the same contract as the real `beyondbot serve` (Api/CommandApi.cs, CommandRunner.cs).
// POST / with a Bearer key (401 otherwise), a body of at most 4,096 bytes (413), a command line or {"command"} or
// {"args"}; 400 for refused commands; one command at a time; CORS only for the listed origins (preflight without a
// key); a client that disconnects cancels its own command. Bot connections (Api/ApiConnections.cs): a request
// without X-BeyondBot-Connection reaches no account; the login that creates a connection answers with its token in
// `connection`; an unknown token, or an X-BeyondBot-Account the connection does not hold, is 403. People (people.mjs):
// signin needs no key; a person's token (bbp_…) is a bearer too, runs what their role may (403 otherwise), and acts on a
// connection of their own holding the accounts they reach. Portfolios (portfolio.mjs): `portfolio` and `activity`. Clients (clients.mjs): `clients …` and `fund accounts|manage|unmanage`. The audit log (audit.mjs): each change, refused ones too.
//
//   node mock-bot/server.mjs [--port 8443] [--speed 60] [--signed-out] [--ordering-bug] [--add-delay 3500]
//   MOCK_BOT_KEY (default below), MOCK_BOT_ORIGINS ("*" = any localhost origin, or a comma list)
//
// Test control (no key, only with --control): POST /__mock/reset, /__mock/advance?ms=3600000, /__mock/config
import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createBot } from './bot.mjs'
import { createPeople, seesStrategies } from './people.mjs'
import { createPublished } from './published.mjs'
import { createPortfolio } from './portfolio.mjs'
import { createClients } from './clients.mjs'
import { overview } from './overview.mjs'
import { createAudit } from './audit.mjs'
import { createMenu } from './menu.mjs'

export const DEFAULT_KEY = 'mock-bot-key-0123456789abcdef0123456789abcdef'
const MAX_BODY = 4096
const TERMINAL_ONLY = new Set(['run', 'serve', 'ui', 'shell', 'exit', 'quit'])
const WATCHABLE = new Set(['session', 'balance', 'positions'])
const SECRET = ['--password', '--new-password', '--credential', '--code']

/**
 * `strategies bundle --json` (Fund/StrategyBundle.cs): the made-up sample pack (sample-pack/, published with the engine by
 * npm run engine), as the real bot hands out its own: base64 in pieces of at most 4,000 characters, its size and SHA-256.
 */
function strategyBundle() {
  const pack = readFileSync(new URL('./sample-pack/BeyondBot.Strategies.dll', import.meta.url))
  const { version } = JSON.parse(readFileSync(new URL('../public/engine/version.json', import.meta.url), 'utf8'))
  const base64 = pack.toString('base64')
  const pieces = base64.match(/.{1,4000}/g)
  return { version, sha256: createHash('sha256').update(pack).digest('hex'), strategies: ['sample'], bytes: pack.length, pack: pieces }
}

const split = (line) => [...line.matchAll(/"[^"]*"|[^\s]+/g)].map((m) => m[0].replace(/^"+|"+$/g, '')).filter(Boolean)
const normalize = (args) => (args.length === 1 && (args[0] === 'help' || args[0] === '?') ? ['--help'] : args)
const isWatch = (a) => a === '-w' || a === '--watch' || a.startsWith('--watch=') || a.startsWith('--watch:')

export function refusal(args) {
  if (!args.length) return { message: "Send a command, e.g. 'market list'.", hint: "'help' lists the commands." }
  if (TERMINAL_ONLY.has(args[0].toLowerCase())) return { message: `'${args[0]}' only works in a terminal on the server.`, hint: null }
  if (WATCHABLE.has(args[0].toLowerCase()) && args.some(isWatch)) return { message: '--watch never ends, so it does not work over the API.', hint: "Ask for 'session --json' as often as you need." }
  return null
}

export function describe(args) {
  const hide = (o, v) => (o === '--credential' && v.indexOf('=') > 0 ? v.slice(0, v.indexOf('=') + 1) + '***' : '***')
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const inline = SECRET.find((o) => a.length > o.length && a.startsWith(o) && (a[o.length] === '=' || a[o.length] === ':'))
    if (SECRET.includes(a) && i + 1 < args.length) out.push(a, hide(a, args[++i]))
    else if (inline) out.push(a.slice(0, inline.length + 1) + hide(inline, a.slice(inline.length + 1)))
    else out.push(a)
  }
  return out.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')
}

const refused = (command, error) => ({ command, exitCode: 2, elapsedMs: 0, output: '', blocks: [], error, json: null, ok: false })

export function startServer({ port = 8443, key = DEFAULT_KEY, origins = '*', control = false, log = false, botOptions = {} } = {}) {
  let bot = createBot(botOptions)
  let gate = Promise.resolve()
  // Token → { accounts, current }: each app's connection and the accounts it signed in to.
  let connections = new Map()
  let people = createPeople()
  let clients = createClients((login) => people.roleOf(login))
  let audit = createAudit()
  let menu = createMenu({ clientOf: (login) => clients.clientOf(login), sees: seesStrategies })
  let published = createPublished({ setupOf: (id) => menu.setup(id), sees: seesStrategies })
  // Person's login → their connection: what they may reach, kept between their commands.
  let personal = new Map()
  const allowed = (origin) => {
    if (!origin) return false
    if (origins === '*') return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    return origins.split(',').map((o) => o.trim()).includes(origin)
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin
    if (allowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    const url = new URL(req.url, 'http://mock')

    if (control && url.pathname.startsWith('/__mock/')) {
      res.setHeader('Content-Type', 'application/json')
      if (url.pathname === '/__mock/reset') {
        bot.stop()
        connections = new Map()
        people = createPeople()
        clients = createClients((login) => people.roleOf(login))
        audit = createAudit()
        menu = createMenu({ clientOf: (login) => clients.clientOf(login), sees: seesStrategies })
        published = createPublished({ setupOf: (id) => menu.setup(id), sees: seesStrategies })
        personal = new Map()
        const given = Object.fromEntries(url.searchParams)
        const flag = (name) => (name in given ? given[name] === '1' || given[name] === 'true' : botOptions[name])
        const number = (name) => (name in given ? Number(given[name]) : botOptions[name])
        bot = createBot({
          ...botOptions,
          signedIn: flag('signedIn') ?? true,
          trading: flag('trading') ?? true,
          orderingBug: flag('orderingBug') ?? false,
          databaseDown: flag('databaseDown') ?? false,
          addDelayMs: number('addDelayMs'),
          speed: number('speed'),
          seed: number('seed'),
        })
      } else if (url.pathname === '/__mock/advance') bot.advance(Number(url.searchParams.get('ms') ?? 3600000))
      else if (url.pathname === '/__mock/config') {
        if (url.searchParams.has('orderingBug')) bot.state.orderingBug = url.searchParams.get('orderingBug') === '1'
        if (url.searchParams.has('databaseDown')) bot.state.databaseDown = url.searchParams.get('databaseDown') === '1'
      }
      return res.end(JSON.stringify({ ok: true, now: new Date(bot.now()).toISOString() }))
    }

    if (req.method === 'OPTIONS') {
      // A browser's preflight carries no key; only allowed origins get CORS headers.
      if (allowed(origin)) {
        res.setHeader('Access-Control-Allow-Methods', 'POST')
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-BeyondBot-Connection, X-BeyondBot-Account')
      }
      res.statusCode = 204
      return res.end()
    }

    // Who asks: the API key, a person's token, or nobody (who may only sign in, checked with the command).
    const auth = String(req.headers.authorization ?? '').trim()
    const bearer = /^Bearer /i.test(auth) ? auth.slice(7).trim() : null
    const signedIn = bearer && bearer !== key ? people.authenticate(bearer) : null
    const caller = bearer === key ? { kind: 'apiKey' } : signedIn ? { kind: 'person', ...signedIn } : !auth ? { kind: 'anonymous' } : null
    const unauthorized = () => {
      res.statusCode = 401
      res.setHeader('WWW-Authenticate', 'Bearer')
      return res.end()
    }
    if (!caller) return unauthorized()
    if (req.method !== 'POST' || url.pathname !== '/') {
      // Without a key, only a sign-in gets past the door, and that is a POST.
      if (caller.kind === 'anonymous') return unauthorized()
      res.statusCode = 405
      return res.end()
    }

    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) tooLarge = true
      else chunks.push(chunk)
    })
    req.on('end', async () => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      if (tooLarge) {
        res.statusCode = 413
        return res.end()
      }
      const body = Buffer.concat(chunks).toString('utf8')
      let args
      if (/application\/json/i.test(req.headers['content-type'] ?? '')) {
        try {
          const value = JSON.parse(body)
          if (Array.isArray(value.args) && value.command == null && value.args.every((a) => typeof a === 'string')) args = value.args
          else if (typeof value.command === 'string' && value.args == null) args = split(value.command)
          else throw new Error('give either "command" (a string) or "args" (an array of strings).')
        } catch (error) {
          res.statusCode = 400
          return res.end(JSON.stringify(refused('', { message: `The body is not a command: ${error.message}`, hint: 'Send {"command": "market list"} or {"args": ["market", "list"]}.' })))
        }
      } else args = split(body)
      args = normalize(args)
      if (caller.kind === 'anonymous' && args[0] !== 'signin') return unauthorized()
      const no = refusal(args)
      if (no) {
        res.statusCode = 400
        return res.end(JSON.stringify(refused(describe(args), no)))
      }

      // A person's own sign-in commands, and the policy for everything else they send.
      const reply = (result) => {
        audit.record(args, caller, result)
        return res.end(JSON.stringify({ command: describe(args), elapsedMs: 1, blocks: [], account: null, connection: null, ...result, json: result.json ?? null, ok: result.exitCode === 0 }))
      }
      if (args[0] === 'signin') return reply(people.signin(args))
      if (args[0] === 'me') return reply(people.me(caller, args))
      if (args[0] === 'signout') return reply(people.signout(caller, args))
      if (caller.kind === 'person') {
        const no = people.refusal(caller.person, args)
        if (no) {
          res.statusCode = 403
          audit.record(args, caller, { exitCode: 2, error: { message: no }, refused: true })
          return res.end(JSON.stringify(refused(describe(args), { message: no, hint: null })))
        }
        if (!personal.has(caller.person.login)) personal.set(caller.person.login, { accounts: people.accountsOf(caller.person), current: people.accountsOf(caller.person)[0] ?? null })
      }

      // The fund's people (owner), audit log, clients and managed accounts.
      if (args[0] === 'people') return reply(people.manage(args, caller.kind === 'person' ? caller.person.login : null))
      // The strategy menu, clients' limits, and a start or check from the menu (turned into the bot's own arguments).
      const person = caller.kind === 'person' ? caller.person : null
      if (args[0] === 'menu' || (args[0] === 'clients' && args[1] === 'limits')) return reply(menu.run(args, person))
      // Published backtests, and the strategy pack (the made-up sample: no strategy of the fund's is in this repository).
      if (args[0] === 'published') return reply(published.run(args, person))
      if (args[0] === 'strategies' && args[1] === 'bundle') {
        const bundle = strategyBundle()
        return reply({ exitCode: 0, output: JSON.stringify(bundle, null, 2), blocks: [], error: null, json: args.includes('--json') ? bundle : null })
      }
      let menuCheck = null
      if (args[0] === 'trading' && (args[1] === 'start' || args[1] === 'check') && args.some((a) => a === '--setup' || a.startsWith('--setup='))) {
        const state = bot.state
        const expanded = menu.expand(args, person, { balance: state.account.balance, currency: state.account.currency, sessions: [...state.sessions.keys()], live: false })
        if (expanded.answer) return reply(expanded.answer)
        if (expanded.check?.refusal && args[1] === 'start') return reply({ exitCode: 1, output: expanded.check.refusal, blocks: [], error: { message: expanded.check.refusal, hint: null }, json: null })
        args = expanded.args
        menuCheck = expanded.check
      }
      if (args[0] === 'audit') return res.end(JSON.stringify({ command: describe(args), elapsedMs: 1, account: null, connection: null, ...audit.run(args), ok: true }))
      if (args[0] === 'clients' || (args[0] === 'fund' && ['accounts', 'manage', 'unmanage'].includes(args[1]))) return reply(clients.run(args))
      if (args[0] === 'fund' && args[1] === 'overview')
        return reply(overview(args, { portfolio: createPortfolio(() => bot.now()), clients, sessions: () => [...bot.state.sessions.values()], now: () => bot.now() }))
      // The fund's portfolios, on the bot's clock (so /__mock/advance moves them too).
      if (args[0] === 'portfolio' || args[0] === 'activity') {
        const fund = createPortfolio(() => bot.now())
        return reply(args[0] === 'portfolio' ? fund.portfolio(args) : fund.activity(args))
      }
      // A client's statement: a client gets their own (Fund/Statements.cs), staff and the owner name the client.
      if (args[0] === 'statement') {
        const at = args.indexOf('--client')
        const asked = at >= 0 ? Number(args[at + 1]) : null
        const own = person?.role === 'client' ? clients.clientOf(person.login) : null
        const failed = (message) => reply({ exitCode: 1, output: message, blocks: [], error: { message, hint: null }, json: null })
        if (person?.role === 'client' && own == null) return failed('You are not linked to a client yet: the fund links you when your account is ready.')
        if (own != null && asked != null && asked !== own) return failed(`Client ${asked} is not yours.`)
        const id = own ?? asked
        if (id == null) return failed("Give the client: --client <ID> ('clients list' shows them).")
        const client = clients.get(id)
        if (!client) return failed(`No client ${id}. 'clients list' shows them.`)
        return reply(createPortfolio(() => bot.now()).statement(args, client))
      }

      const token = caller.kind === 'person' ? null : String(req.headers['x-beyondbot-connection'] ?? '').trim() || null
      const picked = String(req.headers['x-beyondbot-account'] ?? '').trim() || null
      const connection = caller.kind === 'person' ? personal.get(caller.person.login) : token ? connections.get(token) : { accounts: [], current: null }
      if (!connection) {
        res.statusCode = 403
        return res.end(JSON.stringify(refused(describe(args), { message: 'This connection has expired or is unknown; log in again.', hint: 'Send login without X-BeyondBot-Connection to start a new connection.' })))
      }
      const account = picked ? connection.accounts.find((login) => login.toLowerCase() === picked.toLowerCase()) : null
      if (picked && !account) {
        res.statusCode = 403
        return res.end(JSON.stringify(refused(describe(args), { message: `This connection is not signed in to '${picked}'.`, hint: `Sign in to it first: login ${picked}` })))
      }

      const controller = new AbortController()
      res.on('close', () => {
        if (!res.writableEnded) controller.abort()
      })
      const run = gate.then(async () => {
        if (controller.signal.aborted) return null
        const started = performance.now()
        const result = await bot.run(args, { signal: controller.signal, connection, account })
        return { result, elapsedMs: Math.round(performance.now() - started) }
      })
      gate = run.catch(() => {})
      const done = await run
      if (!done) return
      const { result, elapsedMs } = done
      // A new connection that signed in gets its token, once; one that did not is forgotten.
      let issued = null
      if (caller.kind !== 'person' && !token && connection.accounts.length) {
        issued = randomBytes(32).toString('base64url')
        connections.set(issued, connection)
      }
      // A client's check from the menu: their limits' refusal first, and the largest budget they allow.
      if (menuCheck && result.json && typeof result.json === 'object') {
        result.json.largestBudget = menuCheck.largest
        if (menuCheck.refusal) Object.assign(result.json, { wouldStart: false, refusal: menuCheck.refusal, text: `${menuCheck.refusal} ${result.json.text}` })
      }
      const answer = { command: describe(args), exitCode: result.exitCode, elapsedMs, output: result.output, blocks: result.blocks, error: result.error, json: result.json ?? null, ok: result.exitCode === 0, account: result.account ?? null, connection: issued }
      audit.record(args, caller, result)
      if (log) console.log(`API: ${answer.command} → exit code ${answer.exitCode} in ${elapsedMs} ms`)
      if (!res.writableEnded) res.end(JSON.stringify(answer))
    })
  })

  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, key, bot: () => bot, close: () => new Promise((done) => { bot.stop(); server.close(done) }) })),
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const value = (name, fallback) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : fallback
  }
  const running = await startServer({
    port: Number(value('--port', process.env.MOCK_BOT_PORT ?? 8443)),
    key: process.env.MOCK_BOT_KEY ?? DEFAULT_KEY,
    origins: process.env.MOCK_BOT_ORIGINS ?? '*',
    control: argv.includes('--control'),
    log: !argv.includes('--quiet'),
    botOptions: {
      speed: Number(value('--speed', process.env.MOCK_BOT_SPEED ?? 1)),
      signedIn: !argv.includes('--signed-out'),
      orderingBug: argv.includes('--ordering-bug'),
      addDelayMs: Number(value('--add-delay', 3500)),
      start: value('--now', null) ? Date.parse(value('--now', null)) : undefined,
    },
  })
  console.log(`Mock Beyond Bot on http://127.0.0.1:${running.port}/  key: ${running.key}`)
}
