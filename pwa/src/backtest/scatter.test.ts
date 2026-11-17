import { describe, expect, it } from 'vitest'
import { lineInSquare, nearestDot, scatterLimit } from './scatter.ts'

describe('scatterLimit', () => {
  it('reaches past the largest move of either series, so no dot sits on the edge', () => {
    expect(scatterLimit([[0.01, -0.03], [-0.02, 0.005]])).toBeCloseTo(0.0315, 10)
  })

  it('still draws a square without dots or moves', () => {
    expect(scatterLimit([])).toBeCloseTo(0.0105, 10)
    expect(scatterLimit([[0, 0]])).toBeCloseTo(0.0105, 10)
  })
})

describe('lineInSquare', () => {
  it('runs a beta below 1 from the left edge to the right one', () => {
    expect(lineInSquare(0, 0.5, 0.02)).toEqual([[-0.02, -0.01], [0.02, 0.01]])
  })

  it('cuts a steep line at the top and the bottom', () => {
    const [from, to] = lineInSquare(0, 2, 0.02)!
    expect(from[0]).toBeCloseTo(-0.01, 12)
    expect(from[1]).toBeCloseTo(-0.02, 12)
    expect(to[0]).toBeCloseTo(0.01, 12)
    expect(to[1]).toBeCloseTo(0.02, 12)
  })

  it('draws a beta of 0 flat at alpha, and a negative beta falling', () => {
    expect(lineInSquare(0.001, 0, 0.02)).toEqual([[-0.02, 0.001], [0.02, 0.001]])
    expect(lineInSquare(0, -1, 0.02)).toEqual([[-0.02, 0.02], [0.02, -0.02]])
  })

  it('draws nothing for a line that misses the square', () => {
    expect(lineInSquare(0.05, 0, 0.02)).toBeNull()
    expect(lineInSquare(0.05, 0.1, 0.02)).toBeNull()
  })
})

describe('nearestDot', () => {
  it('finds the dot closest to the pointer', () => {
    expect(nearestDot([[0, 0], [0.01, 0.01], [-0.01, 0.02]], 0.009, 0.012)).toBe(1)
    expect(nearestDot([], 0, 0)).toBe(-1)
  })
})
