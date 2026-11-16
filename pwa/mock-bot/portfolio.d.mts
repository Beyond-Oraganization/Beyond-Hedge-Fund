import type { CommandResult } from '../src/api/types.ts'

type Answer = Omit<CommandResult, 'command' | 'elapsedMs' | 'ok' | 'account' | 'connection'>

export type MockPortfolio = {
  portfolio(args: string[]): Answer
  activity(args: string[]): Answer
  statement(args: string[], client: { id: number; name: string; accounts: string[] }): Answer
}

export function createPortfolio(now: () => number): MockPortfolio
