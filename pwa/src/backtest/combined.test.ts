import { describe, expect, it } from 'vitest'
import { combinedErrors, combinedVerdict, combineRequest, DEFAULT_COMBINED, legErrors, legName, legRequest, legSummary, type LegForm } from './combined.ts'
import { NO_CONDITIONS } from './conditions.ts'
import { analysis, combinedResult, deviceAnswer } from './fixtures.ts'

const leg = (patch: Partial<LegForm> = {}): LegForm => ({
  id: '1', label: '', budget: '1000', conditions: NO_CONDITIONS,
  config: { strategy: 'sample', market: 'XAUUSD 1h', params: { length: '20' }, rules: ['open long on cross up below 1'], sizing: { method: 'percent', value: '50' } },
  ...patch,
})

const input = { strategy: 'sample', symbol: 'XAUUSD', interval: '1h', params: { length: 20 }, rules: ['open long on cross up below 1'], sizing: 'percent:50' }

describe('a leg', () => {
  it('is called by its strategy and market, unless it was given a name', () => {
    expect(legName(leg())).toBe('sample on XAUUSD 1h')
    expect(legName(leg({ label: ' Gold trend ' }))).toBe('Gold trend')
  })

  it('needs a budget, costs the bot accepts, and a name no other leg has', () => {
    expect(legErrors(leg({ budget: '0', conditions: { ...NO_CONDITIONS, spread: '-1' } }), [])).toEqual({ budget: 'The budget must be above 0.', spread: 'The spread is a price distance, 0 or more.' })
    expect(legErrors(leg({ id: '2' }), [leg()])).toEqual({ label: 'Another leg has this name; give this one its own.' })
  })

  it('asks the engine for its setup, with its budget as its money and its costs, in the combined currency', () => {
    const conversion = { currency: 'EUR', hops: [{ symbol: 'EURUSD', interval: '4h', count: 900 }] }
    const request = legRequest(leg({ budget: '1 500', conditions: { ...NO_CONDITIONS, spread: '0,3', budgeted: true, currency: 'PLN' } }), input, null,
      { currency: 'EUR', riskFree: '4,5', from: '2025-01-01', to: '' }, conversion)

    expect(request).toMatchObject({ strategy: 'sample', symbol: 'XAUUSD', balance: 1500, budget: 1500, riskFree: 4.5, costs: { spread: 0.3 }, from: '2025-01-01T00:00:00', to: null, conversion })
  })
})

describe('the combined settings', () => {
  it('need two legs and a risk-free rate of a sane size', () => {
    expect(combinedErrors({ ...DEFAULT_COMBINED, riskFree: '120' }, [leg()])).toEqual({ legs: 'Add at least 2 legs to combine.', riskFree: 'A yearly percent from 0 to under 100.' })
    expect(combinedErrors(DEFAULT_COMBINED, [leg(), leg({ id: '2', label: 'Other' })])).toEqual({})
  })
})

describe('adding the legs up', () => {
  it('hands the engine each leg’s daily equity, budget, sizing and currency', () => {
    const answer = deviceAnswer({ analysis: analysis({ currency: 'EUR' }) })

    const request = combineRequest({ ...DEFAULT_COMBINED, riskFree: '1' }, [leg(), leg({ id: '2', label: 'Zloty' })], [answer, answer])

    expect(request).toMatchObject({ currency: 'EUR', riskFree: 1, legs: [{ label: 'sample on XAUUSD 1h', symbol: 'XAUUSD', currency: 'EUR', budget: 1000, sizing: 'Percent' }, { label: 'Zloty' }] })
    expect(request.legs[0]!.dailyEquity).toBe(answer.dailyEquity)
  })

  it('keeps each leg’s own figures for the report', () => {
    const summary = legSummary('Gold', deviceAnswer())

    expect(summary).toMatchObject({ name: 'Gold', market: 'XAUUSD 1h', sharpe: 5.78, beta: expect.closeTo(0.6456, 3), costsPaid: null })
    expect(summary.equityDays.length).toBe(deviceAnswer().dailyEquity.length)
  })
})

describe('the combined verdict', () => {
  it('reads the Sharpe ratio, the diversification, and a leg carrying more of the risk than of the money', () => {
    expect(combinedVerdict(combinedResult())).toBe(
      'Sharpe 5.78 [-5.06, 16.62], 84% likely above 0. The legs offset each other’s swings: diversification 1.29. Gold carries 78% of the risk with 50% of the money.',
    )
  })

  it('says when the legs move together', () => {
    expect(combinedVerdict(combinedResult({ diversificationRatio: 1.01, legs: combinedResult().legs.map((l) => ({ ...l, riskShare: 0.5 })) }))).toMatch(/Little diversification \(1\.01\): the legs move together\.$/)
  })
})
