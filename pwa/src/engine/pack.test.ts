import { beforeEach, describe, expect, it } from 'vitest'
import type { CommandResult } from '../api/types.ts'
import type { Outcome } from '../api/client.ts'
import { db } from '../state/db.ts'
import { cachedPack, fetchPack, mayHaveStrategies, readBundle } from './pack.ts'

/** The strategy pack as the bot hands it out (`strategies bundle --json`): base64 in pieces, with its size and SHA-256. */

const bytes = new Uint8Array(Array.from({ length: 5000 }, (_, i) => (i * 7) % 256))

async function bundle(data = bytes, pieceLength = 4000) {
  const base64 = btoa(String.fromCharCode(...data))
  const pieces: string[] = [...base64.match(new RegExp(`.{1,${pieceLength}}`, 'g'))!]
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return { version: '2.4.0', sha256, strategies: ['sample'], bytes: data.length, pack: pieces }
}

const result = (json: unknown): CommandResult => ({ command: 'strategies bundle --json', exitCode: 0, ok: true, elapsedMs: 4, output: '', blocks: [], error: null, json }) as CommandResult

describe('reading the pack', () => {
  it('joins its pieces and checks its size and SHA-256', async () => {
    const pack = await readBundle(await bundle())

    expect(pack.bytes).toEqual(bytes)
    expect([pack.version, pack.strategies]).toEqual(['2.4.0', ['sample']])
  })

  it('refuses one that arrived damaged', async () => {
    const damaged = await bundle()
    damaged.pack[0] = damaged.pack[0]!.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'))

    await expect(readBundle(damaged)).rejects.toThrow('The strategy pack arrived damaged: its SHA-256 does not match.')
  })

  it('refuses one with pieces missing', async () => {
    const short = await bundle()
    short.pack = short.pack.slice(0, 1)

    await expect(readBundle(short)).rejects.toThrow('The strategy pack arrived with 3000 of its 5000 bytes.')
  })
})

describe('who may have it', () => {
  it('is whoever connects with the key, staff, the owner and a trusted client', () => {
    expect(mayHaveStrategies({})).toBe(true)
    expect(mayHaveStrategies({ person: { login: 'a', name: 'A', role: 'staff' } })).toBe(true)
    expect(mayHaveStrategies({ person: { login: 'o', name: 'O', role: 'owner' } })).toBe(true)
    expect(mayHaveStrategies({ person: { login: 'c', name: 'C', role: 'client', trusted: true } })).toBe(true)
    expect(mayHaveStrategies({ person: { login: 'c', name: 'C', role: 'client' } })).toBe(false)
    expect(mayHaveStrategies(null)).toBe(false)
  })
})

describe('fetching it', () => {
  beforeEach(() => db.del('pack:bot-1'))

  it('keeps what the bot handed out', async () => {
    const answer = await bundle()

    const pack = await fetchPack('bot-1', async () => ({ kind: 'ok', result: result(answer), roundTripMs: 9 }))

    expect(pack?.sha256).toBe(answer.sha256)
    expect((await cachedPack('bot-1'))?.bytes).toEqual(bytes)
  })

  it('backtests with the kept one when the bot cannot be reached', async () => {
    const answer = await bundle()
    await fetchPack('bot-1', async () => ({ kind: 'ok', result: result(answer), roundTripMs: 9 }))

    const offline = await fetchPack('bot-1', async (): Promise<Outcome> => ({ kind: 'unreachable', reason: 'offline' }))

    expect(offline?.sha256).toBe(answer.sha256)
  })

  it('forgets the kept one when the bot refuses it (trust withdrawn)', async () => {
    await fetchPack('bot-1', async () => ({ kind: 'ok', result: result(await bundle()), roundTripMs: 9 }))

    const refused = await fetchPack('bot-1', async () => ({ kind: 'forbidden', result: result(null), roundTripMs: 9 }))

    expect(refused).toBeNull()
    expect(await cachedPack('bot-1')).toBeUndefined()
  })
})
