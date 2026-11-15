// The mock bot's people, as the real bot has them (Fund/ in Beyond-Bot-Bybit): signin with a password and a 6-digit
// code, a token (bbp_…) as the bearer afterwards, me and signout, and the policy of what each role may run
// (Fund/CommandPolicy.cs, copied below). Everyone's password is demo-password, except newbie's temporary one.
//
//   olga   owner    signed in before: password, then any 6-digit code but 000000
//   sam    staff    the same
//   carol  client   the same; reaches the demo account (her client's)
//   newbie staff    first sign-in: temporary-1, then a password of their own, then adds the code app
//
// A code of 000000 is always wrong, so a test can see a refused code.
import { randomBytes } from 'node:crypto'

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const PREFIX = 'bbp_'

const PEOPLE = () => [
  { login: 'olga', name: 'Olga Example', email: null, role: 'owner', password: 'demo-password', mustChange: false, codeSet: true },
  { login: 'sam', name: 'Sam Example', email: null, role: 'staff', password: 'demo-password', mustChange: false, codeSet: true },
  { login: 'carol', name: 'Carol Example', email: 'carol@example.com', role: 'client', password: 'demo-password', mustChange: false, codeSet: true },
  { login: 'newbie', name: 'Newbie Example', email: null, role: 'staff', password: 'temporary-1', mustChange: true, codeSet: false },
]

// The real bot's table: each command's lowest role (client < staff < owner); one it does not know is the owner's alone.
const BRANCHES = new Set(['market', 'candles', 'indicators', 'trading', 'orders', 'people', 'fund', 'clients', 'cashflows'])
const RANK = { client: 0, staff: 1, owner: 2 }
const RULES = {
  help: 'client', me: 'client', signin: 'client', signout: 'client', portfolio: 'client', activity: 'client',
  accounts: 'client', use: 'client', balance: 'client', positions: 'client', 'trading status': 'client', 'orders list': 'client',
  status: 'staff', audit: 'staff', login: 'staff', logout: 'staff', session: 'staff',
  'market list': 'staff', 'market add': 'staff', 'market sync': 'staff', 'candles show': 'staff', 'candles export': 'staff', 'candles oldest': 'staff',
  'indicators show': 'staff', strategies: 'staff', signal: 'staff', backtest: 'staff', backtests: 'staff', kelly: 'staff',
  'trading start': 'staff', 'trading stop': 'staff', 'trading check': 'staff', 'trading minimum': 'staff', 'orders place': 'staff', 'orders close': 'staff',
  'fund accounts': 'staff', 'fund overview': 'staff', 'cashflows list': 'staff', 'cashflows add': 'staff', 'clients list': 'staff', 'clients add': 'staff', 'clients link': 'staff', 'clients unlink': 'staff',
  register: 'owner', credentials: 'owner', 'market remove': 'owner', 'orders clear': 'owner', 'fund manage': 'owner', 'fund unmanage': 'owner',
}
const PEOPLE_COMMANDS = ['list', 'add', 'role', 'disable', 'enable', 'reset-code', 'reset-password']
for (const command of PEOPLE_COMMANDS) RULES[`people ${command}`] = 'owner'

function key(args) {
  const [first, second] = args
  if (first === undefined) return null
  if (['--help', '-h', '--version', '-v', 'help'].includes(first)) return 'help'
  if (!BRANCHES.has(first)) return first
  return second !== undefined && !second.startsWith('-') ? `${first} ${second}` : 'help'
}

