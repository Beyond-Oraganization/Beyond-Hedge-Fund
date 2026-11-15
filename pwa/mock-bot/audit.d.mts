import type { CommandResult } from '../src/api/types.ts'

type Answer = Omit<CommandResult, 'command' | 'elapsedMs' | 'ok' | 'account' | 'connection'>

export type MockAudit = {
  record(args: string[], caller: { kind: string; person?: { login: string; role: string } } | null, result: { exitCode: number; error: { message: string } | null; refused?: boolean }): void
  run(args: string[]): Answer
}

export function createAudit(now?: () => number): MockAudit
