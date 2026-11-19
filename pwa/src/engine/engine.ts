import type { WorkerCall, WorkerReply } from './worker.ts'
import type {
  CandleColumns,
  CombineAnswer,
  CombineRequest,
  ConversionColumns,
  ConversionPlanAnswer,
  ConversionPlanRequest,
  DeviceScenarios,
  EngineAnswer,
  EngineRequest,
  LevelsAnswer,
  SimulateAnswer,
  SummaryAnswer,
  SummaryRequest,
  SweepAnswer,
  SweepPlanAnswer,
  SweepRequest,
  SweepSummaryAnswer,
  SweepSummaryRequest,
  SweepTrial,
  SweepProblem,
  EngineFailure,
  DeviceSweep as DeviceSweepShare,
} from './types.ts'

/** No conversion: what a request without `conversion` sends. */
export const noConversion: ConversionColumns = { time: [], close: [] }

/** A sweep over one market, all its shares put together. */
export type SweepRun = { ok: true; engine: string; days: string[]; daysPerYear: number; holdOutStart: number; trials: SweepTrial[]; problems: SweepProblem[]; computedMs: number }

/** Trials per sweep call: one to ten, about a quarter of an even share per worker, so progress shows often and a slow share holds up little. */
export const sweepShareSize = (trials: number, workers: number) => Math.max(1, Math.min(10, Math.round(trials / (workers * 4))))

/** One backtest of {@link Engine.backtestAll}: a request, its candles, and its conversion's candles when it has one. */
export type BacktestJob = { request: EngineRequest; candles: CandleColumns; conversion?: ConversionColumns }

/** The strategies the engine runs: the pack the bot handed out (engine/pack.ts), identified by its SHA-256. */
export type EngineStrategies = { sha256: string; bytes: Uint8Array }

/**
 * Backtests on this device: the bot's own engine, in Web Workers. It ships without strategies (the app is public) and
 * runs the ones {@link Engine.setStrategies} gives it; without any, a backtest answers that none are loaded.
 */
export interface Engine {
  /** The strategy pack to run from now on, or null to run none. Another pack (or none) starts fresh workers. */
  setStrategies(strategies: EngineStrategies | null): void
  /**
   * Answers the request over the candles, or the bot's message for a wrong one; rejects when the engine cannot run. A
   * request with a `conversion` needs its hops' candles in `conversion`.
   */
  backtest(request: EngineRequest, candles: CandleColumns, signal?: AbortSignal, conversion?: ConversionColumns): Promise<EngineAnswer>
  /**
   * Backtests scenarios 0 to `count` − 1 of alternative price histories, shared out to several workers, and answers
   * them in scenario order. `onProgress` hears how many are done after each share.
   */
  simulate(
    request: EngineRequest,
    candles: CandleColumns,
    count: number,
    options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; conversion?: ConversionColumns },
  ): Promise<SimulateAnswer>
  /**
   * Backtests several requests at once, spread over the workers, and answers them in the jobs' order; `onProgress` hears
   * how many are done after each. A combined backtest's legs run this way.
   */
  backtestAll(jobs: BacktestJob[], options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<EngineAnswer[]>
  /** Adds up the legs of a combined backtest (engine 2.9.0 on): no candles, just their daily equity. */
  combine(request: CombineRequest, signal?: AbortSignal): Promise<CombineAnswer>
  /** How many trials a sweep has, its axes in the grid's order, and the trials the strategy refuses (engine 2.10.0 on). */
  planSweep(request: SweepRequest, signal?: AbortSignal): Promise<SweepPlanAnswer>
  /**
   * Runs every trial of a sweep over one market, shared out to the workers a few at a time; `onProgress` hears how many are
   * done after each share. The trials come back in their order, with the sweep's days.
   */
  sweep(
    request: SweepRequest,
    candles: CandleColumns,
    trials: number,
    options?: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void; conversion?: ConversionColumns },
  ): Promise<SweepRun | EngineFailure>
  /** Every cross-trial statistic of a sweep, once (engine 2.10.0 on). */
  summarizeSweep(request: SweepSummaryRequest, signal?: AbortSignal): Promise<SweepSummaryAnswer>
  /** Which of the device's markets turn the symbol's quote currency into another (engine 2.8.0 on), or why none does. */
  planConversion(request: ConversionPlanRequest, signal?: AbortSignal): Promise<ConversionPlanAnswer>
  /** Sums up the scenarios and ranks the real history among them. */
  summarize(request: SummaryRequest, signal?: AbortSignal): Promise<SummaryAnswer>
  /** The price levels the strategy's rules compare the last `count` candles with, from the strategy itself, for a chart. */
  levels(request: EngineRequest, candles: CandleColumns, count: number, signal?: AbortSignal): Promise<LevelsAnswer>
}

