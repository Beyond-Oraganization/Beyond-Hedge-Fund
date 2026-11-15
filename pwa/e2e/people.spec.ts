import { expect, test, type Page } from '@playwright/test'
import { BOT, cspViolations, resetBot, watchCsp } from './helpers.ts'

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

  await expect(page.getByText('Equity', { exact: true })).toBeVisible()
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
  await expect(page.getByText('Equity', { exact: true })).toBeVisible()
})

test('a client starts at their account, and stays in their own places', async ({ page }) => {
  await signIn(page, 'carol')
  await enterCode(page)

  await expect(page).toHaveURL(/#\/me$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible()
  await page.goto('#/markets')
  await expect(page).toHaveURL(/#\/me$/)
})

test('the API key stays for the owner, under Advanced', async ({ page }) => {
  await page.goto('#/signin')
  await page.getByText('Advanced').click()
  await page.getByRole('link', { name: 'Connect with an API key' }).click()
  await expect(page).toHaveURL(/#\/connect$/)
})
