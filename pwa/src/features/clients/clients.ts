import { useCommand } from '../../api/bot.ts'
import { parsed, unreadable, type Parsed } from '../../api/parse/blocks.ts'
import type { CommandResult } from '../../api/types.ts'
import type { AccountPortfolio } from '../portfolio/portfolio.ts'

/** A client of the fund (`clients list --json`, Fund/Clients.cs in Beyond-Bot-Bybit): who signs in for it, which managed accounts are its. */
export type Client = { id: number; name: string; createdAt: string; people: string[]; accounts: string[] }

/** A managed account (`fund accounts --json`, Fund/ManagedAccounts.cs). */
export type ManagedAccount = { login: string; managedAt: string; open: boolean; broker: string | null; mode: string | null; sessions: number }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

const readClient = (value: unknown): Client | null =>
  isObject(value) && typeof value.id === 'number' && typeof value.name === 'string'
    ? { id: value.id, name: value.name, createdAt: typeof value.createdAt === 'string' ? value.createdAt : '', people: strings(value.people), accounts: strings(value.accounts) }
    : null

export function parseClients(result: CommandResult): Parsed<Client[]> {
  if (!Array.isArray(result.json)) return unreadable('No list of clients in the answer.')
  return parsed(result.json.map(readClient).filter((client): client is Client => client !== null))
}

export function parseManaged(result: CommandResult): Parsed<ManagedAccount[]> {
  if (!Array.isArray(result.json)) return unreadable('No list of managed accounts in the answer.')
  return parsed(
    result.json.filter(isObject).flatMap((a) =>
      typeof a.login === 'string'
        ? [{ login: a.login, managedAt: typeof a.managedAt === 'string' ? a.managedAt : '', open: a.open === true, broker: typeof a.broker === 'string' ? a.broker : null, mode: typeof a.mode === 'string' ? a.mode : null, sessions: typeof a.sessions === 'number' ? a.sessions : 0 }]
        : [],
    ),
  )
}

/** The id `clients add --json` answers with. */
export const addedId = (result: CommandResult) => (isObject(result.json) && typeof result.json.id === 'number' ? result.json.id : null)

export const useClients = () => useCommand('clients', ['clients', 'list', '--json'], parseClients, { staleTime: 10_000, persist: true })
export const useManaged = () => useCommand('managed', ['fund', 'accounts', '--json'], parseManaged, { staleTime: 10_000 })

/** What staff should do next for a client, in a word they can act on; `ok` when nothing is missing. */
export type Readiness = { tone: 'ok' | 'warn' | 'neutral'; words: string }

export function readiness(client: Client, portfolios: AccountPortfolio[]): Readiness {
  if (!client.accounts.length) return { tone: 'warn', words: 'No account linked' }
  if (!client.people.length) return { tone: 'warn', words: 'Nobody signs in' }
  const mine = portfolios.filter((p) => client.accounts.includes(p.login))
  if (mine.length && mine.every((p) => p.value == null)) return { tone: 'neutral', words: 'First value within the hour' }
  return { tone: 'ok', words: 'Ready' }
}