/** What the engine needs of a Web Worker; tests give it a fake one. */
export type EngineWorker = {
  postMessage(message: WorkerCall): void
  terminate(): void
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export type EngineOptions = {
  /** The engine's files: `engine/version.json` and `engine/framework/`. */
  base?: string
  /** The most workers a Monte Carlo runs in. */
  workers?: number
  spawn?: (name: string) => EngineWorker
}

/** The engine's own files, beside the app: `engine/version.json` and `engine/framework/`. */
export const engineBase = () => new URL('engine/', document.baseURI).href

/** What {@link poolSize} reads of the device; tests pass their own. */
export type DeviceTraits = { cores?: number; memoryGb?: number; touch?: boolean }

const thisDevice = (): DeviceTraits => ({
  cores: globalThis.navigator?.hardwareConcurrency,
  memoryGb: (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory,
  touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
})

/**
 * How many workers a Monte Carlo runs in: one per spare core, at most 6. Each loads its own engine and holds about
 * 150 to 200 MB while it works (measured with 45,000 candles in Chromium), so a device that says how much memory it
 * has gets one worker per 1.5 GB of it, and a phone that does not say (Safari) gets at most 3.
 */
export function poolSize({ cores = 2, memoryGb, touch = false }: DeviceTraits = thisDevice()): number {
  const byMemory = memoryGb ? Math.floor(memoryGb / 1.5) : touch ? 3 : 6
  return Math.max(1, Math.min(6, cores - 1, byMemory))
}

/** The engine was stopped before it answered (the person cancelled). */
export class EngineCancelled extends Error {
  constructor() {
    super('The backtest was cancelled.')
  }
}

const spawnWorker = (name: string): EngineWorker => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name })

/** Scenarios per call: small enough to report progress often, big enough that sending the candles costs little. */
export const shareSize = (count: number, workers: number) => Math.max(1, Math.min(25, Math.ceil(count / (workers * 5))))

/**
 * Shares items 0 to `count` − 1 out to `workers` workers, `step` at a time, each worker taking the next share as soon as
 * it is free (work stealing), so a slow share holds up no other worker. `run` answers false to stop handing out shares.
 */
export async function shareOut(count: number, step: number, workers: number, run: (worker: number, first: number, count: number) => Promise<boolean>): Promise<void> {
  const shares: [first: number, count: number][] = []
  for (let first = 0; first < count; first += step) shares.push([first, Math.min(step, count - first)])
  let taken = 0
  let stopped = false
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(workers, shares.length)) }, async (_, worker) => {
      while (taken < shares.length && !stopped) {
        const [first, share] = shares[taken++]!
        if (!(await run(worker, first, share))) stopped = true
      }
    }),
  )
}

/**
 * Workers started when first needed and kept for the next calls (starting .NET again would cost a second). The first
 * one backtests and sums up; a Monte Carlo uses up to `workers` of them. Cancelling stops them all; the next call
 * starts fresh ones.
 */
