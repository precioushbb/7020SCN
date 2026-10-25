import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSettingsStore } from '/src/stores/settingsStore'

const { mockDarkSet, mockDateFormat, mockLocale } = vi.hoisted(() => ({
  mockDarkSet: vi.fn(),
  mockDateFormat: vi.fn(),
  mockLocale: { value: 'bn' },
}))

vi.mock('quasar', () => ({
  Dark: { set: mockDarkSet },
  date: { formatDate: mockDateFormat },
}))

vi.mock('/src/i18n', () => ({
  default: {
    global: {
      locale: mockLocale,
    },
  },
}))

const createLocalStorageMock = () => {
  const values = new Map()

  return {
    getItem: vi.fn((key) => (values.has(key) ? values.get(key) : null)),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
  }
}

describe('useSettingsStore', () => {
  let store
  let storage

  beforeEach(() => {
    setActivePinia(createPinia())
    storage = createLocalStorageMock()
    vi.stubGlobal('localStorage', storage)
    mockLocale.value = 'bn'
    mockDarkSet.mockReset()
    mockDateFormat.mockReset()
    mockDateFormat.mockImplementation((_date, format, options) => {
      return options ? '২১ অক্টোবর, ২০২৬' : '21 Oct, 2026'
    })

    store = useSettingsStore()
  })

  it('TC-100: initialises the default settings', () => {
    expect(store.currency).toBe('£')
    expect(store.currencyCode).toBe('GBP')
    expect(store.language).toBe('en')
    expect(store.fontFamily).toBe('Tiro Bangla')
    expect(store.dateFormat).toBe('DD MMM, YYYY')
    expect(store.timezone).toBe('Europe/London')
    expect(store.darkMode).toBe(false)
    expect(store.appLock).toBe(false)
    expect(store.isAuthenticated).toBe(false)

    expect(store.balanceEmojis.negative.emoji).toBe('😭')
    expect(store.balanceEmojis.low.emoji).toBe('😟')
    expect(store.balanceEmojis.high.emoji).toBe('🤩')
  })

  it('TC-101: loads saved settings from localStorage', () => {
    storage.setItem(
      'finance_settings',
      JSON.stringify({
        currency: '$',
        currencyCode: 'USD',
        language: 'en',
        fontFamily: 'Arial',
        dateFormat: 'YYYY-MM-DD',
        timezone: 'Europe/London',
        darkMode: true,
        balanceEmojis: {
          negative: { emoji: '🙁', threshold: 0 },
          low: { emoji: '😐', threshold: 100 },
          high: { emoji: '😀' },
        },
      }),
    )

    // Recreate the store so its setup function reads the saved values.
    setActivePinia(createPinia())
    store = useSettingsStore()

    expect(store.currency).toBe('$')
    expect(store.currencyCode).toBe('USD')
    expect(store.language).toBe('en')
    expect(store.fontFamily).toBe('Arial')
    expect(store.dateFormat).toBe('YYYY-MM-DD')
    expect(store.timezone).toBe('Europe/London')
    expect(store.darkMode).toBe(true)
    expect(mockDarkSet).toHaveBeenCalledWith(true)
    expect(mockLocale.value).toBe('en')
  })

  it('TC-102: ignores invalid saved settings JSON', () => {
    storage.setItem('finance_settings', '{invalid json')

    expect(() => {
      setActivePinia(createPinia())
      store = useSettingsStore()
    }).not.toThrow()

    expect(store.currency).toBe('£')
  })

  it('TC-103: saves setting changes to localStorage', () => {
    store.setCurrency('$', 'USD')
    store.setLanguage('en')
    store.setFont('Arial')
    store.setDateFormat('YYYY-MM-DD')
    store.setTimezone('Europe/London')

    const saved = JSON.parse(storage.getItem('finance_settings'))

    expect(saved).toMatchObject({
      currency: '$',
      currencyCode: 'USD',
      language: 'en',
      fontFamily: 'Arial',
      dateFormat: 'YYYY-MM-DD',
      timezone: 'Europe/London',
    })
    expect(mockLocale.value).toBe('en')
  })

  it('TC-104: toggles dark mode and persists it', () => {
    store.toggleDarkMode()

    expect(store.darkMode).toBe(true)
    expect(mockDarkSet).toHaveBeenCalledWith(true)
    expect(JSON.parse(storage.getItem('finance_settings')).darkMode).toBe(true)

    store.setDarkMode(false)

    expect(store.darkMode).toBe(false)
    expect(mockDarkSet).toHaveBeenLastCalledWith(false)
  })

  it('TC-105: updates the balance emoji configuration and saves it', () => {
    const emojis = {
      negative: { emoji: '😭', threshold: 0 },
      low: { emoji: '😟', threshold: 500 },
      high: { emoji: '🤩' },
    }

    store.setBalanceEmojis(emojis)

    expect(store.balanceEmojis).toEqual(emojis)
    expect(JSON.parse(storage.getItem('finance_settings')).balanceEmojis).toEqual(emojis)
  })

  it('TC-106: converts English digits to Bengali numerals and preserves empty values', () => {
    expect(store.toBengaliNumerals('0123456789')).toBe('০১২৩৪৫৬৭৮৯')
    expect(store.toBengaliNumerals('Balance 2026')).toBe('Balance ২০২৬')
    expect(store.toBengaliNumerals('')).toBe('')
    expect(store.toBengaliNumerals(null)).toBe(null)
  })

  it('TC-107: formats numbers with Bengali numerals when the language is Bengali', () => {
    store.setLanguage('bn')

    expect(store.formatNumber(1234567)).toBe('১,২৩৪,৫৬৭')
    expect(store.formatNumber(null)).toBe('')
    expect(store.formatNumber(undefined)).toBe('')
    expect(store.formatNumber('not a number')).toBe('not a number')
  })

  it('TC-108: formats numbers with English numerals when the language is English', () => {
    store.setLanguage('en')

    expect(store.formatNumber(1234567)).toBe('1,234,567')
    expect(store.formatNumber(0)).toBe('0')
  })

  it('TC-112: returns an empty string for an empty date and the original value for an invalid date', () => {
    expect(store.formatDate('')).toBe('')
    expect(store.formatDate('not-a-date')).toBe('not-a-date')
  })

  it('TC-113: sets a PIN as a SHA-256 hash without exposing the hash in the store return value', async () => {
    await store.setPin('1234')

    expect(store.appLock).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith(
      'finance_pin',
      expect.stringMatching(/^[0-9a-f]{64}$/),
    )
    expect(Object.keys(store)).not.toContain('_pinHash')
    expect(Object.keys(store)).not.toContain('pinHash')
  })

  it('TC-114: verifies the correct PIN and rejects an incorrect PIN', async () => {
    await store.setPin('2468')

    await expect(store.verifyPin('2468')).resolves.toBe(true)
    await expect(store.verifyPin('9999')).resolves.toBe(false)
  })

  it('TC-115: removes the saved PIN and resets lock and authentication state', async () => {
    await store.setPin('1234')
    store.authenticate()

    store.removePin()

    expect(store.appLock).toBe(false)
    expect(store.isAuthenticated).toBe(false)
    expect(storage.removeItem).toHaveBeenCalledWith('finance_pin')
    await expect(store.verifyPin('1234')).resolves.toBe(false)
  })

  it('TC-116: authenticates and locks the app', () => {
    store.authenticate()
    expect(store.isAuthenticated).toBe(true)

    store.lock()
    expect(store.isAuthenticated).toBe(false)
  })

  it('TC-117: loads an existing 64-character hashed PIN', () => {
    const pinHash = 'a'.repeat(64)
    storage.setItem('finance_pin', pinHash)

    setActivePinia(createPinia())
    store = useSettingsStore()

    expect(store.appLock).toBe(true)
    expect(store.verifyPin).toBeDefined()
  })

  it('TC-118: migrates a legacy plaintext PIN to a SHA-256 hash', async () => {
    storage.setItem('finance_pin', '1234')

    setActivePinia(createPinia())
    store = useSettingsStore()

    // The migration is asynchronous.
    await vi.waitFor(() => {
      expect(storage.setItem).toHaveBeenCalledWith(
        'finance_pin',
        expect.stringMatching(/^[0-9a-f]{64}$/),
      )
    })

    expect(store.appLock).toBe(true)
    await expect(store.verifyPin('1234')).resolves.toBe(true)
  })
})
