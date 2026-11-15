import type { CommandResult } from '../../api/types.ts'

/**
 * `trading check --json` (Cli/Rendering/SizingViews.cs TradingCheckJson, bot 2.4.0): what a start would trade with, before
 * starting. `wouldStart` is false with the `refusal` a start would give; `text` says it all in a sentence.
 */
export type StartCheck = { wouldStart: boolean; refusal: string | null; text: string; room: number | null; unchecked: string | null }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export function readCheck(result: CommandResult): StartCheck | null {
  const json = result.json
  if (!isObject(json) || typeof json.wouldStart !== 'boolean') return null
  const budget = isObject(json.budget) ? json.budget : null
  return {
    wouldStart: json.wouldStart,
    refusal: typeof json.refusal === 'string' ? json.refusal : null,
    text: typeof json.text === 'string' ? json.text : '',
    room: budget && typeof budget.room === 'number' ? budget.room : null,
    unchecked: typeof json.unchecked === 'string' ? json.unchecked : null,
  }
}

/** A budget as typed: an amount above 0 ("4,000" and "4000.50" are fine), or why not; empty means none. */
export function readBudget(text: string): { amount: number | null; error: string | null } {
  const trimmed = text.trim().replace(/[,\s]/g, '')
  if (!trimmed) return { amount: null, error: null }
  const amount = Number(trimmed)
  if (!Number.isFinite(amount) || amount <= 0) return { amount: null, error: 'An amount above 0, in the account’s currency, e.g. 4000.' }
  return { amount: Math.round(amount * 100) / 100, error: null }
}
