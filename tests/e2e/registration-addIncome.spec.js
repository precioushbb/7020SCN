import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'mocha'
import { Builder, By, until } from 'selenium-webdriver'
import chrome from 'selenium-webdriver/chrome.js'

const BASE_URL = (process.env.TEST_BASE_URL || 'http://localhost:9000').replace(/\/$/, '')

const REGISTER_URL = `${BASE_URL}/#/register`
const ADD_INCOME_URL = `${BASE_URL}/#/dashboard/add-income`

const TIMEOUT = 25000

// Use a unique email for each test run.
const EMAIL = process.env.TEST_REGISTER_EMAIL || `selenium-${Date.now()}@example.com`

const PASSWORD = process.env.TEST_REGISTER_PASSWORD || 'Test1234!'

const AMOUNT = '17.25'
const NOTE = `Selenium Income ${Date.now()}`

// ========================================
// SELECTORS
// ========================================

const registerEmail = By.css('input[autocomplete="email"]')

const registerPassword = By.css('input[placeholder="Min 8 chars, 1 uppercase, 1 number"]')

const confirmPassword = By.css('input[placeholder="Repeat your password"]')

const submitButton = By.css('button.auth-submit')

// ========================================
// HELPER: VISIBLE ELEMENT
// ========================================

async function visible(driver, locator) {
  const element = await driver.wait(until.elementLocated(locator), TIMEOUT)

  await driver.wait(until.elementIsVisible(element), TIMEOUT)

  return element
}

// ========================================
// HELPER: SELECT QUASAR DROPDOWN
// ========================================

async function selectDropdown(driver, index) {
  const selects = await driver.wait(
    async () => {
      const elements = await driver.findElements(By.css('form .q-select'))

      return elements.length > index ? elements : false
    },
    TIMEOUT,
    `Dropdown ${index} not found`,
  )

  const field = selects[index]

  await driver.executeScript('arguments[0].scrollIntoView({block:"center"})', field)

  await field.click()

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
    `No options available for dropdown ${index}`,
  )

  const selectedText = await option.getText()

  await option.click()

  console.log(`Selected: ${selectedText}`)

  return selectedText
}

// ========================================
// MAIN TEST SUITE
// ========================================

describe('E2E: Registration → Dashboard → Add Income', function () {
  this.timeout(120000)

  let driver

  beforeEach(async function () {
    assert.ok(PASSWORD, 'Set TEST_REGISTER_PASSWORD before running')

    const options = new chrome.Options().windowSize({ width: 1440, height: 900 })

    driver = await new Builder().forBrowser('chrome').setChromeOptions(options).build()
  })

  afterEach(async function () {
    if (driver) await driver.quit()
  })

  it('registers a user and saves an income transaction', async function () {
    // ==================================
    // STEP 1: OPEN REGISTRATION PAGE
    // ==================================

    console.log('STEP 1: Opening registration')

    await driver.get(REGISTER_URL)

    await visible(driver, registerEmail)

    // ==================================
    // STEP 2: FILL REGISTRATION FORM
    // ==================================

    console.log('STEP 2: Filling registration')

    await driver.findElement(registerEmail).sendKeys(EMAIL)

    await driver.findElement(registerPassword).sendKeys(PASSWORD)

    await driver.findElement(confirmPassword).sendKeys(PASSWORD)

    // ==================================
    // STEP 3: REGISTER
    // ==================================

    console.log('STEP 3: Registering account')

    await driver.findElement(submitButton).click()

    // ==================================
    // STEP 4: VERIFY DASHBOARD
    // ==================================

    console.log('STEP 4: Waiting for dashboard')

    await driver.wait(
      until.urlContains('/dashboard'),
      TIMEOUT,
      'Registration did not reach dashboard',
    )

    assert.match(await driver.getCurrentUrl(), /\/dashboard/)

    console.log('Dashboard loaded')

    // ==================================
    // STEP 5: NAVIGATE TO ADD INCOME
    // ==================================

    console.log('STEP 5: Opening Add Income')

    await driver.get(ADD_INCOME_URL)

    await driver.wait(until.urlContains('/dashboard/add-income'), TIMEOUT)

    // ==================================
    // STEP 6: ENTER AMOUNT
    // ==================================

    console.log('STEP 6: Entering amount')

    const amountInput = await visible(driver, By.css('form .q-input input'))

    await amountInput.clear()
    await amountInput.sendKeys(AMOUNT)

    assert.equal(await amountInput.getAttribute('value'), AMOUNT)

    // ==================================
    // STEP 7: SELECT CATEGORY
    // ==================================

    console.log('STEP 7: Selecting income category')

    const category = await selectDropdown(driver, 0)

    assert.ok(category)

    // ==================================
    // STEP 8: SELECT ACCOUNT
    // ==================================

    console.log('STEP 8: Selecting account')

    const account = await selectDropdown(driver, 1)

    assert.ok(account)

    // ==================================
    // STEP 9: ENTER NOTE
    // ==================================

    console.log('STEP 9: Entering note')

    const noteInput = await visible(driver, By.css('form textarea'))

    await noteInput.sendKeys(NOTE)

    // ==================================
    // STEP 10: SAVE INCOME
    // ==================================

    console.log('STEP 10: Saving income')

    const saveButton = await visible(driver, By.css('form button[type="submit"]'))

    await saveButton.click()

    // ==================================
    // STEP 11: VERIFY SUCCESS
    // ==================================

    console.log('STEP 11: Verifying submission')

    await driver.wait(
      async () => {
        const url = await driver.getCurrentUrl()

        return url.includes('/dashboard') && !url.includes('/dashboard/add-income')
      },
      TIMEOUT,
      'Income form did not navigate away',
    )

    console.log('E2E TEST PASSED')
    console.log(`Amount: ${AMOUNT}`)
    console.log(`Category: ${category}`)
    console.log(`Account: ${account}`)
    console.log(`Note: ${NOTE}`)
  })
})
