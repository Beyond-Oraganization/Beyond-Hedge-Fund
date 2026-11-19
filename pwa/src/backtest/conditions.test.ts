import { describe, expect, it } from 'vitest'
import {
  conditionErrors,
  conditionsRequest,
  costsOf,
  hopsFor,
  intervalMinutes,
  isPlain,
  NO_CONDITIONS,
  NO_COSTS,
  quoteOf,
  readNumber,
  requestHops,
  routeWords,
  storedMarkets,
} from './conditions.ts'

describe('reading what people type', () => {
  it.each([
    ['0.30', 0.3],
    ['0,30', 0.3],
    [' 1 000,5 ', 1000.5],
    ['−4', -4],
    ['-2.5', -2.5],
    ['.5', 0.5],
    ['', 0],
  ])('reads %j as %d', (text, value) => expect(readNumber(text)).toBe(value))

  it.each(['abc', '1.2.3', '1e3', '--1'])('refuses %j', (text) => expect(readNumber(text)).toBeNull())
})

describe('the costs', () => {
  it('are none when every field is empty or 0, so the request stays as before 2.8.0', () => {
    expect(costsOf(NO_COSTS)).toBeNull()
    expect(costsOf({ ...NO_COSTS, spread: '0', commission: '0,0' })).toBeNull()
  })

  it('go to the engine as numbers, decimal commas read', () => {
    expect(costsOf({ spread: '0,30', slippage: '', commission: '0.0035', swapLong: '−4', swapShort: '' })).toEqual({ spread: 0.3, slippage: 0, commission: 0.0035, swapLong: -4, swapShort: 0 })
  })

  it('are checked against the ranges the bot accepts', () => {
    expect(conditionErrors({ spread: '-1', slippage: 'x', commission: '11', swapLong: '-101', swapShort: '5' })).toEqual({
      spread: 'The spread is a price distance, 0 or more.',
      slippage: 'Type a number, e.g. 0.3.',
      commission: 'The commission is a percent of the notional on each side, from 0 to 10.',
      swapLong: 'A swap is a percent a year, from −100 to 100.',
    })
    expect(conditionErrors(NO_COSTS)).toEqual({})
  })
})

describe('the request', () => {
  it('has no new field without conditions', () => {
    expect(conditionsRequest(NO_CONDITIONS, 1000)).toEqual({})
    expect(isPlain(NO_CONDITIONS)).toBe(true)
  })

  it('names the fill, and the balance as the budget when the run trades like one', () => {
    expect(conditionsRequest({ ...NO_CONDITIONS, spread: '0.3', fill: 'NextOpen', budgeted: true }, 1500)).toEqual({
      costs: { spread: 0.3, slippage: 0, commission: 0, swapLong: 0, swapShort: 0 },
      fill: 'NextOpen',
      budget: 1500,
    })
    expect(isPlain({ ...NO_CONDITIONS, currency: 'EUR' })).toBe(false)
  })
})

describe('currencies', () => {
  it.each([
    ['XAUUSD', 'USD'],
    ['EURPLN', 'PLN'],
    ['BTCUSDT', 'USDT'],
    ['XAUTUSDT', 'USDT'],
    ['US500', null],
  ])('%s is priced in %s', (symbol, quote) => expect(quoteOf(symbol)).toBe(quote))

  it('reads each stored market at its shortest interval, and the backtested one from its own closes', () => {
    const stored = storedMarkets([
      { symbol: 'EURUSD', interval: '1d', candles: 10, first: null, newest: null, age: null, trading: false },
      { symbol: 'EURUSD', interval: '4h', candles: 900, first: null, newest: null, age: null, trading: false },
      { symbol: 'EURUSD', interval: '1h', candles: 0, first: null, newest: null, age: null, trading: false },
    ])

    const hops = hopsFor([{ symbol: 'EURUSD', divide: true, ownMarket: false }], stored)!

    expect(hops[0]!.market).toEqual({ symbol: 'EURUSD', interval: '4h', minutes: 240 })
    expect(requestHops(hops, [900])).toEqual([{ symbol: 'EURUSD', interval: '4h', count: 900 }])
    expect(routeWords(hops)).toBe('÷ EURUSD 4h')
    const own = hopsFor([{ symbol: 'EURPLN', divide: true, ownMarket: true }], [])!
    expect(requestHops(own, [0])).toEqual([{ symbol: 'EURPLN' }])
    expect(routeWords(own)).toBe('÷ EURPLN (its own close)')
    expect(hopsFor([{ symbol: 'GBPUSD', divide: true, ownMarket: false }], stored)).toBeNull()
  })

  it.each([
    ['15m', 15],
    ['4h', 240],
    ['1d', 1440],
    ['1w', 10080],
  ])('a %s candle is %d minutes', (code, minutes) => expect(intervalMinutes(code)).toBe(minutes))
})
