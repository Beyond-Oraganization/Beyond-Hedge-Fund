import { useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import { betaWords } from '../../backtest/figures.ts'
import { niceTicks } from '../../backtest/bins.ts'
import { lineInSquare, nearestDot, scatterLimit } from '../../backtest/scatter.ts'
import type { MarketBeta } from '../../engine/types.ts'
import { fmtCount, fmtSignedPercent } from '../../format.ts'
import { ChartTip, useWidth } from './charting.tsx'

const M = { top: 14, right: 14, bottom: 30, left: 48 }
const LARGEST = 440
// Ticks are sums of steps, so 0 can come out as 1e-18: that is 0, not +0%.
const percent = (fraction: number) => fmtSignedPercent(Math.abs(fraction) < 1e-12 ? 0 : fraction * 100).replace(/\.00%$/, '%')

/**
 * Beta and alpha as a picture: one dot a day, the market's return across and the strategy's up, both axes through 0
 * and on one scale, so the fitted line's slope is beta and where it crosses the vertical axis is alpha. A dashed
 * diagonal shows what holding the market would have done.
 */
export function MarketBetaChart({ dots, beta }: { dots: [number, number][]; beta: MarketBeta }) {
  const box = useRef<HTMLDivElement>(null)
  const width = useWidth(box)
  const clip = useId().replace(/:/g, '')
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null)
  const limit = useMemo(() => scatterLimit(dots), [dots])

  // A square plot, so one percent across is as long as one percent up.
  const side = Math.max(160, Math.min(LARGEST, width - M.left - M.right))
  const height = side + M.top + M.bottom
  const x = (value: number) => M.left + ((value + limit) / (2 * limit)) * side
  const y = (value: number) => M.top + side - ((value + limit) / (2 * limit)) * side
  const fromX = (px: number) => ((px - M.left) / side) * 2 * limit - limit
  const fromY = (py: number) => ((M.top + side - py) / side) * 2 * limit - limit
  const ticks = niceTicks(-limit, limit, Math.max(3, Math.floor(side / 70)))
  const line = lineInSquare(beta.alpha, beta.beta, limit)
  const label =
    `${fmtCount(dots.length)} days. Beta ${beta.beta.toFixed(2)}: ${betaWords(beta.beta)}. ` +
    `Alpha ${fmtSignedPercent(beta.annualAlpha * 100)} a year${beta.alphaT == null ? '' : ` (t ${beta.alphaT.toFixed(1)})`}.`

  const point = (event: PointerEvent<SVGSVGElement>) => {
    // From the svg's own corner for the data, from the frame's for the note: the svg sits centred in the frame.
    const plot = event.currentTarget.getBoundingClientRect()
    const frame = box.current?.getBoundingClientRect() ?? plot
    const index = nearestDot(dots, fromX(event.clientX - plot.left), fromY(event.clientY - plot.top))
    setHover(index < 0 ? null : { index, x: event.clientX - frame.left, y: event.clientY - frame.top })
  }
  const shown = hover ? dots[hover.index] : undefined

  return (
    <div className="stack-sm">
      <div ref={box} className="chart-box" onPointerLeave={() => setHover(null)}>
        {/* Centred in the frame: the plot is square, the frame as wide as the page. */}
        <svg width={side + M.left + M.right} style={{ margin: '0 auto' }} height={height} role="img" aria-label={label} onPointerMove={point}>
          <defs>
            <clipPath id={clip}>
              <rect x={M.left} y={M.top} width={side} height={side} />
            </clipPath>
          </defs>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={M.left} x2={M.left + side} y1={y(tick)} y2={y(tick)} className="grid" />
              <line x1={x(tick)} x2={x(tick)} y1={M.top} y2={M.top + side} className="grid" />
              <text x={M.left - 8} y={y(tick)} className="tick" textAnchor="end" dominantBaseline="middle">
                {percent(tick)}
              </text>
              <text x={x(tick)} y={height - 10} className="tick" textAnchor="middle">
                {percent(tick)}
              </text>
            </g>
          ))}
          <line x1={x(0)} x2={x(0)} y1={M.top} y2={M.top + side} className="zero" />
          <line x1={M.left} x2={M.left + side} y1={y(0)} y2={y(0)} className="zero" />
          <g clipPath={`url(#${clip})`}>
            <line x1={x(-limit)} y1={y(-limit)} x2={x(limit)} y2={y(limit)} className="start" />
            {dots.map(([asset, strategy], index) => (
              <circle key={index} cx={x(asset)} cy={y(strategy)} r={2.5} className="day-dot" />
            ))}
            {line ? (
              <>
                <line x1={x(line[0][0])} y1={y(line[0][1])} x2={x(line[1][0])} y2={y(line[1][1])} className="mean-halo" />
                <line x1={x(line[0][0])} y1={y(line[0][1])} x2={x(line[1][0])} y2={y(line[1][1])} className="mean" />
              </>
            ) : null}
            {shown ? <circle cx={x(shown[0])} cy={y(shown[1])} r={5} className="mean-dot" /> : null}
          </g>
        </svg>
        <ChartTip at={hover} width={width}>
          {shown ? (
            <>
              <strong>Market {percent(shown[0])}</strong>
              <span>Strategy {percent(shown[1])}</span>
            </>
          ) : null}
        </ChartTip>
      </div>
      <p className="chart-legend">
        <span>
          <i className="dot" /> A day ({fmtCount(dots.length)})
        </span>
        <span>
          <i className="thick" /> The fitted line: beta {beta.beta.toFixed(2)}
        </span>
        <span>
          <i className="dash" /> Holding the market
        </span>
      </p>
    </div>
  )
}
