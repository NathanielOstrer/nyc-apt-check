import { expect, test } from '@playwright/test'
import { mockApis } from './mockApis'

const card = (page: import('@playwright/test').Page, id: string) => page.locator(`[data-check="${id}"]`)

test('shows the experimental notice before any search', async ({ page }) => {
  await mockApis(page)
  await page.goto('./')
  await expect(page.getByRole('note')).toContainText('Experimental.')
  await expect(page.getByRole('note')).toContainText('Check each result at its source before you sign a lease.')
})

test('picks an address from the suggestions and shows every check', async ({ page }) => {
  await mockApis(page)
  await page.goto('./')

  await page.getByLabel('Address').fill('1 test')
  await page.getByRole('option', { name: '1 TEST AVENUE, Brooklyn, NY' }).click()

  await expect(page.getByRole('heading', { level: 2, name: '1 TEST AVENUE, Brooklyn, NY' })).toBeVisible()
  await expect(page.getByText(/The page found 2 high risks and \d+ medium risks?\./)).toBeVisible()

  await expect(card(page, 'superfund')).toContainText('High risk')
  await expect(card(page, 'superfund')).toContainText('The address is inside the Test Canal Superfund site.')
  await expect(card(page, 'state-cleanup')).toContainText('Test Brownfield is on or next to this lot.')
  await expect(card(page, 'flood')).toContainText('FEMA flood zone AE')
  await expect(card(page, 'building-info')).toContainText('A 1928 building with 24 apartments.')
  await expect(card(page, 'crime')).toContainText('2 were felonies')
  await expect(page.locator('[data-check]')).toHaveCount(13)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)

  // The map draws the Superfund polygon and the address marker.
  await expect(page.locator('.leaflet-overlay-pane path')).not.toHaveCount(0)

  // The address is in the URL, so the result can be shared.
  expect(new URL(page.url()).searchParams.get('address')).toBe('1 TEST AVENUE, Brooklyn, NY')
})

test('supports the keyboard in the suggestion list', async ({ page }) => {
  await mockApis(page)
  await page.goto('./')
  const input = page.getByLabel('Address')
  await input.fill('1 test')
  await expect(page.getByRole('option')).toHaveCount(1)
  await input.press('ArrowDown')
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await input.press('Enter')
  await expect(page.getByRole('heading', { level: 2, name: '1 TEST AVENUE, Brooklyn, NY' })).toBeVisible()
})

test('runs the checks from a shared link', async ({ page }) => {
  await mockApis(page)
  await page.goto('./?address=1%20TEST%20AVENUE%2C%20Brooklyn')
  await expect(page.getByLabel('Address')).toHaveValue('1 TEST AVENUE, Brooklyn')
  await expect(card(page, 'superfund')).toContainText('High risk')
  // The suggestion list must not open over the results for text the user did not type.
  await page.waitForTimeout(600)
  await expect(page.getByRole('listbox')).toHaveCount(0)
})

test('says so when the address is not found', async ({ page }) => {
  await mockApis(page, { noMatch: true })
  await page.goto('./')
  await page.getByLabel('Address').fill('nowhere at all')
  await page.getByRole('button', { name: 'Check address' }).click()
  await expect(page.getByRole('alert')).toHaveText('The address was not found. Enter a street address in New York City.')
})

test('shows a failed source on its own card and retries it', async ({ page }) => {
  const failing = new Set(['wvxf-dwi5'])
  await mockApis(page, { failing })
  await page.goto('./?address=1%20TEST%20AVENUE')

  const violations = card(page, 'hpd-violations')
  await expect(violations).toContainText('The data did not load.')
  // The other cards still load.
  await expect(card(page, 'superfund')).toContainText('High risk')

  failing.clear()
  await violations.getByRole('button', { name: 'Try again' }).click()
  await expect(violations).toContainText('The building has 2 open HPD violations.')
})
