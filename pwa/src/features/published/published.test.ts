import { describe, expect, it } from 'vitest'
import type { StrategyInput } from '../../api/commands.ts'
import type { StrategyDefinition } from '../../api/parse/strategies.ts'
import type { CommandResult } from '../../api/types.ts'
import type { DeviceResult } from '../../backtest/runs.ts'
import type { MenuSetup } from '../menu/menu.ts'
import { deviceAnswer } from '../../backtest/fixtures.ts'
import { keep } from '../../backtest/runs.ts'
import { newestBySetup, parsePublished, publishArgs, ranSetup, renameArgs, testedWords, type PublishedBacktest } from './published.ts'

/** Published backtests (`published list|add|update`, bot 2.4.0): what everyone reads of how a menu setup was tested. */

const row = (patch: Partial<PublishedBacktest> = {}): PublishedBacktest => ({
  id: 1, setupId: 1, setupName: 'Gold trend, steady', title: 'Gold 2024–2026', note: null, strategy: '', market: 'XAUUSD 1h', strategySetup: '', sizing: 'percent:25',
  from: '2024-01-01T00:00:00Z', to: '2026-11-01T00:00:00Z', candles: null, initialBalance: 1000, finalBalance: 1412, returnPercent: 41.2, trades: 86, wins: 51,
  losses: 35, winRate: 59.3, maxDrawdownPercent: 9.4, backtestId: null, publishedBy: 'alice', publishedAt: '2026-11-16T10:00:00Z', updatedAt: '2026-11-16T10:00:00Z', measures: null, ...patch,
})

const definition = {
  name: 'sample', title: 'Sample', description: '', defaultMarket: null,
  parameters: [{ name: 'length', default: 20, min: 1, max: 500, meaning: '', whole: true }, { name: 'spread', default: 1, min: 1, max: 20, meaning: '', whole: true }],
  rules: { defaults: ['open long on cross up floor 1'], syntax: 'open|close long|short on cross up|down floor|ceiling N' },
  sizing: { default: 'percent:50', syntax: '', methods: [] },
} as unknown as StrategyDefinition

const setup: MenuSetup = {
  id: 3, name: 'Gold trend, steady', description: '', risk: 'steady', strategy: 'sample', market: 'XAUUSD 1h', parameters: { length: 30 }, rules: [], sizing: 'percent:25',
  backtestId: null, withdrawn: false, createdAt: '',
}

const input: StrategyInput = { strategy: 'sample', symbol: 'XAUUSD', interval: '1h', params: { length: 30, spread: 1 }, rules: ['open long on cross up floor 1'], sizing: 'percent:25' }

describe('reading what was published', () => {
  it('keeps every row the bot sent, the strategy left empty for a client the fund does not trust', () => {
    const result = { json: [row(), { id: 'nope' }] } as unknown as CommandResult
    const parsed = parsePublished(result)

    expect(parsed.ok && parsed.value.map((p) => [p.title, p.strategy, p.returnPercent])).toEqual([['Gold 2024–2026', '', 41.2]])
  })

  it('finds each setup’s newest one (the list is newest first)', () => {
    const newest = newestBySetup([row({ id: 7 }), row({ id: 2 }), row({ id: 5, setupId: null })])

    expect([...newest].map(([setupId, p]) => [setupId, p.id])).toEqual([[1, 7]])
  })

  it('says how it was tested in a client’s words', () => {
    expect(testedWords(row())).toBe('Tested from 2024-01-01 to 2026-11-01: +41.20%, 86 trades, 59.3% of them won, deepest fall 9.4%.')
  })
})

describe('which setup a run on this device may be published for', () => {
  it('is one it ran exactly, the strategy’s defaults filling in what the setup leaves out', () => {
    expect(ranSetup(input, setup, definition)).toBe(true)
  })

  it('is not one of other parameters, rules, sizing or market', () => {
    expect(ranSetup({ ...input, params: { length: 31, spread: 1 } }, setup, definition)).toBe(false)
    expect(ranSetup({ ...input, rules: ['open long on cross up floor 2'] }, setup, definition)).toBe(false)
    expect(ranSetup({ ...input, sizing: 'percent:50' }, setup, definition)).toBe(false)
    expect(ranSetup({ ...input, symbol: 'EURPLN' }, setup, definition)).toBe(false)
  })
})

describe('the commands', () => {
  it('publishes a run’s figures, its times as UTC without the Z', () => {
    const result = { start: '2024-01-01T00:00:00Z', end: '2026-11-01T00:00:00.000Z', candles: 12_000, initialBalance: 1000, finalBalance: 1412.5, closedTrades: 86, won: 51, lost: 35, maxDrawdownPercent: 9.41234567 } as DeviceResult

    expect(publishArgs(3, result, { title: 'Gold 2024–2026', note: ' Before fees. ' })).toEqual([
      'published', 'add', '--setup', '3', '--title', 'Gold 2024–2026', '--note', 'Before fees.', '--from', '2024-01-01T00:00:00', '--to', '2026-11-01T00:00:00',
      '--candles', '12000', '--initial', '1000', '--final', '1412.5', '--trades', '86', '--wins', '51', '--losses', '35', '--drawdown', '9.4123', '--json',
    ])
  })

  it('sends a run’s Sharpe, beta, alpha and marked drawdown too, from engine 2.7.0 on', () => {
    const result = keep(deviceAnswer())

    const args = publishArgs(3, result, { title: 'Gold', note: '' })

    expect(args.slice(args.indexOf('--sharpe'), -1)).toEqual([
      '--sharpe', '5.78', '--psr', '0.836', '--beta', '0.645614', '--alpha', '73.6404', '--alpha-t', '5.75961', '--equity-drawdown', '-5', '--risk-free', '0',
    ])
  })

  it('reads the measures the bot published with a backtest, and none from an older bot', () => {
    const measures = { sharpe: 1.21, psr: 0.93, beta: 0.32, annualAlpha: -0.007, alphaT: -0.07, equityDrawdownPercentage: -11.2, riskFree: 0, any: true }
    const parsed = parsePublished({ json: [{ ...row(), measures }, row()] } as unknown as CommandResult)

    expect(parsed.ok && parsed.value.map((p) => p.measures?.sharpe ?? null)).toEqual([1.21, null])
  })

  it('changes the words, removing an emptied note', () => {
    expect(renameArgs(4, { title: ' New ', note: '' })).toEqual(['published', 'update', '4', '--title', 'New', '--no-note', '--json'])
  })
})
