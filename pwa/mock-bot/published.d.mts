import type { CommandResult } from '../src/api/types.ts'

type Answer = Omit<CommandResult, 'command' | 'elapsedMs' | 'ok' | 'account' | 'connection'>
type Person = { login: string; role: string; trusted?: boolean } | null | undefined

export type MockPublished = { run(args: string[], person?: Person): Answer }

export function createPublished(options: {
  setupOf: (id: number) => { id: number; name: string; strategy: string; market: string; sizing: string; describe?: string } | null
  sees: (person: Person) => boolean
  now?: () => number
}): MockPublished
