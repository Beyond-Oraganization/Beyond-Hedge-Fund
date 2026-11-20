import { describe, expect, it } from 'vitest'
import { NO_CONDITIONS } from './conditions.ts'
import { SWEEP_AXES, sweepTrials } from './fixtures.ts'
import { axesOf, DEFAULT_SWEEP, estimateSeconds, estimateWords, keepTrial, NO_VARY, sortTrials, sweepErrors, sweepRequest, trialCount, trialsCsv, valuesOf } from './sweep.ts'

const length = { name: 'length', default: 20, min: 2, max: 500, meaning: '', whole: true }
const spread = { name: 'spread', default: 3, min: 0.5, max: 50, meaning: '', whole: false }
const input = { strategy: 'sample', symbol: 'XAUUSD', interval: '1h', params: { length: 20, spread: 3, lines: 2 }, rules: ['open long on cross up below 1'], sizing: 'percent:50' }

describe('the values a parameter takes', () => {
  it('reads a list, commas or spaces between', () => {
    expect(valuesOf({ ...NO_VARY, on: true, mode: 'list', list: '10, 20 30;40' }, length)).toEqual({ values: [10, 20, 30, 40] })
  })

  it('steps from one value to another, without the drift of decimals', () => {
    expect(valuesOf({ ...NO_VARY, on: true, from: '1', to: '1.4', step: '0.1' }, spread)).toEqual({ values: [1, 1.1, 1.2, 1.3, 1.4] })
    expect(valuesOf({ ...NO_VARY, on: true, from: '10', to: '35', step: '10' }, length)).toEqual({ values: [10, 20, 30] })
  })

  it('refuses values the parameter does not take', () => {
    expect(valuesOf({ ...NO_VARY, on: true, mode: 'list', list: '1, 10' }, length)).toEqual({ error: 'length takes 2 to 500; 1 is outside.' })
    expect(valuesOf({ ...NO_VARY, on: true, mode: 'list', list: '10, 10.5' }, length)).toEqual({ error: 'length takes whole numbers.' })
    expect(valuesOf({ ...NO_VARY, on: true, mode: 'list', list: '10, 10' }, length)).toEqual({ error: 'A value is there twice.' })
    expect(valuesOf({ ...NO_VARY, on: true, from: '30', to: '10', step: '5' }, length)).toEqual({ error: '“To” must be at least “from”.' })
    expect(valuesOf({ ...NO_VARY, on: true, from: '2', to: '500', step: '0.1' }, spread)).toMatchObject({ error: expect.stringMatching(/^That is 4981 values/) })
  })

  it('keeps the strategy’s order, and only the parameters switched on', () => {
    const vary = { spread: { ...NO_VARY, on: true, mode: 'list' as const, list: '2, 3' }, length: { ...NO_VARY, on: true, mode: 'list' as const, list: '10, 20' }, lines: NO_VARY }
    expect(axesOf(vary, [length, spread, { ...length, name: 'lines' }])).toEqual({ axes: [{ name: 'length', values: [10, 20] }, { name: 'spread', values: [2, 3] }], errors: {} })
  })
})

describe('the sweep', () => {
  it('counts its trials, at most 1,000', () => {
    expect(trialCount(SWEEP_AXES, 1)).toBe(12)
    expect(trialCount(SWEEP_AXES, 2)).toBe(24)
    expect(sweepErrors(DEFAULT_SWEEP, [{ name: 'length', values: Array.from({ length: 501 }, (_, i) => i) }], 2).vary).toBe('That is 1,002 trials; a sweep runs at most 1,000.')
    expect(sweepErrors(DEFAULT_SWEEP, [], 1).vary).toBe('Vary a parameter, or try another rule set.')
  })

  it('asks the engine for the setup, the hold-out, the objective and the constraints', () => {
    const request = sweepRequest({ ...DEFAULT_SWEEP, holdOutPercent: 25, maxDrawdown: '20', objective: 'Sortino' }, input, { ...NO_CONDITIONS, spread: '0.3' }, SWEEP_AXES,
      [input.rules], null, 36, { x: 'length', y: 'lines' })

    expect(request).toMatchObject({
      base: { strategy: 'sample', symbol: 'XAUUSD', balance: 1000, costs: { spread: 0.3 } }, vary: SWEEP_AXES, holdOut: { sharePercent: 25 }, objective: 'Sortino',
      constraints: { minimumTrades: 30, maxDrawdownPercent: 20, profitFactorAboveOne: true }, earlierTrials: 36, heatMap: { x: 'length', y: 'lines' },
    })
    expect(request).not.toHaveProperty('ruleSets')
    expect(sweepRequest({ ...DEFAULT_SWEEP, holdOutFrom: '2025-06-01' }, input, NO_CONDITIONS, SWEEP_AXES, [['a'], ['b']], null, 0, null)).toMatchObject({ holdOut: { from: '2025-06-01' }, ruleSets: [['a'], ['b']] })
  })

  it('estimates how long it takes on this device', () => {
    expect(estimateSeconds(1000, 45_000, 6)).toBe(57)
    expect(estimateWords(30, estimateSeconds(30, 45_000, 1))).toBe('30 trials · about 10 s')
    expect(estimateWords(1000, 600)).toBe('1,000 trials · about 10 min')
  })

  it('exports every trial as CSV', () => {
    const csv = trialsCsv(sweepTrials().map(keepTrial), SWEEP_AXES).split('\n')

    expect(csv[0]).toMatch(/^trial,length,spread,lines,ruleSet,inSample\.returnPercent,inSample\.sharpe,/)
    // The reason has a comma in it, so it is quoted.
    expect(csv[12]).toMatch(/^11,30,3,2,1,.*,false,"only 12 trades in sample, and it needs 30"$/)
    expect(csv).toHaveLength(14)
  })

  it('sorts the trials best first, in sample or in the hold-out', () => {
    expect(sortTrials(sweepTrials().map(keepTrial), 'inSample', 'Sharpe')[0]!.index).toBe(7)
    expect(sortTrials(sweepTrials().map(keepTrial), 'index', 'Sharpe')[0]!.index).toBe(0)
  })
})
