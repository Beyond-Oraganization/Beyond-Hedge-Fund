// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The colour tokens of :root and :root[data-theme="light"], as the website's checks.py reads them. */
function tokens(css: string): Record<'classic' | 'light', Record<string, string>> {
  const block = (selector: RegExp) => {
    const body = selector.exec(css)?.[1] ?? ''
    return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1]!, m[2]!.toUpperCase()]))
  }
  const classic = block(/:root\{([^}]*)\}/)
  return { classic, light: { ...classic, ...block(/:root\[data-theme="light"\]\{([^}]*)\}/) } }
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high! + 0.05) / (low! + 0.05)
}

const site = tokens(readFileSync(new URL('./site-tokens.css', import.meta.url), 'utf8'))
const app = tokens(readFileSync(new URL('./tokens.css', import.meta.url), 'utf8'))

describe('the app’s colours are the website’s', () => {
  for (const theme of ['classic', 'light'] as const)
    it(`${theme} theme: every site token has the site's value`, () => {
      for (const [name, value] of Object.entries(site[theme])) expect(`--${name} ${app[theme][name]}`).toBe(`--${name} ${value}`)
    })
})

// The website's CONTRAST_PAIRS (manager/beyondia_manager/checks.py), plus the app's profit and loss colours.
const PAIRS: [string, string, number][] = [
  ['c-fg', 'c-bg', 4.5], ['c-mute', 'c-bg', 4.5], ['c-fg', 'c-alt', 4.5], ['c-mute', 'c-alt', 4.5],
  ['d-fg', 'd-bg', 4.5], ['d-mute', 'd-bg', 4.5], ['d-lead', 'd-bg', 4.5], ['accent-ink', 'accent', 4.5], ['band-ink', 'band', 3],
  ['c-gain', 'c-bg', 4.5], ['c-gain', 'c-alt', 4.5], ['c-loss', 'c-bg', 4.5], ['c-loss', 'c-alt', 4.5],
  ['d-gain', 'd-bg', 4.5], ['d-loss', 'd-bg', 4.5],
]

describe('every text colour reaches WCAG AA on its surface', () => {
  for (const theme of ['classic', 'light'] as const)
    it.each(PAIRS)(`${theme}: --%s on --%s ≥ %d:1`, (fg, bg, minimum) => {
      const ratio = contrast(app[theme][fg]!, app[theme][bg]!)
      expect(ratio, `${app[theme][fg]} on ${app[theme][bg]}`).toBeGreaterThanOrEqual(minimum)
    })
})

// The redesign's kit (docs/fund-app-redesign-plan.md, section 8): data sits on a paper surface. Text greys
// (6–8) and status text (4–5) must read on paper, status text also on its own tints (badges, banners), and the
// darkest shades on the brand background, where key figures stand.
const KIT_PAIRS: [string, string][] = [
  ['c-fg', 'paper'], ['grey-6', 'paper'], ['grey-7', 'paper'], ['grey-8', 'paper'], ['grey-7', 'c-bg'], ['grey-8', 'c-bg'],
  ['grey-8', 'grey-1'], ['c-fg', 'grey-1'],
  ...(['gain', 'loss', 'warn'] as const).flatMap((s): [string, string][] => [
    [`${s}-4`, 'paper'], [`${s}-5`, 'paper'], [`${s}-4`, `${s}-1`], [`${s}-5`, `${s}-1`], [`${s}-5`, `${s}-2`], [`${s}-5`, 'c-bg'],
  ]),
]

describe('the kit’s text colours reach WCAG AA', () => {
  for (const theme of ['classic', 'light'] as const)
    it.each(KIT_PAIRS)(`${theme}: --%s on --%s ≥ 4.5:1`, (fg, bg) => {
      expect(app[theme][fg], `--${fg}`).toBeDefined()
      expect(app[theme][bg], `--${bg}`).toBeDefined()
      expect(contrast(app[theme][fg]!, app[theme][bg]!), `${app[theme][fg]} on ${app[theme][bg]}`).toBeGreaterThanOrEqual(4.5)
    })
})

describe('the kit’s scales get darker step by step', () => {
  const scales: [string, number][] = [['grey', 8], ['gain', 5], ['loss', 5], ['warn', 5]]
  for (const theme of ['classic', 'light'] as const)
    it.each(scales)(`${theme}: --%s-1 … --%s-n`, (name, steps) => {
      const ratios = Array.from({ length: steps }, (_, i) => contrast(app[theme][`${name}-${i + 1}`]!, app[theme].paper!))
      for (let i = 1; i < steps; i++) expect(ratios[i]!, `${name}-${i + 1} vs ${name}-${i}`).toBeGreaterThan(ratios[i - 1]!)
    })
})
