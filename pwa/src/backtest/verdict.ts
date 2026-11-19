import type { AlphaEvidence, MarketBeta, ReturnStats, SharpeEvidence } from '../engine/types.ts'
import { fmtPercent, fmtSignedPercent } from '../format.ts'
import type { DeviceResult } from './runs.ts'

/**
 * Beta, alpha and the Sharpe ratio read together in one plain sentence (docs/backtest-engine-plan.md in the bot, §F). The
 * boundaries are the bot's (its ADR 0008): the engine says how strong each figure's evidence is, this says it in words.
 * Null for a run saved before engine 2.7.0, which has no Sharpe ratio.
 */
export function verdictOf(result: DeviceResult): string | null {
  const analysis = result.analysis
  if (!analysis) return null
  const market = result.market.symbol
  const parts: string[] = []
  const beta = result.marketBeta
  if (beta) parts.push(...betaAndAlpha(beta, market))
  else if (result.marketBetaMissing) parts.push(`No beta or alpha: ${result.marketBetaMissing}.`)
  parts.push(analysis.returns ? sharpeSentence(analysis.returns) : `No Sharpe ratio: ${analysis.returnsMissing ?? 'too few days'}.`)
  return parts.join(' ')
}

function betaAndAlpha(beta: MarketBeta, market: string): string[] {
  const luck = (beta.alphaEvidence ?? 'Luck') === 'Luck'
  const reading =
    Math.abs(beta.beta - 1) < 0.2 && beta.rSquared > 0.7 && luck
      ? 'Mostly holding the market: '
      : beta.beta < 0.5 && beta.inMarketPercent < 50 && luck
        ? 'Less exposure, not necessarily skill: '
        : ''
  const r2 = `R² ${beta.rSquared.toFixed(2)}`
  const linked = beta.betaLow != null && beta.betaHigh != null && beta.betaLow <= 0 && beta.betaHigh >= 0
  const moves = linked
    ? `no clear link to ${market} (beta ${beta.beta.toFixed(2)}, ${r2}).`
    : beta.beta < 0
      ? `moves against ${market}, ${Math.abs(beta.beta).toFixed(2)}× its daily move (${r2}).`
      : `moves ${beta.beta.toFixed(2)}× with ${market} (${r2}).`
  const first = reading ? `${reading}${moves}` : `${moves[0]!.toUpperCase()}${moves.slice(1)}`
  return [first, alphaSentence(beta)]
}

function alphaSentence(beta: MarketBeta): string {
  const alpha = `Alpha ${fmtSignedPercent(beta.annualAlpha * 100)} a year`
  if (beta.alphaT == null) return `${alpha}.`
  const t = `t ${beta.alphaT.toFixed(2)}`
  return {
    Luck: `${alpha} can't be told apart from luck (${t}).`,
    Suggestive: `${alpha} is suggestive (${t}): it has to hold out of sample.`,
    Strong: `${alpha} is strong (${t}): check it out of sample.`,
  }[beta.alphaEvidence ?? 'Luck']
}

function sharpeSentence(returns: ReturnStats): string {
  const sharpe = `Sharpe ${returns.sharpe.toFixed(2)} [${returns.sharpeLow.toFixed(2)}, ${returns.sharpeHigh.toFixed(2)}], ${fmtPercent(returns.psr * 100, 0)} likely above 0.`
  return returns.sharpeApproximate ? `${sharpe} Approximate: one day's return follows the day before's.` : sharpe
}

/** The tone of a Sharpe ratio's tile: convincing reads as a gain, promising as a warning, the rest muted. */
export const sharpeTone = (evidence: SharpeEvidence): 'gain' | 'warn' | 'mute' => (evidence === 'Convincing' ? 'gain' : evidence === 'Promising' ? 'warn' : 'mute')

/** The tone of alpha's tile: a gain or a loss only when its t says it is more than luck. */
export const alphaTone = (annualAlpha: number, evidence: AlphaEvidence | null | undefined): 'gain' | 'loss' | null =>
  evidence && evidence !== 'Luck' ? (annualAlpha >= 0 ? 'gain' : 'loss') : null

/** What alpha's evidence says, in a word or two. */
export const alphaWords = (evidence: AlphaEvidence | null | undefined) =>
  evidence === 'Strong' ? 'strong' : evidence === 'Suggestive' ? 'suggestive' : 'luck-level'
