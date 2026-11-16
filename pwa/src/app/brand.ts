import { useConnections } from '../state/connections.ts'

/**
 * The app's name as each user knows it (docs/fund-app-redesign-plan.md, section 1): Beyond Hedge Fund for the fund's people,
 * who sign in with their own login; Beyond Bot for the owner's API key, the bot's remote control. The installed app's name
 * (its manifest) stays Beyond Bot until the plan's rename of the published app.
 */
export const FUND = 'Beyond Hedge Fund'
export const BOT = 'Beyond Bot'

export const brandOf = (connection: { person?: unknown } | null | undefined) => (connection?.person ? FUND : BOT)

/** The name for the connection in use. */
export function useBrand(): string {
  return useConnections((state) => brandOf(state.connections.find((c) => c.id === state.activeId)))
}
