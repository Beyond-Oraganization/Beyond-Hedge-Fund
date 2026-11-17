import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useBot } from '../api/bot.ts'
import { useEngine } from './context.ts'
import { fetchPack, forgetPack, mayHaveStrategies } from './pack.ts'

/**
 * The strategy pack of the open connection, fetched once per sign-in opened (and kept on the device for offline
 * backtests); never asked for when its person may not have it.
 */
export function useStrategyPack() {
  const { connection, queue, ready } = useBot()
  const may = mayHaveStrategies(connection)
  return useQuery({
    queryKey: ['strategy-pack', connection?.id ?? null],
    enabled: ready && may,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    queryFn: ({ signal }) => fetchPack(connection!.id, (args) => queue!.run(args, { priority: 'view', signal })),
  })
}

/**
 * Gives the engine the strategies the open connection may run, whenever that changes: the pack at sign-in, none after
 * signing out, switching to a connection without one, or the fund no longer trusting the person (then the kept copy
 * is forgotten too).
 */
export function StrategyPackLoader() {
  const { connection } = useBot()
  const engine = useEngine()
  const may = mayHaveStrategies(connection)
  const pack = useStrategyPack()
  const current = may ? (pack.data ?? null) : null
  const id = connection?.id ?? null

  useEffect(() => {
    engine().setStrategies(current)
  }, [engine, current])

  useEffect(() => {
    if (id && !may) void forgetPack(id)
  }, [id, may])

  return null
}
