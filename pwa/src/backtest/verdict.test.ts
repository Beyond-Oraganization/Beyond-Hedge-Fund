import { describe, expect, it } from 'vitest'
import type { MarketBeta } from '../engine/types.ts'
import { analysis, deviceAnswer, returnStats } from './fixtures.ts'
import { keep } from './runs.ts'
import { alphaTone, sharpeTone, verdictOf } from './verdict.ts'

const beta = (overrides: Partial<MarketBeta>): MarketBeta => ({ ...deviceAnswer().marketBeta!, ...overrides })
const verdict = (overrides: Parameters<typeof deviceAnswer>[0]) => verdictOf(keep(deviceAnswer(overrides)))

describe('the verdict: beta, alpha and Sharpe in one sentence', () => {
  it('reads the worked example: a strong alpha, and the Sharpe ratio with its interval', () => {
    expect(verdict({})).toBe(
      'Moves 0.65× with XAUUSD (R² 0.99). Alpha +73.64% a year is strong (t 5.76): check it out of sample. ' +
        "Sharpe 5.78 [-5.06, 16.62], 84% likely above 0. Approximate: one day's return follows the day before's.",
    )
  })

  it('calls a beta near 1 with a high R² and a luck-level alpha mostly holding the market', () => {
    expect(verdict({ marketBeta: beta({ beta: 0.95, betaLow: 0.9, betaHigh: 1.0, rSquared: 0.9, alphaT: 0.5, alphaEvidence: 'Luck' }) })).toMatch(
      /^Mostly holding the market: moves 0\.95× with XAUUSD \(R² 0\.90\)\. Alpha \+73\.64% a year can't be told apart from luck \(t 0\.50\)\./,
    )
  })

  it('calls a small beta with little time in the market less exposure, not skill', () => {
    expect(verdict({ marketBeta: beta({ beta: 0.3, betaLow: 0.2, betaHigh: 0.4, inMarketPercent: 30, alphaT: 1.1, alphaEvidence: 'Luck' }) })).toMatch(
      /^Less exposure, not necessarily skill: moves 0\.30× with XAUUSD/,
    )
  })

  it('says a suggestive alpha has to hold out of sample', () => {
    expect(verdict({ marketBeta: beta({ alphaT: 2.4, alphaEvidence: 'Suggestive' }) })).toContain('is suggestive (t 2.40): it has to hold out of sample.')
  })

  it('says there is no clear link when beta’s interval spans 0, and words a negative beta against the market', () => {
    expect(verdict({ marketBeta: beta({ beta: 0.1, betaLow: -0.2, betaHigh: 0.4 }) })).toMatch(/^No clear link to XAUUSD \(beta 0\.10, R² 0\.99\)\./)
    expect(verdict({ marketBeta: beta({ beta: -0.4, betaLow: -0.5, betaHigh: -0.3 }) })).toMatch(/^Moves against XAUUSD, 0\.40× its daily move/)
  })

  it('says why there is no beta or Sharpe ratio', () => {
    expect(
      verdict({ marketBeta: null, marketBetaMissing: 'only 2 days to compare, and it needs at least 3', analysis: analysis({ returns: null, returnsMissing: 'only 2 days to measure, and it needs at least 3' }) }),
    ).toBe('No beta or alpha: only 2 days to compare, and it needs at least 3. No Sharpe ratio: only 2 days to measure, and it needs at least 3.')
  })

  it('has nothing to say for a run saved before the engine measured Sharpe', () => {
    const { analysis: _analysis, ...before } = keep(deviceAnswer())
    expect(verdictOf(before)).toBeNull()
  })

  it('tones the Sharpe ratio by how convincing it is, and alpha only when it is more than luck', () => {
    expect([sharpeTone('Convincing'), sharpeTone('Promising'), sharpeTone('NotEvidence')]).toEqual(['gain', 'warn', 'mute'])
    expect([alphaTone(0.07, 'Strong'), alphaTone(-0.07, 'Suggestive'), alphaTone(0.07, 'Luck'), alphaTone(0.07, null)]).toEqual(['gain', 'loss', null, null])
    expect(returnStats().psrEvidence).toBe('Promising')
  })
})
