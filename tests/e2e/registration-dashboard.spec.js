import assert from 'node:assert/strict'
import { describe, it, beforeEach, afterEach } from 'mocha'
import { Builder, By, until } from 'selenium-webdriver'

const BASE_URL = (process.env.TEST_BASE_URL || 'http://localhost:9000').replace(/\/$/, '')
const REGISTER_URL = `${BASE_URL}/#/register`
const TIMEOUT = 15000

const emailInput = By.css('input[autocomplete="email"]')
const passwordInput = By.css('input[placeholder="Min 8 chars, 1 uppercase, 1 number"]')
const confirmInput = By.css('input[placeholder="Repeat your password"]')
const submitButton = By.css('button.auth-submit')

async function fillForm(driver, { email = '', password = '', confirm = '' } = {}) {
  await driver.get(REGISTER_URL)
  await driver.wait(until.elementLocated(emailInput), TIMEOUT)
  if (email) await driver.findElement(emailInput).sendKeys(email)
  if (password) await driver.findElement(passwordInput).sendKeys(password)
  if (confirm) await driver.findElement(confirmInput).sendKeys(confirm)
}

async function submit(driver) {
  await driver.findElement(submitButton).click()
}

async function errorMessages(driver) {
  return Promise.all((await driver.findElements(By.css('.auth-error'))).map((el) => el.getText()))
}

async function expectValidation(driver, message) {
  await driver.wait(async () => (await errorMessages(driver)).includes(message), TIMEOUT)
  assert.ok((await errorMessages(driver)).includes(message))
  assert.ok((await driver.getCurrentUrl()).includes('/#/register'))
}

describe('Registration to dashboard (Selenium E2E)', function () {
  this.timeout(60000)
  let driver

  beforeEach(async function () {
    driver = await new Builder().forBrowser('chrome').build()
  })

  afterEach(async function () {
    if (driver) await driver.quit()
  })

  it('displays the registration form', async function () {
    await driver.get(REGISTER_URL)
    const heading = await driver.wait(until.elementLocated(By.css('h1.auth-card__title')), TIMEOUT)
    assert.equal(await heading.getText(), 'Create your account')
    assert.equal(await driver.findElement(submitButton).getText(), 'Create Free Account')
    assert.equal((await driver.findElements(By.css('input.auth-input'))).length, 3)
  })

  it('rejects an empty registration form', async function () {
    await fillForm(driver)
    await submit(driver)
    await expectValidation(driver, 'Email is required')
    await expectValidation(driver, 'Password is required')
    await expectValidation(driver, 'Please confirm your password')
  })

  it('rejects a malformed email address', async function () {
    await fillForm(driver, {
      email: 'not-an-email',
      password: 'SecurePass1',
      confirm: 'SecurePass1',
    })
    await submit(driver)
    await expectValidation(driver, 'Enter a valid email address')
  })

  it('rejects a password shorter than eight characters', async function () {
    await fillForm(driver, { email: 'test@example.com', password: 'Short1', confirm: 'Short1' })
    await submit(driver)
    await expectValidation(driver, 'At least 8 characters required')
  })

  it('requires at least one number in the password', async function () {
    await fillForm(driver, {
      email: 'test@example.com',
      password: 'SecurePass',
      confirm: 'SecurePass',
    })
    await submit(driver)
    await expectValidation(driver, 'Must include at least one number')
  })

  it('requires at least one uppercase letter in the password', async function () {
    await fillForm(driver, {
      email: 'test@example.com',
      password: 'securepass1',
      confirm: 'securepass1',
    })
    await submit(driver)
    await expectValidation(driver, 'Must include at least one uppercase letter')
  })

  it('rejects passwords that do not match', async function () {
    await fillForm(driver, {
      email: 'test@example.com',
      password: 'SecurePass1',
      confirm: 'DifferentPass1',
    })
    await submit(driver)
    await expectValidation(driver, 'Passwords do not match')
  })

  it('shows and hides the password when toggled', async function () {
    await fillForm(driver, { password: 'SecurePass1' })
    const password = driver.findElement(passwordInput)
    const toggle = driver.findElement(By.css('button.auth-input-toggle'))
    assert.equal(await password.getAttribute('type'), 'password')
    await toggle.click()
    assert.equal(await password.getAttribute('type'), 'text')
    await toggle.click()
    assert.equal(await password.getAttribute('type'), 'password')
  })

  it('provides a link to the sign-in page', async function () {
    await driver.get(REGISTER_URL)
    await driver.wait(until.elementLocated(By.css('.auth-card__footer-link')), TIMEOUT)
    await driver.findElement(By.css('.auth-card__footer-link')).click()
    await driver.wait(until.urlContains('/#/login'), TIMEOUT)
  })

  it('registers a new test account and opens the dashboard', async function () {
    if (process.env.RUN_REGISTRATION_E2E !== '1') this.skip()
    const email = process.env.TEST_REGISTER_EMAIL
    const password = process.env.TEST_REGISTER_PASSWORD
    if (!email || !password) this.skip()

    await fillForm(driver, { email, password, confirm: password })
    await submit(driver)
    await driver.wait(until.urlContains('/#/dashboard'), TIMEOUT)
    assert.ok((await driver.getCurrentUrl()).includes('/#/dashboard'))
  })

  it('shows a Firebase error when registering an existing email', async function () {
    if (process.env.RUN_REGISTRATION_E2E !== '1') this.skip()
    const email = process.env.TEST_EXISTING_EMAIL
    const password = process.env.TEST_REGISTER_PASSWORD
    if (!email || !password) this.skip()

    await fillForm(driver, { email, password, confirm: password })
    await submit(driver)
    const error = await driver.wait(until.elementLocated(By.css('.auth-server-error')), TIMEOUT)
    assert.ok((await error.getText()).trim().length > 0)
    assert.ok((await driver.getCurrentUrl()).includes('/#/register'))
  })
})
