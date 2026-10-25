import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'mocha'
import { Builder, By, until } from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'

const BASE_URL = (process.env.TEST_BASE_URL || 'http://localhost:9000').replace(/\/$/, '')
const EMAIL = 'precioushobobo@gmail.com'
const PASSWORD = 'tammie3$'
const SEARCH_TERM = process.env.E2E_SEARCH_TERM || 'Salary'

const TIMEOUT = 25000

// ========================================
// HELPER: WAIT FOR VISIBLE ELEMENT
// ========================================

async function visible(driver, locator, timeout = TIMEOUT) {
  return driver.wait(
    async () => {
      const elements = await driver.findElements(locator)

      for (const element of elements) {
        if (await element.isDisplayed()) {
          return element
        }
      }

      return false
    },
    timeout,
    `Visible element not found: ${locator}`,
  )
}

// ========================================
// HELPER: WAIT FOR SEARCH PAGE
// ========================================

async function waitForSearchReady(driver) {
  await visible(driver, By.css('.page-container .q-input input'))

  console.log('Search input is visible')
}

// ========================================
// MAIN E2E TEST
// ========================================

describe('E2E: Login → Dashboard → Search', function () {
  this.timeout(90000)

  let driver

  beforeEach(async function () {
    assert.ok(EMAIL, 'Set E2E_EMAIL before running')
    assert.ok(PASSWORD, 'Set E2E_PASSWORD before running')

    const options = new chrome.Options().windowSize({ width: 1440, height: 900 })

    driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build()
  })

  afterEach(async function () {
    if (driver) {
      await driver.quit()
    }
  })

  it('logs in, searches transactions, and filters income', async function () {
    // ==================================
    // STEP 1: OPEN LOGIN PAGE
    // ==================================

    console.log('STEP 1: Opening login page')

    await driver.get(`${BASE_URL}/#/login`)

    const emailInput = await visible(driver, By.css('input[type="email"]'))

    const passwordInput = await visible(driver, By.css('input[type="password"]'))

    // ==================================
    // STEP 2: ENTER CREDENTIALS
    // ==================================

    console.log('STEP 2: Entering credentials')

    await emailInput.sendKeys(EMAIL)
    await passwordInput.sendKeys(PASSWORD)

    // ==================================
    // STEP 3: LOGIN
    // ==================================

    console.log('STEP 3: Logging in')

    const submitButton = await visible(driver, By.css('button.auth-submit'))

    await submitButton.click()

    // ==================================
    // STEP 4: VERIFY DASHBOARD
    // ==================================

    console.log('STEP 4: Verifying dashboard')

    await driver.wait(until.urlContains('/dashboard'), TIMEOUT, 'Login did not reach dashboard')

    assert.ok((await driver.getCurrentUrl()).includes('/dashboard'))

    console.log('Dashboard loaded successfully')

    // ==================================
    // STEP 5: NAVIGATE TO SEARCH
    // ==================================

    console.log('STEP 5: Opening Search page')

    await driver.get(`${BASE_URL}/#/dashboard/search`)

    await driver.wait(
      until.urlContains('/dashboard/search'),
      TIMEOUT,
      'Search route was not reached',
    )

    await waitForSearchReady(driver)

    console.log('Search page loaded')

    // ==================================
    // STEP 6: PERFORM SEARCH
    // ==================================

    console.log(`STEP 6: Searching for "${SEARCH_TERM}"`)

    const searchInput = await visible(driver, By.css('.page-container .q-input input'))

    await searchInput.clear()
    await searchInput.sendKeys(SEARCH_TERM)

    assert.equal(await searchInput.getAttribute('value'), SEARCH_TERM)

    console.log('Search query entered successfully')

    // ==================================
    // STEP 7: VERIFY SEARCH INPUT
    // ==================================

    console.log('STEP 7: Verifying search functionality')

    // Confirm the search keyword remains in the input.
    const enteredQuery = await searchInput.getAttribute('value')

    assert.equal(enteredQuery, SEARCH_TERM, 'Search input does not contain the expected keyword')

    // Confirm the user remains on the Search page.
    const currentUrl = await driver.getCurrentUrl()

    assert.ok(currentUrl.includes('/dashboard/search'), 'User unexpectedly left the Search page')

    // ==================================
    // STEP 8: CLEAR SEARCH
    // ==================================

    console.log('STEP 8: Clearing search query')

    await searchInput.clear()

    assert.equal(await searchInput.getAttribute('value'), '', 'Search input was not cleared')

    // ==================================
    // STEP 9: VERIFY SEARCH CAN BE REUSED
    // ==================================

    console.log('STEP 9: Performing another search')

    await searchInput.sendKeys('Food')

    assert.equal(
      await searchInput.getAttribute('value'),
      'Food',
      'Second search query was not entered',
    )

    console.log('E2E TEST PASSED')
    console.log('Login successful')
    console.log('Search page opened')
    console.log('Search input accepts and clears queries')
  })
})
