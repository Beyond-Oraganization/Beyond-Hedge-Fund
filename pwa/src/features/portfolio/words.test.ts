import { describe, expect, it } from 'vitest'
import { marketName, menuSessionName, plainActivity, strategyName } from './words.ts'

describe('a client’s words for the bot’s', () => {
  it('names markets plainly, and keeps a symbol it does not know', () => {
    expect(marketName('XAUUSD')).toBe('Gold')
    expect(marketName('eurusd')).toBe('Euro / US dollar')
    expect(marketName('XYZ123')).toBe('XYZ123')
  })

  it.each([
    ['Closed XAUUSD buy 2 at a gain of 84.10', 'Closed a Gold trade'],
    ['Closed EURUSD sell 0.5 at a loss of 12.40', 'Closed a Euro / US dollar trade'],
    ['Closed XAUUSD buy 1', 'Closed a Gold trade'],
    ['Strategy started: sample, Gold', 'Strategy started: Gold'],
    ['Strategy started: Euro range, careful', 'Strategy started: Euro range, careful'],
    ['Strategy started: sample', 'Strategy started by the fund'],
    ['Strategy started: ', 'Strategy started by the fund'],
    ['Strategy stopped: Gold', 'Strategy stopped: Gold'],
    ['Deposit: Second transfer', 'Deposit: Second transfer'],
  ])('“%s” → “%s”', (bot, plain) => expect(plainActivity(bot)).toBe(plain))

  it('calls a session by the menu’s name, the name the fund gave it, or “a strategy run by the fund”', () => {
    const menu = [{ name: 'Gold trend, steady' }]
    expect(strategyName({ name: 'Gold trend steady', strategy: 'sample' }, menu)).toBe('Gold trend, steady')
    expect(strategyName({ name: 'Client A gold', strategy: 'sample' }, menu)).toBe('Client A gold')
    expect(strategyName({ strategy: 'sample' }, menu)).toBe('A strategy run by the fund')
  })

  it('names a menu session as the bot does', () => expect(menuSessionName('Gold trend, steady!')).toBe('Gold trend steady'))
})