export function createEngine({ base = engineBase(), workers = poolSize(), spawn = spawnWorker }: EngineOptions = {}): Engine {
  const running: (EngineWorker | null)[] = []
  const waiting = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void }>()
  // Which workers loaded the current pack (by index), and the pack as the worker takes it: plain numbers.
  const loaded = new Map<number, Promise<void>>()
  let strategies: { sha256: string; numbers: number[] } | null = null
  let next = 0

  const stop = (error: Error) => {
    running.forEach((worker) => worker?.terminate())
    running.length = 0
    loaded.clear()
    for (const call of waiting.values()) call.reject(error)
    waiting.clear()
  }

  const worker = (index: number) => {
    const existing = running[index]
    if (existing) return existing
    const started = spawn(index ? `backtest engine ${index + 1}` : 'backtest engine')
    started.onmessage = ({ data }) => {
      const call = waiting.get(data.id)
      waiting.delete(data.id)
      if ('error' in data) call?.reject(new Error(`The backtest engine failed: ${data.error}`))
      else call?.resolve(data.value)
    }
    started.onerror = (event) => {
      event.preventDefault()
      stop(new Error(`The backtest engine could not start: ${event.message || 'its files did not load'}.`))
    }
    running[index] = started
    return started
  }

  type Message = WorkerCall extends infer Call ? (Call extends WorkerCall ? Omit<Call, 'id' | 'base'> : never) : never
  const send = (index: number, message: Message, signal?: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      if (signal?.aborted) return reject(new EngineCancelled())
      const id = ++next
      waiting.set(id, { resolve, reject })
      signal?.addEventListener('abort', () => stop(new EngineCancelled()), { once: true })
      worker(index).postMessage({ ...message, id, base } as WorkerCall)
    })

  // The pack reaches each worker once, before the first call that needs a strategy.
  const ensureLoaded = (index: number, signal?: AbortSignal) => {
    if (!strategies) return Promise.resolve()
    let load = loaded.get(index)
    if (!load) {
      load = send(index, { kind: 'load', pack: strategies.numbers }, signal).then((text) => {
        const answer = JSON.parse(text) as { ok: boolean; error?: { message: string } }
        if (!answer.ok) throw new Error(answer.error?.message ?? 'The engine refused the strategy pack.')
      })
      load.catch(() => loaded.delete(index))
      loaded.set(index, load)
    }
    return load
  }

  const call = async (index: number, message: Message, signal?: AbortSignal) => {
    if (!['summarize', 'version', 'planConversion', 'combine', 'summarizeSweep'].includes(message.kind)) await ensureLoaded(index, signal)
    return send(index, message, signal)
  }

  return {
    setStrategies(next) {
      if ((next?.sha256 ?? null) === (strategies?.sha256 ?? null)) return
      strategies = next ? { sha256: next.sha256, numbers: Array.from(next.bytes) } : null
      // Workers that hold other strategies (or any, when there are none now) stop; the next call starts fresh ones.
      if (running.length) stop(new Error('The strategies changed while the engine worked; run it again.'))
    },

    async backtest(request, candles, signal, conversion = noConversion) {
      return JSON.parse(await call(0, { kind: 'backtest', request: JSON.stringify(request), candles, conversion }, signal)) as EngineAnswer
    },

    async simulate(request, candles, count, { signal, onProgress, conversion = noConversion } = {}) {
      const size = Math.max(1, Math.min(workers, count))
      const text = JSON.stringify(request)
      const answers: DeviceScenarios[] = []
      let failure: SimulateAnswer | null = null
      let done = 0
      await shareOut(count, shareSize(count, size), size, async (index, first, share) => {
        const answer = JSON.parse(await call(index, { kind: 'simulate', request: text, candles, first, count: share, conversion }, signal)) as SimulateAnswer
        if (!answer.ok) {
          failure = answer
          return false
        }
        answers.push(answer)
        done += share
        onProgress?.(done, count)
        return true
      })
      if (failure) return failure
      const [head] = answers
      if (!head) throw new Error('The engine ran no scenario.')
      return {
        ...head,
        results: answers.flatMap((answer) => answer.results).sort((a, b) => a.scenario - b.scenario),
        prices: answers.flatMap((answer) => answer.prices).sort((a, b) => a.scenario - b.scenario),
        computedMs: Math.max(...answers.map((answer) => answer.computedMs)),
      }
    },

    async backtestAll(jobs, { signal, onProgress } = {}) {
      const answers: EngineAnswer[] = new Array(jobs.length)
      let done = 0
      await shareOut(jobs.length, 1, workers, async (index, first) => {
        const job = jobs[first]!
        answers[first] = JSON.parse(
          await call(index, { kind: 'backtest', request: JSON.stringify(job.request), candles: job.candles, conversion: job.conversion ?? noConversion }, signal),
        ) as EngineAnswer
        onProgress?.(++done, jobs.length)
        return true
      })
      return answers
    },

    async planSweep(request, signal) {
      return JSON.parse(await call(0, { kind: 'planSweep', request: JSON.stringify(request) }, signal)) as SweepPlanAnswer
    },

    async sweep(request, candles, count, { signal, onProgress, conversion = noConversion } = {}) {
      const text = JSON.stringify(request)
      const shares: DeviceSweepShare[] = []
      let failure: EngineFailure | null = null
      let done = 0
      await shareOut(count, sweepShareSize(count, workers), workers, async (index, first, share) => {
        const answer = JSON.parse(await call(index, { kind: 'sweep', request: text, candles, first, count: share, conversion }, signal)) as SweepAnswer
        if (!answer.ok) {
          failure = answer
          return false
        }
        shares.push(answer)
        done += share
        onProgress?.(done, count)
        return true
      })
      if (failure) return failure
      const head = shares.find((share) => share.days)
      if (!head?.days) throw new Error('The engine ran no share of the sweep.')
      return {
        ok: true,
        engine: head.engine,
        days: head.days,
        daysPerYear: head.daysPerYear,
        holdOutStart: head.holdOutStart,
        trials: shares.flatMap((share) => share.trials).sort((a, b) => a.index - b.index),
        problems: shares.flatMap((share) => share.problems).sort((a, b) => a.trial - b.trial),
        computedMs: shares.reduce((sum, share) => sum + share.computedMs, 0),
      }
    },

    async summarizeSweep(request, signal) {
      return JSON.parse(await call(0, { kind: 'summarizeSweep', request: JSON.stringify(request) }, signal)) as SweepSummaryAnswer
    },

    async combine(request, signal) {
      return JSON.parse(await call(0, { kind: 'combine', request: JSON.stringify(request) }, signal)) as CombineAnswer
    },

    async planConversion(request, signal) {
      return JSON.parse(await call(0, { kind: 'planConversion', request: JSON.stringify(request) }, signal)) as ConversionPlanAnswer
    },

    async summarize(request, signal) {
      return JSON.parse(await call(0, { kind: 'summarize', request: JSON.stringify(request) }, signal)) as SummaryAnswer
    },

    async levels(request, candles, count, signal) {
      return JSON.parse(await call(0, { kind: 'levels', request: JSON.stringify(request), candles, count }, signal)) as LevelsAnswer
    },
  }
}

/** The version and commit the engine was built from (`engine/version.json`), or null without one. */
export async function engineVersion(base = engineBase()): Promise<{ version: string; commit: string } | null> {
  try {
    const response = await fetch(new URL('version.json', base))
    return response.ok ? ((await response.json()) as { version: string; commit: string }) : null
  } catch {
    return null
  }
}
