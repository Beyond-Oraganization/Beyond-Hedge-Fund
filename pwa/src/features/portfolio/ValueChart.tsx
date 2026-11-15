import { useEffect, useId, useRef, useState } from 'react'
import { fmtMoney, fmtSignedMoney } from '../../format.ts'
import type { DayValue } from './portfolio.ts'

const HEIGHT = 200
const PAD = { left: 8, right: 12, top: 28, bottom: 24 }

/** "7 Nov" (UTC), from "2026-11-07". */
export const shortDate = (date: string) =>
  new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** The box's width in pixels, so the chart's text keeps its size on a phone and on a computer. */
function useWidth(fallback: number) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.max(240, Math.round(entry.contentRect.width))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { box, width }
}

/** Round, readable bounds for the value axis: 9,420 to 10,610 becomes 9,000 to 11,000. */
function bounds(values: number[]): [number, number] {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || Math.abs(hi) || 1
  const step = 10 ** Math.floor(Math.log10(span))
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step || step]
}

/**
 * The value over time, with each deposit and withdrawal marked where it happened, so a jump is not read as profit
 * (the mockup's Home). A small SVG of its own: the price charts' library is for Research and stays off a client's phone.
 * The caption says the same in words, for anyone who cannot see the chart.
 */
export function ValueChart({ series, currency, title }: { series: DayValue[]; currency: string | null; title: string }) {
  const { box, width } = useWidth(600)
  const id = useId()
  const unit = currency ?? ''
  const first = series[0]
  const last = series.at(-1)
  if (!first || !last || series.length < 2) return null

  const [y0, y1] = bounds(series.map((day) => day.value))
  const x = (index: number) => PAD.left + (index / (series.length - 1)) * (width - PAD.left - PAD.right)
  const y = (value: number) => PAD.top + (1 - (value - y0) / (y1 - y0)) * (HEIGHT - PAD.top - PAD.bottom)
  const line = series.map((day, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(day.value).toFixed(1)}`).join('')
  const area = `${line}L${x(series.length - 1).toFixed(1)},${HEIGHT - PAD.bottom}L${PAD.left},${HEIGHT - PAD.bottom}Z`
  const flows = series.map((day, index) => ({ day, index })).filter(({ day }) => day.cashFlow !== 0)
  // Labels for the last three flows at most; older ones keep their mark.
  const labelled = new Set(flows.slice(-3).map(({ index }) => index))
  const axis = (value: number) => fmtMoney(value).replace(/\.00$/, '')

  const words = [
    `From ${fmtMoney(first.value, unit)} on ${shortDate(first.date)} to ${fmtMoney(last.value, unit)} on ${shortDate(last.date)}.`,
    flows.length
      ? `${flows.length === 1 ? 'Marked' : 'Marked, each'}: ${flows.map(({ day }) => `${day.cashFlow > 0 ? 'a deposit' : 'a withdrawal'} of ${fmtMoney(Math.abs(day.cashFlow), unit)} on ${shortDate(day.date)}`).join('; ')}.`
      : 'No deposits or withdrawals in this time.',
  ].join(' ')

  return (
    <figure className="k-chart" ref={box}>
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-labelledby={`${id}-t`} aria-describedby={`${id}-c`}>
        <title id={`${id}-t`}>{title}</title>
        {[y0, (y0 + y1) / 2, y1].map((value) => (
          <g key={value}>
            <line className="k-chart-grid" x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} />
            <text className="k-chart-axis" x={PAD.left} y={y(value) - 4}>
              {axis(value)}
            </text>
          </g>
        ))}
        <text className="k-chart-axis" x={PAD.left} y={HEIGHT - 6}>
          {shortDate(first.date)}
        </text>
        <text className="k-chart-axis" x={width - PAD.right} y={HEIGHT - 6} textAnchor="end">
          {shortDate(last.date)}
        </text>
        <path className="k-chart-area" d={area} />
        <path className="k-chart-line" d={line} />
        {flows.map(({ day, index }) => (
          <g key={day.date}>
            <line className="k-chart-mark" x1={x(index)} x2={x(index)} y1={PAD.top - 10} y2={HEIGHT - PAD.bottom} />
            {labelled.has(index) ? (
              <text className="k-chart-tag" x={x(index) + (x(index) > width / 2 ? -4 : 4)} y={PAD.top - 14} textAnchor={x(index) > width / 2 ? 'end' : 'start'}>
                {day.cashFlow > 0 ? 'Deposit' : 'Withdrawal'} {fmtSignedMoney(day.cashFlow).replace(/\.00$/, '')}
              </text>
            ) : null}
          </g>
        ))}
        <circle className="k-chart-dot" cx={x(series.length - 1)} cy={y(last.value)} r={4} />
      </svg>
      <figcaption id={`${id}-c`} className="k-hint">
        {words}
      </figcaption>
    </figure>
  )
}
