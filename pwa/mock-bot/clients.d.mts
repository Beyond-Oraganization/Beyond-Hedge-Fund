import type { CommandResult } from '../src/api/types.ts'

type Answer = Omit<CommandResult, 'command' | 'elapsedMs' | 'ok' | 'account' | 'connection'>

export type MockClients = {
  accountsOf(login: string): string[]
  clientOf(login: string): number | null
  run(args: string[]): Answer
}

export function createClients(roleOf: (login: string) => string | null, now?: () => number): MockClients
