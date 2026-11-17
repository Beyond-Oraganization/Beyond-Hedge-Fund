import type { Outcome } from '../api/client.ts'
import type { Connection } from '../state/connections.ts'
import { db } from '../state/db.ts'

/**
 * The strategy pack: the bot's strategies as one .NET assembly. The app is public, so its engine ships without
 * strategies; after sign-in the bot hands the pack (`strategies bundle --json`, bot 2.4.0) to the fund's staff, its
 * owner and the clients it trusts, and the engine loads it. A client the fund does not trust gets none: the bot
 * refuses, and the app does not ask.
 */
export type StrategyPack = { version: string; sha256: string; strategies: string[]; bytes: Uint8Array }

/** Who may have the pack: whoever connects with the API key (the owner), staff, the owner, and a client the fund trusts. */
export const mayHaveStrategies = (connection: Pick<Connection, 'person'> | null | undefined) =>
  Boolean(connection) && (!connection!.person || connection!.person.role !== 'client' || connection!.person.trusted === true)

type Bundle = { version: string; sha256: string; strategies: string[]; bytes: number; pack: string[] }

// The bot prints the pack's base64 in pieces (Fund/StrategyBundle.cs), so no line of its answer is wrapped. Checked by
// hand, not with zod: this module loads before zod is told not to probe for eval (api/session.ts), which the CSP forbids.
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')
function isBundle(json: unknown): json is Bundle {
  if (typeof json !== 'object' || json === null) return false
  const b = json as Record<string, unknown>
  return typeof b.version === 'string' && typeof b.sha256 === 'string' && /^[0-9a-f]{64}$/.test(b.sha256) && strings(b.strategies)
    && typeof b.bytes === 'number' && Number.isInteger(b.bytes) && b.bytes > 0 && strings(b.pack) && b.pack.length > 0
}

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('')

/** The pack from a `strategies bundle --json` answer: its pieces joined, its size and SHA-256 checked. */
export async function readBundle(json: unknown): Promise<StrategyPack> {
  if (!isBundle(json)) throw new Error('The bot’s strategy pack has an unexpected shape.')
  const { version, sha256, strategies, bytes, pack } = json
  const binary = atob(pack.join(''))
  const data = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  if (data.length !== bytes) throw new Error(`The strategy pack arrived with ${data.length} of its ${bytes} bytes.`)
  if (hex(await crypto.subtle.digest('SHA-256', data)) !== sha256) throw new Error('The strategy pack arrived damaged: its SHA-256 does not match.')
  return { version, sha256, strategies, bytes: data }
}

const KEY = (connectionId: string) => `pack:${connectionId}`

/** The pack this device kept for the connection, so a backtest runs offline too. */
export const cachedPack = (connectionId: string) => db.get<StrategyPack>(KEY(connectionId))

/** Forgets the connection's pack: at sign-out, and when its person may no longer have it. */
export const forgetPack = (connectionId: string) => db.del(KEY(connectionId))

/**
 * The connection's pack: fetched from the bot and kept, or the kept one when the bot cannot be reached. A refusal (the
 * person is no longer trusted, or a bot from before packs) forgets the kept one and answers null.
 */
export async function fetchPack(connectionId: string, run: (args: string[]) => Promise<Outcome>): Promise<StrategyPack | null> {
  const outcome = await run(['strategies', 'bundle', '--json'])
  if (outcome.kind === 'ok') {
    const pack = await readBundle(outcome.result.json)
    await db.set(KEY(connectionId), pack)
    return pack
  }
  if (outcome.kind === 'forbidden' || outcome.kind === 'failed' || outcome.kind === 'usage' || outcome.kind === 'signedOut' || outcome.kind === 'unauthorized') {
    await forgetPack(connectionId)
    return null
  }
  // Offline, or the bot is busy restarting: the kept pack still backtests.
  return (await cachedPack(connectionId)) ?? null
}
