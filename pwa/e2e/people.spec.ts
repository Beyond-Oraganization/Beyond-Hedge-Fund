import { expect, test, type Page } from '@playwright/test'
import { BOT, cspViolations, resetBot, shown, watchCsp } from './helpers.ts'

/**
 * The fund's people (mock-bot/people.mjs): signing in with a password and a 6-digit code, the navigation of their role,
 * and signing out. Any code but 000000 is right in the mock.
 */
test.beforeEach(async ({ page }) => {
  await resetBot()
  await watchCsp(page)
})

test.afterEach(async ({ page }) => {
  expect(await cspViolations(page)).toEqual([])
})

async function signIn(page: Page, login: string, password = 'demo-password') {
  await page.goto('#/')
  await expect(page).toHaveURL(/#\/signin/)
  await page.getByLabel('Server').fill(BOT)
  await page.getByLabel('Login').fill(login)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Continue' }).click()
}

async function enterCode(page: Page, code = '123456') {
  await page.getByLabel('6-digit code', { exact: true }).fill(code)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('staff sign in with a password and a code, see their role’s screens, and sign out', async ({ page, isMobile }) => {
  await signIn(page, 'sam')
  await enterCode(page, '000000')
  await expect(page.getByText('Invalid code.')).toBeVisible()
  await enterCode(page)

  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
  if (isMobile) {
    await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Admin' }).click()
    const admin = page.getByRole('navigation', { name: 'Admin screens' })
    await expect(admin.getByRole('link', { name: 'System' })).toBeVisible()
    await expect(admin.getByRole('link', { name: 'Console' })).toHaveCount(0)
    await admin.getByRole('link', { name: 'Your sign-in' }).click()
  } else {
    const side = page.getByRole('navigation', { name: 'Main navigation' })
    await expect(side.getByRole('link', { name: 'System' })).toBeVisible()
    await expect(side.getByRole('link', { name: 'Console' })).toHaveCount(0)
    await side.getByRole('link', { name: 'Your sign-in' }).click()
  }

  await expect(page.getByRole('heading', { level: 1, name: 'Your sign-in' })).toBeVisible()
  await expect(page.getByText('Staff of the fund')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page).toHaveURL(/#\/signin\?login=sam/)
  await expect(page.getByLabel('Login')).toHaveValue('sam')
})

test('a first sign-in chooses a password and adds the code app', async ({ page }) => {
  await signIn(page, 'newbie', 'temporary-1')
  await page.getByLabel('New password', { exact: true }).fill('my-own-password')
  await page.getByLabel('New password again').fill('my-own-password')
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: 'Add the fund to your code app' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open in your code app' })).toHaveAttribute('href', /^otpauth:\/\/totp\//)
  await enterCode(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
})

test('a client starts at Home, sees their money and what happened, and stays in their own places', async ({ page }) => {
  await signIn(page, 'carol')
  await enterCode(page)

  await expect(page).toHaveURL(/#\/home$/)
  await expect(page.getByText('Your portfolio')).toBeVisible()
  await expect(page.getByText(/^[\d,]+\.\d\d EUR$/)).toBeVisible()
  await expect(page.getByText(/a deposit of 2,000\.00 EUR on/)).toBeVisible()
  await expect(page.getByText('Closed XAUUSD buy 2 at a gain of 84.10')).toBeVisible()

  await shown(page.getByRole('link', { name: 'Activity', exact: true })).click()
  await expect(page).toHaveURL(/#\/activity$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible()
  await expect(page.getByText('Deposit: Second transfer')).toBeVisible()

  await shown(page.getByRole('link', { name: /^(Account|Your account)$/ })).click()
  await expect(page).toHaveURL(/#\/me$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible()
  await expect(page.getByText('demo, in EUR')).toBeVisible()

  await page.goto('#/markets')
  await expect(page).toHaveURL(/#\/home$/)
})

test('staff open a client, see what the client sees, and link and unlink their account', async ({ page }) => {
  await signIn(page, 'sam')
  await enterCode(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()

  await shown(page.getByRole('link', { name: 'Clients', exact: true })).click()
  await expect(page).toHaveURL(/#\/clients$/)
  await shown(page.getByRole('link', { name: 'Carol Example' })).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Carol Example' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'What the client sees' }).getByText(/^[\d,]+\.\d\d EUR$/)).toBeVisible()

  const accounts = page.getByRole('region', { name: 'Accounts' })
  await accounts.getByRole('button', { name: 'Unlink demo' }).click()
  await expect(accounts.getByText('No account linked yet.')).toBeVisible()
  await accounts.getByLabel('Managed account').selectOption('demo')
  await accounts.getByRole('button', { name: 'Link account' }).click()
  await expect(accounts.getByRole('button', { name: 'Unlink demo' })).toBeVisible()

  await page.getByRole('link', { name: 'View as client' }).click()
  await expect(page.getByText('You are seeing what Carol Example sees')).toBeVisible()
  await expect(page.getByText('Your portfolio')).toBeVisible()
})

test('the owner adds a person, hands over the temporary password, and sees it in the audit log', async ({ page }) => {
  await signIn(page, 'olga')
  await enterCode(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()

  await page.goto('#/people')
  await page.getByLabel('Login', { exact: true }).fill('dana')
  await page.getByLabel('Name', { exact: true }).fill('Dana Example')
  await page.getByRole('button', { name: 'Add person' }).click()
  await expect(page.getByText(/^Added dana \(Dana Example\), client\./)).toBeVisible()
  await expect(page.locator('.k-secret')).toHaveText(/^[a-zA-Z2-9]{14}$/)

  await page.goto('#/audit')
  await expect(shown(page.getByText('people add dana --name Dana Example --role client --password=***'))).toBeVisible()
})

test('a client starts a strategy from the menu within their limits, and stops it', async ({ page }) => {
  await signIn(page, 'carol')
  await enterCode(page)
  await expect(page).toHaveURL(/#\/home$/)

  await shown(page.getByRole('link', { name: 'Strategies', exact: true })).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Strategies' })).toBeVisible()
  await page.getByRole('button', { name: 'Choose Gold trend, steady' }).click()
  await expect(page.getByText(/^At most [\d,]+\.\d\d EUR on this account\./)).toBeVisible()
  await page.getByLabel(/^Budget/).fill('99999')
  await page.getByRole('button', { name: 'Check' }).click()
  await expect(page.getByText('It would not start')).toBeVisible()
  await page.getByLabel(/^Budget/).fill('2000')
  await page.getByRole('button', { name: 'Check' }).click()
  await expect(page.getByText('It would start')).toBeVisible()
  await page.getByRole('button', { name: 'Start Gold trend, steady' }).click()
  await expect(page.getByText(/^Gold trend, steady is trading for you with 2,000\.00 EUR\./)).toBeVisible()

  const running = page.getByRole('region', { name: 'Trading for you' })
  await expect(running.getByText('Gold trend steady')).toBeVisible()
  await running.getByRole('button', { name: 'Stop Gold trend steady' }).click()
  await running.getByRole('group', { name: 'Stop Gold trend steady?' }).getByRole('button', { name: 'Stop it' }).click()
  await expect(running.getByText('Gold trend steady')).toHaveCount(0)
})

test('the API key stays for the owner, under Advanced', async ({ page }) => {
  await page.goto('#/signin')
  await page.getByText('Advanced').click()
  await page.getByRole('link', { name: 'Connect with an API key' }).click()
  await expect(page).toHaveURL(/#\/connect$/)
})
