import { useCommand } from '../../api/bot.ts'
import { parsed, unreadable, type Parsed } from '../../api/parse/blocks.ts'
import type { CommandResult } from '../../api/types.ts'

/** A person who signs in (`people list --json`, Fund/People.cs PersonView in Beyond-Bot-Bybit). */
export type Person = { login: string; name: string; email: string | null; role: 'owner' | 'staff' | 'client'; mustChangePassword: boolean; codeSet: boolean; disabled: boolean; createdAt: string; sessions: number }

/** One line of the audit log (`audit --json`, Persistence/IAuditRepository.cs AuditEntry): what changed, who asked, how it ended. */
export type AuditEntry = { id: number; at: string; via: string; person: string | null; role: string | null; account: string | null; command: string; outcome: 'done' | 'refused' | 'failed' | string; exitCode: number | null; error: string | null }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const str = (value: unknown) => (typeof value === 'string' ? value : null)
const ROLES = ['owner', 'staff', 'client'] as const

export function parsePeople(result: CommandResult): Parsed<Person[]> {
  if (!Array.isArray(result.json)) return unreadable('No list of people in the answer.')
  return parsed(
    result.json.filter(isObject).flatMap((p) =>
      typeof p.login === 'string' && ROLES.includes(p.role as Person['role'])
        ? [{ login: p.login, name: str(p.name) ?? p.login, email: str(p.email), role: p.role as Person['role'], mustChangePassword: p.mustChangePassword === true, codeSet: p.codeSet === true, disabled: p.disabled === true, createdAt: str(p.createdAt) ?? '', sessions: typeof p.sessions === 'number' ? p.sessions : 0 }]
        : [],
    ),
  )
}

export function parseAudit(result: CommandResult): Parsed<AuditEntry[]> {
  if (!Array.isArray(result.json)) return unreadable('No audit lines in the answer.')
  return parsed(
    result.json.filter(isObject).flatMap((e) =>
      typeof e.command === 'string' && typeof e.at === 'string'
        ? [{ id: typeof e.id === 'number' ? e.id : 0, at: e.at, via: str(e.via) ?? '', person: str(e.person), role: str(e.role), account: str(e.account), command: e.command, outcome: str(e.outcome) ?? '', exitCode: typeof e.exitCode === 'number' ? e.exitCode : null, error: str(e.error) }]
        : [],
    ),
  )
}

export const usePeople = () => useCommand('people', ['people', 'list', '--json'], parsePeople, { staleTime: 10_000 })
export const useAudit = (last: number, person: string | null) =>
  useCommand('audit', ['audit', '--last', String(last), ...(person ? ['--person', person] : []), '--json'], parseAudit, { staleTime: 10_000, refetchInterval: 60_000 })

/** How far a person's sign-in got, in words. */
export function signInWords(person: Person): string {
  if (person.disabled) return 'Disabled'
  if (person.mustChangePassword) return 'Has a temporary password'
  if (!person.codeSet) return 'Adds their code app at the next sign-in'
  return person.sessions ? `Signed in on ${person.sessions} device${person.sessions === 1 ? '' : 's'}` : 'Signed out'
}

// No 0/O, 1/l/I: read aloud or typed from a message, they are easy to mistake.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A temporary password for a person (the bot asks at least 8 characters; their first sign-in replaces it). */
export function temporaryPassword(length = 14): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('')
}
