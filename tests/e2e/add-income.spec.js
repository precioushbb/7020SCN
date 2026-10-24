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

const AMOUNT = '17.25'
const NOTE = `Selenium Income ${Date.now()}`

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
// HELPER: SELECT QUASAR DROPDOWN
// ========================================

// index 0 = Income Category
// index 1 = Account

async function selectDropdownByIndex(driver, index) {
  const field = await driver.wait(
    async () => {
      const selects = await driver.findElements(By.css('form .q-select'))

      if (selects.length <= index) return false

      const selected = selects[index]

      return (await selected.isDisplayed()) ? selected : false
    },
    TIMEOUT,
    `Dropdown ${index} not found`,
  )

  await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', field)

  await field.click()

  // Wait for an enabled option in the open menu
  const option = await driver.wait(
    async () => {
      const options = await driver.findElements(By.css('.q-menu .q-item, [role="option"]'))

      for (const item of options) {
        if ((await item.isDisplayed()) && (await item.isEnabled())) {
          return item
        }
      }

      return false
    },
    TIMEOUT,
    `No available options for dropdown ${index}`,
  )

  const selectedText = await option.getText()

  await option.click()

  console.log(`Selected option: ${selectedText}`)

  return selectedText
}

// ========================================
// HELPER: OPEN LOGIN PAGE
// ========================================

async function openLoginPage(driver) {
  // Try hash routing first, then history routing
  for (const path of ['/#/login', '/login']) {
    await driver.get(`${BASE_URL}${path}`)

    try {
      const input = await visible(driver, By.css('input[type="email"]'), 5000)

      return input
    } catch {
      console.log(`Login not found at ${path}`)
    }
  }

  throw new Error(`Unable to locate login page. URL: ${await driver.getCurrentUrl()}`)
}

// ========================================
// MAIN SELENIUM E2E TEST
// ========================================

test('E2E: Login → Dashboard → Quick Add → Add Income', async (t) => {
  assert.ok(PASSWORD, 'Set E2E_PASSWORD before running the test')

  const options = new chrome.Options().windowSize({ width: 1440, height: 900 })

  const driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build()

  try {
    // ==================================
    // STEP 1: OPEN LOGIN PAGE
    // ==================================

    console.log('STEP 1: Opening login page')

    const emailInput = await openLoginPage(driver)

    assert.ok(emailInput)

    // ==================================
    // STEP 2: ENTER LOGIN CREDENTIALS
    // ==================================

    console.log('STEP 2: Entering credentials')

    await emailInput.clear()
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

    await driver.wait(until.urlContains('/dashboard'), TIMEOUT, 'Dashboard was not reached')

    console.log('STEP 4: Dashboard loaded')

    assert.match(await driver.getCurrentUrl(), /\/dashboard/)

    // ==================================
    // STEP 5: OPEN QUICK ADD
    // ==================================

    console.log('STEP 5: Opening Quick Add')

    await clickElement(driver, By.css('.quick-add-btn'))

    await visible(driver, By.css('.quick-add-dialog'))

    // ==================================
    // STEP 6: SELECT ADD INCOME
    // ==================================

    console.log('STEP 6: Selecting Add Income')

    await clickElement(
      driver,
      By.xpath(
        "//*[contains(@class,'quick-add-dialog')]" +
          "//*[contains(@class,'quick-add-action-item')]" +
          "[.//*[contains(@class,'quick-add-action-label')" +
          " and normalize-space(.)='Income']]",
      ),
    )

    await driver.wait(
      until.urlContains('/dashboard/add-income'),
      TIMEOUT,
      'Add Income page did not load',
    )

    // ==================================
    // STEP 7: ENTER INCOME AMOUNT
    // ==================================

    console.log('STEP 7: Entering amount')

    const amountInput = await visible(driver, By.css('form input[type="number"]'))

    await amountInput.clear()
    await amountInput.sendKeys(AMOUNT)

    assert.equal(await amountInput.getAttribute('value'), AMOUNT)

    // ==================================
    // STEP 8: SELECT INCOME CATEGORY
    // ==================================

    console.log('STEP 8: Selecting category')

    const category = await selectDropdownByIndex(driver, 0)

    assert.ok(category)

    // ==================================
    // STEP 9: SELECT ACCOUNT
    // ==================================

    console.log('STEP 9: Selecting account')

    const account = await selectDropdownByIndex(driver, 0)

    assert.ok(account)

    // ==================================
    // STEP 10: VERIFY DATE AND TIME
    // ==================================

    console.log('STEP 10: Checking date and time')

    const readonlyInputs = await driver.findElements(By.css('form input[readonly]'))

    assert.ok(readonlyInputs.length >= 2, 'Expected date and time fields')

    const date = await readonlyInputs[0].getAttribute('value')
    const time = await readonlyInputs[1].getAttribute('value')

    assert.ok(date, 'Date is required')
    assert.ok(time, 'Time is required')

    console.log(`Date: ${date}`)
    console.log(`Time: ${time}`)

    // ==================================
    // STEP 11: ENTER NOTES
    // ==================================

    console.log('STEP 11: Entering notes')

    const notesInput = await visible(driver, By.css('form textarea'))

    await notesInput.clear()
    await notesInput.sendKeys(NOTE)

    // ==================================
    // STEP 12: SAVE INCOME
    // ==================================

    console.log('STEP 12: Saving income')

    const saveButton = await visible(driver, By.css('form button[type="submit"]'))

    await driver.wait(until.elementIsEnabled(saveButton), TIMEOUT)

    await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', saveButton)

    await saveButton.click()

    // ==================================
    // STEP 13: VERIFY SUCCESSFUL RETURN
    // ==================================

    console.log('STEP 13: Checking form submission')

    await driver.wait(
      async () => {
        const url = await driver.getCurrentUrl()

        return url.includes('/dashboard') && !url.includes('/dashboard/add-income')
      },
      TIMEOUT,
      'Income form did not return to dashboard',
    )

    // ==================================
    // STEP 14: VERIFY TRANSACTION
    // ==================================

    console.log('STEP 14: Checking saved transaction')

    await driver.wait(
      async () => {
        const body = await driver.findElement(By.css('body')).getText()

        return body.includes(NOTE)
      },
      TIMEOUT,
      'New income note not found on dashboard',
    )

    assert.ok((await driver.findElement(By.css('body')).getText()).includes(NOTE))

    // ==================================
    // TEST COMPLETED
    // ==================================

    console.log('E2E TEST PASSED')
    console.log(`Email: ${EMAIL}`)
    console.log(`Amount: ${AMOUNT}`)
    console.log(`Category: ${category}`)
    console.log(`Account: ${account}`)
    console.log(`Note: ${NOTE}`)

    t.diagnostic('Income flow completed')
  } catch (error) {
    // ==================================
    // FAILURE SCREENSHOT
    // ==================================

    await mkdir('tests/e2e/screenshots', { recursive: true })

    const screenshotPath = 'tests/e2e/screenshots/add-income-failure.png'

    await writeFile(screenshotPath, await driver.takeScreenshot(), 'base64')

    console.error('TEST FAILED:', error.message)
    console.error('Current URL:', await driver.getCurrentUrl())

    t.diagnostic(`Screenshot: ${screenshotPath}`)

    throw error
  } finally {
    await driver.quit()
  }
})
