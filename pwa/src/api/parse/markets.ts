import type { CommandResult } from '../types.ts'
import { findTable, parsed, rowsOf, topLines, unreadable, type Parsed } from './blocks.ts'
import { parseDuration, parseElapsed, parseNumber, parseTime } from './format.ts'

export type MarketRow = {
  symbol: string
  /** Interval code, or null for a symbol stored without intervals. */
  interval: string | null
  candles: number
  first: number | null
  newest: number | null
  /** Seconds since the newest candle closed. */
  age: number | null
  trading: boolean
}

/** `market list`: table Symbol, Interval, Candles, First, Newest, Age, Trading (Cli/Commands/MarketCommands.cs). */
export function parseMarketList(result: CommandResult): Parsed<MarketRow[]> {
  const table = findTable(result.blocks, ['Symbol', 'Interval', 'Candles', 'Newest'])
  if (!table) return topLines(result.blocks).some((line) => line.startsWith('No markets yet')) ? parsed([]) : unreadable('No market table in the answer.')
  return parsed(
    rowsOf(table).map((row) => ({
      symbol: row.Symbol ?? '',
      interval: row.Interval && row.Interval !== 'none' ? row.Interval : null,
      candles: parseNumber(row.Candles) ?? 0,
      first: parseTime(row.First),
      newest: parseTime(row.Newest),
      age: parseDuration(row.Age),
      trading: row.Trading === 'yes',
    })),
  )
}

export type SyncRow = { market: string; added: number; newest: number | null; tookMs: number | null }

/** `market sync`: table Market, New candles, Newest candle, Took. */
export function parseMarketSync(result: CommandResult): Parsed<SyncRow[]> {
  const table = findTable(result.blocks, ['Market', 'New candles'])
  if (!table) return unreadable('No sync table in the answer.')
  return parsed(
    rowsOf(table).map((row) => ({
      market: row.Market ?? '',
      added: parseNumber(row['New candles']) ?? 0,
      newest: parseTime(row['Newest candle']),
      tookMs: parseElapsed(row.Took),
    })),
  )
}

export type CandleRow = { time: number; open: number; high: number; low: number; close: number; volume: number }

/** `candles show`: table Open (UTC), Open, High, Low, Close, Volume; oldest first. */
export function parseCandles(result: CommandResult): Parsed<CandleRow[]> {
  const table = findTable(result.blocks, ['Open (UTC)', 'Open', 'High', 'Low', 'Close'])
  if (!table) return topLines(result.blocks).some((line) => / candles stored/.test(line)) ? parsed([]) : unreadable('No candle table in the answer.')
  const rows: CandleRow[] = []
  for (const row of rowsOf(table)) {
    const time = parseTime(row['Open (UTC)'])
    const open = parseNumber(row.Open)
    const high = parseNumber(row.High)
    const low = parseNumber(row.Low)
    const close = parseNumber(row.Close)
    if (time == null || open == null || high == null || low == null || close == null) return unreadable(`Unreadable candle row: ${Object.values(row).join(' ')}`)
    rows.push({ time, open, high, low, close, volume: parseNumber(row.Volume) ?? 0 })
  }
  return parsed(rows.sort((a, b) => a.time - b.time))
}

/** `candles oldest`: "cTrader's oldest XAUUSD 1h candle opened 2019-01-02 23:00 UTC (close 1,284.5)." */
export function parseOldestCandle(result: CommandResult): Parsed<{ broker: string; time: number; close: number | null }> {
  for (const line of topLines(result.blocks)) {
    const match = /^(.+?)'s oldest .+? candle opened (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC \(close ([^)]+)\)\.?$/.exec(line)
    if (match) {
      const time = parseTime(match[2])
      if (time != null) return parsed({ broker: match[1] ?? '', time, close: parseNumber(match[3]) })
    }
  }
  return unreadable('No oldest-candle line in the answer.')
}
