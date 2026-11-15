import type { CommandResult } from '../src/api/types.ts'

type Answer = Omit<CommandResult, 'command' | 'elapsedMs' | 'ok' | 'account' | 'connection'>
type Person = { login: string; name: string; email: string | null; role: 'owner' | 'staff' | 'client' }
type Caller = { kind: 'apiKey' } | { kind: 'person'; person: Person; session: unknown; token: string }

export type MockPeople = {
  authenticate(bearer: string | null): { person: Person; session: unknown; token: string } | null
  refusal(person: Person, args: string[]): string | null
  accountsOf(person: Person): string[]
  roleOf(login: string): Person['role'] | null
  signin(args: string[]): Answer
  me(caller: Caller, args: string[]): Answer
  signout(caller: Caller, args: string[]): Answer
}

export function createPeople(): MockPeople
