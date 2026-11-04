import { Answer } from '../components/Answer.tsx'
import { DataTable } from '../components/DataTable.tsx'
import { ScreenHead } from '../components/ScreenHead.tsx'
import { ButtonLink, Pill, Section } from '../components/ui.tsx'
import { useStrategies } from '../hooks/data.ts'

export default function Strategies() {
  const strategies = useStrategies()
  // An example rule from the catalog itself: the app names no strategy of its own.
  const example = strategies.data?.parsed.ok ? strategies.data.parsed.value.find((d) => d.rules?.defaults.length)?.rules?.defaults[0] : undefined
  return (
    <>
      <ScreenHead kicker="Strategies" title="What the bot can run." lead="Each strategy is a pure function of the candles: live trading and backtests share the same decision code, so they cannot drift apart." />
      <Section variant="alt" label="Catalog">
        <Answer query={strategies}>
          {(definitions) => (
            <ul className="rows">
              {definitions.map((definition) => {
                const market = definition.defaultMarket ? `${definition.defaultMarket.symbol} ${definition.defaultMarket.interval}` : null
                return (
                  <li key={definition.name} className="g2">
                    <div className="stack-sm">
                      <p className="label mute">Strategy</p>
                      <div className="pills">
                        <Pill tone="solid">{definition.name}</Pill>
                        {market ? <Pill>{market}</Pill> : null}
                      </div>
                    </div>
                    <div className="stack">
                      <h2 className="h2">{definition.title}</h2>
                      <p className="p">{definition.description}</p>
                      <DataTable
                        caption={`${definition.name} parameters`}
                        rows={definition.parameters}
                        rowKey={(p) => p.name}
                        columns={[
                          { key: 'name', header: 'Parameter', card: 'title', render: (p) => <span className="mono">{p.name}</span> },
                          { key: 'default', header: 'Default', card: 'sub', align: 'right', render: (p) => p.default },
                          { key: 'range', header: 'Range', align: 'right', render: (p) => `${p.min}–${p.max}` },
                          { key: 'meaning', header: 'Meaning', wrap: true, render: (p) => p.meaning },
                        ]}
                      />
                      {definition.rules ? (
                        <div className="stack-sm">
                          <p className="label mute">Default rules, tried in order</p>
                          <ol className="rule-list mono">
                            {definition.rules.defaults.map((rule) => (
                              <li key={rule}>{rule}</li>
                            ))}
                          </ol>
                          <p className="hint">
                            Write others as <code className="mono">{definition.rules.syntax}</code>; the Trading and Backtest forms build them for you.
                          </p>
                        </div>
                      ) : null}
                      <div className="btn-row">
                        <ButtonLink to={`/backtest?strategy=${encodeURIComponent(definition.name)}${market ? `&market=${encodeURIComponent(market)}` : ''}`} icon="backtest">
                          Backtest it
                        </ButtonLink>
                        <ButtonLink to={`/trading?strategy=${encodeURIComponent(definition.name)}${market ? `&start=${encodeURIComponent(market)}` : ''}`} variant="ghost" icon="play">
                          Trade it
                        </ButtonLink>
                        {market ? (
                          <ButtonLink to={`/markets/${definition.defaultMarket!.symbol}/${encodeURIComponent(definition.defaultMarket!.interval)}`} variant="ghost" icon="markets">
                            Its market
                          </ButtonLink>
                        ) : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Answer>
      </Section>
      <Section label="How rules decide">
        <div className="stack">
          <h2 className="h2">How rules decide</h2>
          <p className="p">
            A strategy computes its values (a line, an average…) and trades by rules. Each rule says what to do when its condition holds on a closed candle
            {example ? (
              <>
                :{' '}<code className="mono">{example}</code>.
              </>
            ) : (
              '.'
            )}
          </p>
          <ul className="checks">
            <li>
              <span>
                <strong>Open or close, long or short.</strong> An open spends the strategy’s share of the balance; a close closes the newest open position on that side.
              </span>
            </li>
            <li>
              <span>
                <strong>Tried in order.</strong> On each closed candle the first rule whose condition holds gives the signal; if none holds, nothing happens.
              </span>
            </li>
            <li>
              <span>Replace a strategy’s rules in the Trading and Backtest forms. Live trading and backtests run the same rules, so they cannot drift apart.</span>
            </li>
            <li>
              <span>A candle is acted on at most once; a restart only previews the newest candle and never repeats a trade.</span>
            </li>
            <li>
              <span>Weekend-closed symbols (XAUUSD, XAGUSD, EURUSD, EURPLN…) never trade Saturday and Sunday candles.</span>
            </li>
          </ul>
        </div>
      </Section>
    </>
  )
}
