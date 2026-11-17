import { expect, test, type Page } from '@playwright/test'
import { BOT, cspViolations, KEY, resetBot, watchCsp } from './helpers.ts'

/**
 * Sealed strategies: the engine ships without them, and the bot hands its strategy pack (here the made-up sample pack,
 * mock-bot/sample-pack/) only to staff, the owner and the clients the fund trusts. A client it does not trust chooses
 * setups by their name, cannot backtest, and gets no pack.
 */
test.beforeEach(async ({ page }) => {
  await resetBot()
  await watchCsp(page)
})

test.afterEach(async ({ page }) => {
  expect(await cspViolations(page)).toEqual([])
})

async function signIn(page: Page, login: string) {
  await page.goto('#/')
  await expect(page).toHaveURL(/#\/signin/)
  await page.getByLabel('Server').fill(BOT)
  await page.getByLabel('Login').fill(login)
  await page.getByLabel('Password', { exact: true }).fill('demo-password')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('6-digit code', { exact: true }).fill('123456')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** The strategy packs this device keeps (IndexedDB "beyond-bot", engine/pack.ts), by key. */
const keptPacks = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open('beyond-bot')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const database = open.result
          if (!database.objectStoreNames.contains('kv')) return resolve([])
          const keys = database.transaction('kv').objectStore('kv').getAllKeys()
          keys.onsuccess = () => resolve((keys.result as string[]).filter((key) => String(key).startsWith('pack:')))
          keys.onerror = () => reject(keys.error)
        }
      }),
  )

/** What the owner runs with the API key, e.g. trusting a client. */
async function asOwner(args: string[]) {
  const response = await fetch(`${BOT}/`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ args }) })
  expect(((await response.json()) as { ok: boolean }).ok).toBe(true)
}

async function backtest(page: Page) {
  await page.goto('#/backtest')
  await page.getByRole('button', { name: 'Run the backtest' }).click()
  // The engine runs the pack's strategy: without it, it would answer that no strategies are loaded.
  await expect(page.getByRole('heading', { name: 'Monte Carlo' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/No strategies are loaded/)).toHaveCount(0)
}

test('staff get the strategy pack at sign-in, backtest with it on the device, and signing out forgets it', async ({ page }) => {
  await signIn(page, 'sam')
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  await expect.poll(() => keptPacks(page)).toHaveLength(1)

  await backtest(page)

  await page.goto('#/me')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/#\/signin/)
  await expect.poll(() => keptPacks(page)).toEqual([])
})

test('a client the fund does not trust reads setups by name and how they were tested, cannot backtest, and gets no pack', async ({ page }) => {
  await signIn(page, 'carol')
  await expect(page).toHaveURL(/#\/home/)

  await page.goto('#/my-strategies')
  const offers = page.getByRole('region', { name: 'Add a strategy' })
  await expect(offers.getByText('Gold trend, steady')).toBeVisible()
  await expect(offers.getByText(/Tested from 2024-01-01 to 2026-11-01/)).toBeVisible()
  await expect(page.getByText(/length=|spread=|cross up/)).toHaveCount(0)

  // Backtest is not one of a client's places: the app takes them back to their own.
  await page.goto('#/backtest')
  await expect(page).not.toHaveURL(/#\/backtest/)
  expect(await keptPacks(page)).toEqual([])
})

test('a client the fund trusts gets the pack and backtests, sized without Kelly (the bot’s, not theirs)', async ({ page }) => {
  await asOwner(['people', 'trust', 'carol', 'on'])
  await signIn(page, 'carol')
  await expect(page).toHaveURL(/#\/home/)
  await expect.poll(() => keptPacks(page)).toHaveLength(1)

  await page.goto('#/backtest')
  await expect(page).toHaveURL(/#\/backtest/)
  const sizing = page.getByLabel('Position sizing')
  await expect(sizing.locator('option', { hasText: 'Kelly' })).toHaveCount(0)
  await backtest(page)
})
