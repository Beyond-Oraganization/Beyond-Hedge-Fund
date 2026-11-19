import { useCallback, useEffect } from 'react'
import { db } from '../state/db.ts'
import { costsKey, costsPart, NO_COSTS, type MarketCosts } from './conditions.ts'

/**
 * The costs this device remembers for a market (`costs:<connection>:<symbol>`): handed to `apply` whenever the symbol
 * changes (none remembered gives empty fields), and remembered again with {@link remember} when a run uses them.
 */
export function useMarketCosts(connectionId: string | undefined, symbol: string | undefined, apply: (costs: MarketCosts) => void) {
  useEffect(() => {
    if (!connectionId || !symbol) return
    let current = true
    void db.get<MarketCosts>(costsKey(connectionId, symbol)).then((stored) => {
      if (current) apply(stored ? { ...NO_COSTS, ...costsPart(stored) } : NO_COSTS)
    })
    return () => {
      current = false
    }
    // `apply` is the screen's setter; only another market brings other costs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, symbol])

  return useCallback(
    (costs: MarketCosts) => (connectionId && symbol ? db.set(costsKey(connectionId, symbol), costsPart(costs)) : Promise.resolve()),
    [connectionId, symbol],
  )
}
