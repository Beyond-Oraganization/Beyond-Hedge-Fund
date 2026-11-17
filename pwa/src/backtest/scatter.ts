/** The geometry of the beta scatter: pure, so it is tested apart from drawing. */

/**
 * How far both axes reach either side of 0: the largest daily move of the market or the strategy, with a little room.
 * Both axes share it, so a line at 45° is a beta of 1 and the slope reads truly.
 */
export function scatterLimit(dots: [number, number][]): number {
  let largest = 0
  for (const [asset, strategy] of dots) largest = Math.max(largest, Math.abs(asset), Math.abs(strategy))
  return (largest || 0.01) * 1.05
}

/** Where the line y = alpha + beta·x enters and leaves the square from −limit to +limit, or null when it misses it. */
export function lineInSquare(alpha: number, beta: number, limit: number): [[number, number], [number, number]] | null {
  const at = (x: number) => alpha + beta * x
  if (beta === 0) return Math.abs(alpha) <= limit ? [[-limit, alpha], [limit, alpha]] : null
  const xFor = (y: number) => (y - alpha) / beta
  const ends: [number, number][] = []
  for (const x of [-limit, limit]) if (Math.abs(at(x)) <= limit) ends.push([x, at(x)])
  for (const y of [-limit, limit]) {
    const x = xFor(y)
    if (Math.abs(x) < limit) ends.push([x, y])
  }
  ends.sort((a, b) => a[0] - b[0])
  return ends.length >= 2 ? [ends[0]!, ends.at(-1)!] : null
}

/** The index of the dot nearest to the point (x, y), in the same units; −1 without dots. */
export function nearestDot(dots: [number, number][], x: number, y: number): number {
  let best = -1
  let distance = Infinity
  dots.forEach(([dx, dy], index) => {
    const d = (dx - x) ** 2 + (dy - y) ** 2
    if (d < distance) [best, distance] = [index, d]
  })
  return best
}
