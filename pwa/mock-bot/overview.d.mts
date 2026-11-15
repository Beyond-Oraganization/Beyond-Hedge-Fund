import type { CommandResult } from '../src/api/types.ts'
import type { MockClients } from './clients.mjs'
import type { MockPortfolio } from './portfolio.mjs'

type Answer = Omit<CommandResult, 'command' | 'elapsedMs' | 'ok' | 'account' | 'connection'>
type Session = { name: string; key: string; lastTick: { outcome: string; error?: string | null } | null }

export function overview(args: string[], fund: { portfolio: MockPortfolio; clients: MockClients; sessions: () => Session[]; now: () => number }): Answer
