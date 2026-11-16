import { sessionName } from '../../api/session.ts'
import type { TradingSessionState } from '../../api/types.ts'

/**
 * A client's words for what the bot names by its own (docs/fund-app-redesign-plan.md, section 5: clients never meet "drcs"
 * or "XAUUSD"). Staff's screens keep the bot's names.
 */
const MARKETS: Record<string, string> = {
  XAUUSD: 'Gold',
  XAGUSD: 'Silver',
  EURUSD: 'Euro / US dollar',
  GBPUSD: 'Pound / US dollar',
  USDJPY: 'US dollar / yen',
  USDCHF: 'US dollar / Swiss franc',
  AUDUSD: 'Australian dollar / US dollar',
  USDCAD: 'US dollar / Canadian dollar',
  EURGBP: 'Euro / pound',
  EURPLN: 'Euro / zloty',
  USDPLN: 'US dollar / zloty',
  BTCUSD: 'Bitcoin',
  BTCUSDT: 'Bitcoin',
  ETHUSD: 'Ether',
  ETHUSDT: 'Ether',
  SOLUSDT: 'Solana',
  US500: 'US 500 index',
  US30: 'Dow Jones index',
  USTEC: 'US tech index',
  DE40: 'German 40 index',
}

/** "Gold" for XAUUSD; a market without a plain name keeps its symbol. */
export const marketName = (symbol: string) => MARKETS[symbol.toUpperCase()] ?? symbol

/** The session name a menu setup starts under (Cli/Commands/StrategyCommands.cs, MenuInput.SessionName in the bot). */
export function menuSessionName(setupName: string): string {
  const kept = [...setupName].filter((c) => /[\p{L}\p{N} ._-]/u.test(c)).join('').split(' ').filter(Boolean).join(' ')
  return kept.length > 40 ? kept.slice(0, 40).trimEnd() : kept || 'menu setup'
}

/** A bot strategy's id ("drcs"), as opposed to a name a person gave a session ("Gold"). */
const looksLikeId = (name: string) => /^[a-z0-9-]+$/.test(name)

/** A strategy the fund started for the client, outside the menu, with only the bot's name. */
export const RUN_BY_FUND = 'A strategy run by the fund'

/** The name inside a sentence: "Stop the strategy run by the fund?", "Stop Gold trend, steady?". */
export const inSentence = (name: string) => (name === RUN_BY_FUND ? 'the strategy run by the fund' : name)

/**
 * What a client calls a strategy trading for them: the menu's name when it was started from the menu, the name the fund gave
 * it, or "A strategy run by the fund" for one named only by the bot's strategy.
 */
export function strategyName(session: Pick<TradingSessionState, 'name' | 'strategy'>, menu: { name: string }[] = []): string {
  const name = sessionName(session)
  const setup = menu.find((s) => menuSessionName(s.name).toLowerCase() === name.toLowerCase())
  if (setup) return setup.name
  return name === session.strategy || looksLikeId(name) ? RUN_BY_FUND : name
}

/**
 * The bot's activity line in a client's words: "Closed XAUUSD buy 2 at a gain of 84.10" → "Closed a Gold trade" (the list
 * shows the gain beside it, with its arrow); "Strategy started: drcs, Gold" → "Strategy started: Gold". Anything else stays
 * as the bot wrote it.
 */
export function plainActivity(text: string): string {
  const close = /^Closed (\S+) (?:buy|sell) [\d.]+/.exec(text)
  if (close) return `Closed a ${marketName(close[1]!)} trade`
  const strategy = /^(Strategy (?:started|stopped)): ?(.*)$/.exec(text)
  if (strategy) {
    // The bot writes "strategy, name" for a start; only that first part can be a strategy's id.
    const rest = strategy[2]!.trim()
    const [first, ...others] = rest.split(', ')
    const named = first && looksLikeId(first) ? others.join(', ') : rest
    return named ? `${strategy[1]}: ${named}` : `${strategy[1]} by the fund`
  }
  return text
}
