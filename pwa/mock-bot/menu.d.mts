import type { CommandResult } from '../src/api/types.ts'

type Answer = Omit<CommandResult, 'command' | 'elapsedMs' | 'ok' | 'account' | 'connection'>
type Person = { login: string; role: string } | null | undefined
type Check = { refusal: string | null; largest: number | null } | null

export function sessionNameOf(name: string): string

export type MockMenu = {
  run(args: string[], person?: Person): Answer
  limits(args: string[]): Answer
  expand(args: string[], person: Person, context: { balance: number; currency: string; sessions: string[]; live: boolean }): { answer: Answer } | { args: string[]; check: Check }
}

export function createMenu(options: { clientOf: (login: string) => number | null; now?: () => number }): MockMenu
