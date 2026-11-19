import { useMemo } from 'react'
import { dayTime } from '../../backtest/runs.ts'
import type { RollingPoint } from '../../engine/types.ts'
import { fmtPercent } from '../../format.ts'
import { Chart, type ChartLine } from '../Chart.tsx'

/**
 * How far below its peak the equity stood at each day's close, marked with its open positions: one line, in percent,
 * 0 at a new high. The deepest point is named in the chart's label for those who cannot see it.
 */
export function UnderwaterChart({ days }: { days: [number, number][] }) {
  const lines = useMemo<ChartLine[]>(() => [{ name: 'Below the peak, %', points: days.map(([time, value]) => ({ time, value })) }], [days])
  const deepest = days.reduce((low, [, value]) => Math.min(low, value), 0)
  return <Chart lines={lines} height={180} label={`The equity’s distance below its peak each day: ${fmtPercent(deepest)} at the deepest.`} />
}

/**
 * Beta and the Sharpe ratio over the 90 days up to each point, every 5th day: two charts on one time axis, never one
 * chart with two scales. A line that wanders says one beta or one Sharpe ratio does not describe the whole period.
 */
export function RollingCharts({ points, market }: { points: RollingPoint[]; market: string }) {
  const beta = useMemo<ChartLine[]>(() => [{ name: `Beta to ${market}`, points: series(points, 'beta') }], [points, market])
  const sharpe = useMemo<ChartLine[]>(() => [{ name: 'Sharpe a year', points: series(points, 'sharpe') }], [points])
  return (
    <div className="stack-sm">
      <Chart lines={beta} height={160} label={`Beta to ${market} over the 90 days up to each point, from ${range(points, 'beta')}.`} />
      <Chart lines={sharpe} height={160} label={`The Sharpe ratio a year over the 90 days up to each point, from ${range(points, 'sharpe')}.`} />
    </div>
  )
}

const series = (points: RollingPoint[], key: 'beta' | 'sharpe') =>
  points.flatMap((point) => (point[key] == null ? [] : [{ time: dayTime(point.day), value: point[key]! }]))

function range(points: RollingPoint[], key: 'beta' | 'sharpe'): string {
  const values = points.flatMap((point) => (point[key] == null ? [] : [point[key]!]))
  return values.length ? `${Math.min(...values).toFixed(2)} to ${Math.max(...values).toFixed(2)}` : 'no values'
}
