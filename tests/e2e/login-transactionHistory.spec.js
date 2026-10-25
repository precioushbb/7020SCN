import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { Builder, By, until } from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'

// ========================================
// TEST CONFIGURATION
// ========================================

const BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:9000').replace(/\/$/, '')

const EMAIL = 'precioushobobo@gmail.com'
const PASSWORD = 'tammie3$'

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
// HELPER: CLICK ELEMENT
// ========================================

async function clickElement(driver, locator) {
  const element = await visible(driver, locator)

  await driver.wait(until.elementIsEnabled(element), TIMEOUT)

  await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', element)

  await element.click()

  return element
}

// ========================================
// MAIN SELENIUM E2E TEST
// ========================================

test('E2E: Login → Dashboard → Transaction History', { timeout: 90000 }, async (t) => {
  assert.ok(EMAIL, 'Set E2E_EMAIL before running')
  assert.ok(PASSWORD, 'Set E2E_PASSWORD before running')

  const options = new chrome.Options().windowSize({ width: 1440, height: 900 })

  const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build()

  try {
    // ==================================
    // STEP 1: OPEN LOGIN PAGE
    // ==================================

    console.log('STEP 1: Opening login page')

    await driver.get(`${BASE_URL}/#/login`)

    const emailInput = await visible(driver, By.css('input[type="email"]'))

    assert.ok(emailInput)

    // ==================================
    // STEP 2: ENTER CREDENTIALS
    // ==================================

    console.log('STEP 2: Entering credentials')

    await emailInput.sendKeys(EMAIL)

    const passwordInput = await visible(driver, By.css('input[type="password"]'))

    await passwordInput.sendKeys(PASSWORD)

    // ==================================
    // STEP 3: LOGIN
    // ==================================

    console.log('STEP 3: Logging in')

    await clickElement(driver, By.css('button.auth-submit[type="submit"]'))

    // ==================================
    // STEP 4: VERIFY DASHBOARD
    // ==================================

    console.log('STEP 4: Verifying dashboard')

    await driver.wait(
      until.urlMatches(/\/dashboard(?:[/?#]|$)/),
      TIMEOUT,
      'Dashboard was not reached',
    )

    assert.match(await driver.getCurrentUrl(), /\/dashboard/)

    console.log('Dashboard loaded successfully')

    // ==================================
    // STEP 5: OPEN TRANSACTION HISTORY
    // ==================================

    console.log('STEP 5: Opening Transaction History')

    // Click the Transactions item in the sidebar.
    await clickElement(
      driver,
      By.xpath("//*[contains(@class,'q-drawer')]" + "//*[normalize-space(text())='Transactions']"),
    )

    // ==================================
    // STEP 6: VERIFY NAVIGATION
    // ==================================

    console.log('STEP 6: Verifying transaction route')

    await driver.wait(
      until.urlContains('/dashboard/all-transactions'),
      TIMEOUT,
      'Transaction History route was not reached',
    )

    assert.match(await driver.getCurrentUrl(), /\/dashboard\/all-transactions/)

    // ==================================
    // STEP 7: VERIFY PAGE CONTENT
    // ==================================

    console.log('STEP 7: Checking Transaction History page')

    const page = await visible(driver, By.css('.q-page'))

    assert.ok(await page.isDisplayed(), 'Transaction History page is not visible')

    // ==================================
    // TEST PASSED
    // ==================================

    console.log('E2E TEST PASSED')
    console.log('Login successful')
    console.log('Dashboard loaded')
    console.log('Transaction History opened')

    t.diagnostic('Login and Transaction History navigation completed')
  } catch (error) {
    // ==================================
    // FAILURE SCREENSHOT
    // ==================================

    await mkdir('tests/e2e/screenshots', { recursive: true })

    const screenshotPath = 'tests/e2e/screenshots/transaction-history-failure.png'

    await writeFile(screenshotPath, await driver.takeScreenshot(), 'base64')

    console.error('TEST FAILED:', error.message)
    console.error('Current URL:', await driver.getCurrentUrl())

    t.diagnostic(`Screenshot: ${screenshotPath}`)

    throw error
  } finally {
    await driver.quit()
  }
})
