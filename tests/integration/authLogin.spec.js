import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick } from 'vue'

// Shared mocks
const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  onAuthStateChanged: vi.fn(),
  getDoc: vi.fn(),
  push: vi.fn(),
  notify: vi.fn(),
  settings: { appLock: false },
}))

// Firebase mocks
vi.mock('/src/boot/firebase', () => ({
  auth: {},
  firestore: {},
}))

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: mocks.signIn,
  onAuthStateChanged: mocks.onAuthStateChanged,
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  updatePassword: vi.fn(),
  reauthenticateWithCredential: vi.fn(),
  EmailAuthProvider: { credential: vi.fn() },
}))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...segments) => segments.join('/')),
  getDoc: mocks.getDoc,
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  collection: vi.fn(),
  addDoc: vi.fn(),
}))

// Router mock
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
  RouterLink: defineComponent({
    props: ['to'],
    setup(props, { slots }) {
      return () => h('a', { href: props.to }, slots.default?.())
    },
  }),
}))

// Internationalisation and settings
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key) => key }),
}))

vi.mock('stores/settingsStore', () => ({
  useSettingsStore: () => mocks.settings,
}))

vi.mock('quasar', () => ({
  Notify: { create: mocks.notify },
}))

// Actual application modules
import LoginPage from '/src/pages/auth/LoginPage.vue'
import { useAuthStore } from '/src/stores/authStore'

// Simplified Quasar form

const QForm = defineComponent({
  emits: ['submit'],

  setup(_, { slots, emit }) {
    return () =>
      h(
        'form',
        {
          onSubmit: (event) => {
            event.preventDefault()
            emit('submit', event)
          },
        },
        slots.default?.(),
      )
  },
})

// Mount actual Login Page with real Pinia store
function renderLogin() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const wrapper = mount(LoginPage, {
    global: {
      plugins: [pinia],
      components: { QForm },
      stubs: {
        'router-link': true,
        RouterLink: true,
      },
    },
  })

  return {
    wrapper,
    auth: useAuthStore(),
  }
}

// Reusable form submission helper
async function fillAndSubmit(wrapper, email = 'user@example.com', password = 'password123') {
  await wrapper.get('input[type="email"]').setValue(email)

  await wrapper.get('input[autocomplete="current-password"]').setValue(password)

  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks()
  mocks.settings.appLock = false

  mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
    callback(null)
    return vi.fn()
  })

  mocks.getDoc.mockResolvedValue({
    exists: () => true,
    data: () => ({ name: 'Test User' }),
  })

  mocks.signIn.mockResolvedValue({
    user: {
      uid: 'user-123',
      email: 'user@example.com',
    },
  })
})

describe('Login Page + Auth Store integration', () => {
  it('INT-AUTH-01/02: authenticates, loads profile and navigates to dashboard', async () => {
    const { wrapper, auth } = renderLogin()

    await fillAndSubmit(wrapper)

    expect(mocks.signIn).toHaveBeenCalledWith(expect.anything(), 'user@example.com', 'password123')

    expect(auth.isAuthenticated).toBe(true)
    expect(auth.user.uid).toBe('user-123')
    expect(auth.userProfile.name).toBe('Test User')

    expect(mocks.push).toHaveBeenCalledWith('/dashboard')

    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ color: 'positive' }))

    wrapper.unmount()
  })

  it('INT-AUTH-03: navigates to splash when PIN lock is enabled', async () => {
    mocks.settings.appLock = true

    const { wrapper } = renderLogin()

    await fillAndSubmit(wrapper)

    expect(mocks.push).toHaveBeenCalledWith('/splash')

    wrapper.unmount()
  })

  it('INT-AUTH-04: rejects malformed email without calling Firebase', async () => {
    const { wrapper } = renderLogin()

    await fillAndSubmit(wrapper, 'invalid-email', 'password123')

    expect(wrapper.text()).toContain('Enter a valid email address')

    expect(mocks.signIn).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('INT-AUTH-05: rejects an empty password', async () => {
    const { wrapper } = renderLogin()

    await fillAndSubmit(wrapper, 'user@example.com', '')

    expect(wrapper.text()).toContain('Password is required')
    expect(mocks.signIn).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('INT-AUTH-06: shows a sanitised error for invalid credentials', async () => {
    mocks.signIn.mockRejectedValue({
      code: 'auth/invalid-credential',
    })

    const { wrapper, auth } = renderLogin()

    await fillAndSubmit(wrapper)

    expect(wrapper.find('.auth-server-error').text()).toContain('ইমেইল বা পাসওয়ার্ড সঠিক নয়।')

    expect(auth.isAuthenticated).toBe(false)
    expect(mocks.push).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('INT-AUTH-07: displays a network error without navigation', async () => {
    mocks.signIn.mockRejectedValue({
      code: 'auth/network-request-failed',
    })

    const { wrapper } = renderLogin()

    await fillAndSubmit(wrapper)

    expect(wrapper.find('.auth-server-error').text()).toContain('নেটওয়ার্ক সংযোগ ব্যর্থ হয়েছে।')

    expect(mocks.push).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('INT-AUTH-08: disables submission while login is pending', async () => {
    let resolveLogin

    mocks.signIn.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLogin = resolve
        }),
    )

    const { wrapper } = renderLogin()

    await wrapper.get('input[type="email"]').setValue('user@example.com')

    await wrapper.get('input[autocomplete="current-password"]').setValue('password123')

    await wrapper.get('form').trigger('submit')
    await nextTick()

    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()

    resolveLogin({
      user: {
        uid: 'user-123',
        email: 'user@example.com',
      },
    })

    await flushPromises()

    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()

    wrapper.unmount()
  })
})