const option = (args, name) => {
  const inline = args.find((a) => a.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const at = args.indexOf(name)
  return at >= 0 ? (args[at + 1] ?? null) : null
}

const answer = (json, text, asJson) => ({ exitCode: 0, output: asJson ? JSON.stringify(json, null, 2) : text, blocks: [{ type: 'text', text }], error: null, json: asJson ? json : null })
const failed = (message, hint = null) => ({ exitCode: 1, output: message, blocks: [], error: { message, hint }, json: null })

export function createPeople() {
  const people = PEOPLE()
  const tokens = new Map() // token → { login, device, endsAt }
  const used = new Map() // login → the last code used, so a code works once
  const failures = new Map() // login → wrong tries in a row

  const view = (person, session) => ({
    via: 'person', login: person.login, name: person.name, email: person.email, role: person.role, device: session?.device ?? null, endsAt: session?.endsAt ?? null,
  })

  return {
    /** The person a bearer token names, with their session; null for anything else (the API key is checked before). */
    authenticate(bearer) {
      if (!bearer?.startsWith(PREFIX)) return null
      const session = tokens.get(bearer)
      const person = session && people.find((p) => p.login === session.login)
      return person ? { person, session, token: bearer } : null
    },

    /** Why the person may not run these arguments (the real bot's message), or null when they may. */
    refusal(person, args) {
      if (person.role === 'owner') return null
      const k = key(args)
      const lowest = RULES[k]
      if (lowest && RANK[person.role] >= RANK[lowest]) return null
      if (!lowest) return `'${k ?? args[0]}' is not a command you can run.`
      return lowest === 'owner' ? `Only the owner can run '${k}'.` : `Only the fund's staff and owner can run '${k}'.`
    },

    /** The accounts a person's connection holds: the mock's one account, for staff, the owner and carol (her client's). */
    accountsOf: () => ['demo'],

    /** `people list|add|role|disable|enable|reset-code|reset-password` (Cli/Commands/PeopleCommands.cs), the owner's. */
    manage(args) {
      const asJson = args.includes('--json')
      const view = (p) => ({ login: p.login, name: p.name, email: p.email, role: p.role, mustChangePassword: p.mustChange, codeSet: p.codeSet, disabled: Boolean(p.disabled),
        createdAt: p.createdAt ?? '2026-11-01T09:00:00Z', sessions: [...tokens.values()].filter((t) => t.login === p.login).length })
      const signOut = (login) => { for (const [token, session] of tokens) if (session.login === login) tokens.delete(token) }
      const sub = args[1]
      if (sub === 'list') return answer(people.map(view), people.map((p) => `${p.login} ${p.role}`).join('\n'), asJson)
      const login = args[2]?.toLowerCase()
      if (sub === 'add') {
        const name = option(args, '--name'), email = option(args, '--email'), role = option(args, '--role'), password = option(args, '--password')
        if (!login || !/^[A-Za-z0-9._-]+$/.test(login)) return failed("A login may only contain letters, digits, '.', '_' and '-'.")
        if (!role) return failed('Give --role owner, staff or client.')
        if (!['owner', 'staff', 'client'].includes(role)) return failed(`'${role}' is not a role: owner, staff or client.`)
        if (!name) return failed('Give --name.')
        if (name.length > 100) return failed('A name has 1 to 100 characters.')
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return failed('That does not look like an e-mail address.')
        if (!password) return failed('Give a temporary --password; their first sign-in replaces it.')
        if (password.length < 8) return failed('A password has at least 8 characters.')
        if (people.some((p) => p.login === login)) return failed(`The login '${args[2]}' is taken; choose another.`)
        people.push({ login, name, email: email ?? null, role, password, mustChange: true, codeSet: false, disabled: false, createdAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z') })
        return answer(null, `Added ${login} (${name}), ${role}. Give them the temporary password; at their first sign-in they choose their own and add their code app.`, false)
      }
      const person = people.find((p) => p.login === login)
      if (!person) return failed(`No person '${args[2] ?? ''}'. 'people list' shows who there is.`)
      switch (sub) {
        case 'role': {
          const role = args[3]
          if (!role) return failed('Give the role: people role <LOGIN> owner|staff|client.')
          if (!['owner', 'staff', 'client'].includes(role)) return failed(`'${role}' is not a role: owner, staff or client.`)
          person.role = role
          return answer(null, `${login} is now ${role}.`, false)
        }
        case 'disable':
          person.disabled = true
          signOut(login)
          return answer(null, `${login} cannot sign in, and is signed out everywhere.`, false)
        case 'enable':
          person.disabled = false
          return answer(null, `${login} can sign in again.`, false)
        case 'reset-code':
          person.codeSet = false
          signOut(login)
          return answer(null, `${login} is signed out; their next sign-in adds their code app again.`, false)
        case 'reset-password': {
          const password = option(args, '--password')
          if (!password) return failed('Give the temporary --password.')
          if (password.length < 8) return failed('A password has at least 8 characters.')
          person.password = password
          person.mustChange = true
          signOut(login)
          return answer(null, `${login} is signed out; their next sign-in replaces the temporary password.`, false)
        }
        default:
          return failed(`Unknown people command '${sub}'.`)
      }
    },

    /** A person's role, or null when there is no such person (for the clients' rules). */
    roleOf: (login) => people.find((p) => p.login === login?.toLowerCase())?.role ?? null,

    signin(args) {
      const login = args[1]?.toLowerCase()
      const password = option(args, '--password')
      const newPassword = option(args, '--new-password')
      const code = option(args, '--code')
      const asJson = args.includes('--json')
      const person = people.find((p) => p.login === login)
      if ((failures.get(login) ?? 0) >= 5) return failed(`Too many attempts for '${args[1]}'; try again in 60 s.`)
      if (!password) return failed('Give the password: signin <LOGIN> --password <PASSWORD>.')
      if (person?.disabled) return failed('Invalid login or password.')
      if (!person || person.password !== password) {
        if (person) failures.set(login, (failures.get(login) ?? 0) + 1)
        return failed('Invalid login or password.')
      }
      if (person.mustChange) {
        if (!newPassword) return answer({ status: 'newPasswordRequired' }, 'The password is temporary: send it again with --new-password.', asJson)
        if (newPassword.length < 8) return failed('A password has at least 8 characters.')
        if (newPassword === password) return failed('Choose a password of your own, not the one you were given.')
        person.password = newPassword
        person.mustChange = false
      }
      if (!code) {
        return person.codeSet
          ? answer({ status: 'codeRequired' }, 'Send the 6-digit code of your code app with --code.', asJson)
          : answer({ status: 'codeSetup', secret: SECRET, link: `otpauth://totp/Beyond%20Hedge%20Fund:${person.login}?secret=${SECRET}&issuer=Beyond%20Hedge%20Fund&algorithm=SHA1&digits=6&period=30` },
              `Add Beyond Hedge Fund to your code app with this secret: ${SECRET}`, asJson)
      }
      if (!/^\d{6}$/.test(code) || code === '000000' || used.get(login) === code) {
        failures.set(login, (failures.get(login) ?? 0) + 1)
        return failed('Invalid code.')
      }
      used.set(login, code)
      failures.delete(login)
      person.codeSet = true
      const token = PREFIX + randomBytes(32).toString('base64url')
      const session = { login: person.login, device: option(args, '--device'), endsAt: new Date(Date.now() + 12 * 3600_000).toISOString() }
      tokens.set(token, session)
      return answer({ status: 'signedIn', token, endsAt: session.endsAt, person: view(person, session) }, `Signed in as ${person.login}. Token: ${token}`, asJson)
    },

    me(caller, args) {
      const asJson = args.includes('--json')
      if (caller.kind === 'person') return answer(view(caller.person, caller.session), `${caller.person.name} (${caller.person.login}), ${caller.person.role}.`, asJson)
      return answer({ via: 'apiKey', login: null, name: null, email: null, role: 'owner', device: null, endsAt: null }, 'The owner, through the API key.', asJson)
    },

    signout(caller, args) {
      if (caller.kind !== 'person') return failed('signout is for people using the app with their own sign-in; the terminal and the API key are not signed in.')
      if (args.includes('--all')) {
        let ended = 0
        for (const [token, session] of tokens) if (session.login === caller.person.login) ended += tokens.delete(token) ? 1 : 0
        return answer(null, `Signed out on ${ended} device(s).`, false)
      }
      tokens.delete(caller.token)
      return answer(null, 'Signed out.', false)
    },
  }
}
