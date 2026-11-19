/**
 * A Web Worker that runs the bot's backtest engine (its Core, compiled to WebAssembly), so a backtest never blocks
 * the page. The .NET runtime starts on the first message and stays up for the next ones. A Monte Carlo runs in
 * several of these at once, each with its share of the scenarios.
 */

import type { CandleColumns, ConversionColumns } from './types.ts'

export type WorkerCall =
  | { id: number; base: string; kind: 'version' }
  /** The strategy pack's bytes (the engine ships without strategies): loaded once per worker, before its first backtest. */
  | { id: number; base: string; kind: 'load'; pack: number[] }
  | { id: number; base: string; kind: 'backtest'; request: string; candles: CandleColumns; conversion: ConversionColumns }
  | { id: number; base: string; kind: 'simulate'; request: string; candles: CandleColumns; first: number; count: number; conversion: ConversionColumns }
  | { id: number; base: string; kind: 'planConversion'; request: string }
  | { id: number; base: string; kind: 'combine'; request: string }
  | { id: number; base: string; kind: 'planSweep'; request: string }
  | { id: number; base: string; kind: 'sweep'; request: string; candles: CandleColumns; first: number; count: number; conversion: ConversionColumns }
  | { id: number; base: string; kind: 'summarizeSweep'; request: string }
  | { id: number; base: string; kind: 'summarize'; request: string }
  | { id: number; base: string; kind: 'levels'; request: string; candles: CandleColumns; count: number }

export type WorkerReply = { id: number; value: string } | { id: number; error: string }

type Columns = [openTimes: number[], open: number[], high: number[], low: number[], close: number[], volume: number[]]

type EngineExports = {
  Version: () => string
  LoadStrategies: (pack: number[]) => string
  /** Engine 2.8.0 on: the conversion's open times and closes follow the candles (the bot's ADR 0007). */
  Backtest: (request: string, ...columnsThenConversion: [...Columns, conversionTimes: number[], conversionCloses: number[]]) => string
  Simulate: (request: string, ...columnsRangeConversion: [...Columns, first: number, count: number, conversionTimes: number[], conversionCloses: number[]]) => string
  PlanConversion: (request: string) => string
  /** Engine 2.9.0 on. */
  Combine: (request: string) => string
  /** Engine 2.10.0 on. */
  PlanSweep: (request: string) => string
  Sweep: (request: string, ...columnsRangeConversion: [...Columns, first: number, count: number, conversionTimes: number[], conversionCloses: number[]]) => string
  SummarizeSweep: (request: string) => string
  Summarize: (request: string) => string
  Levels: (request: string, ...columnsThenCount: [...Columns, count: number]) => string
}

type DotnetModule = {
  dotnet: { create: () => Promise<{ getConfig: () => { mainAssemblyName?: string }; getAssemblyExports: (name: string) => Promise<unknown> }> }
}

let engine: Promise<EngineExports> | null = null

// The app's TypeScript knows the page's globals, not a worker's: name only what this worker uses.
const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<WorkerCall>) => void) => void
  postMessage: (message: WorkerReply) => void
}

/** Starts .NET from the engine folder (`engine/framework/dotnet.js`, published by the bot's scripts/publish-engine.sh). */
async function start(base: string): Promise<EngineExports> {
  const { dotnet } = (await import(/* @vite-ignore */ new URL('framework/dotnet.js', base).href)) as DotnetModule
  const runtime = await dotnet.create()
  const exports = (await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName ?? 'BeyondBot.Browser')) as { BeyondBot: { Browser: { Engine: EngineExports } } }
  return exports.BeyondBot.Browser.Engine
}

/** .NET takes plain arrays of numbers; a typed array would not marshal as one. */
const columns = ({ time, open, high, low, close, volume }: CandleColumns): Columns => [
  Array.from(time),
  Array.from(open),
  Array.from(high),
  Array.from(low),
  Array.from(close),
  Array.from(volume),
]

function answer(exports: EngineExports, call: WorkerCall): string {
  switch (call.kind) {
    case 'version':
      return exports.Version()
    case 'load':
      return exports.LoadStrategies(call.pack)
    case 'backtest':
      return exports.Backtest(call.request, ...columns(call.candles), call.conversion.time, call.conversion.close)
    case 'simulate':
      return exports.Simulate(call.request, ...columns(call.candles), call.first, call.count, call.conversion.time, call.conversion.close)
    case 'planConversion':
      return exports.PlanConversion(call.request)
    case 'combine':
      return exports.Combine(call.request)
    case 'planSweep':
      return exports.PlanSweep(call.request)
    case 'sweep':
      return exports.Sweep(call.request, ...columns(call.candles), call.first, call.count, call.conversion.time, call.conversion.close)
    case 'summarizeSweep':
      return exports.SummarizeSweep(call.request)
    case 'summarize':
      return exports.Summarize(call.request)
    case 'levels':
      return exports.Levels(call.request, ...columns(call.candles), call.count)
  }
}

// A listener, never `self.onmessage`: .NET's runtime takes over a worker's onmessage while it starts, and with one
// assigned dotnet.create() never resolves (found with the app's end-to-end tests).
scope.addEventListener('message', async ({ data }: MessageEvent<WorkerCall>) => {
  try {
    engine ??= start(data.base)
    scope.postMessage({ id: data.id, value: answer(await engine, data) })
  } catch (error) {
    engine = null
    scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  }
})
