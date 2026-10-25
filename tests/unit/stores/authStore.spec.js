import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  register: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn(),
  updatePassword: vi.fn(),
  reauthenticate: vi.fn(),
  credential: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(),
  updateDoc: vi.fn(),
  collection: vi.fn(),
  addDoc: vi.fn(),
  auth: {},
  firestore: {},
}))

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: mocks.signIn,
  createUserWithEmailAndPassword: mocks.register,
  signOut: mocks.signOut,
  onAuthStateChanged: mocks.onAuthStateChanged,
  updatePassword: mocks.updatePassword,
  reauthenticateWithCredential: mocks.reauthenticate,
  EmailAuthProvider: {
    credential: mocks.credential,
  },
}))

vi.mock('firebase/firestore', () => ({
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  setDoc: mocks.setDoc,
  updateDoc: mocks.updateDoc,
  collection: mocks.collection,
  addDoc: mocks.addDoc,
}))

vi.mock('/src/boot/firebase', () => ({
  auth: mocks.auth,
  firestore: mocks.firestore,
}))

const firebaseUser = {
  uid: 'user-123',
  email: 'test@example.com',
}

const profile = {
  uid: 'user-123',
  name: 'Test User',
  avatar: null,
}

let authCallback

// Import a fresh authStore module for each test.
// This also resets its module-level rate-limit state.
async function createStore() {
  const { useAuthStore } = await import('../../../src/stores/authStore.js')

  setActivePinia(createPinia())

  return useAuthStore()
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()

  mocks.onAuthStateChanged.mockImplementation((_auth, callback) => {
    authCallback = callback
    return vi.fn()
  })

  mocks.doc.mockImplementation((_db, ...parts) => ({
    path: parts.join('/'),
  }))

  mocks.collection.mockImplementation((_db, path) => ({
    path,
  }))

  mocks.getDoc.mockResolvedValue({
    exists: () => true,
    data: () => profile,
  })

  mocks.setDoc.mockResolvedValue(undefined)
  mocks.updateDoc.mockResolvedValue(undefined)
  mocks.addDoc.mockResolvedValue({ id: 'new-doc' })
  mocks.signOut.mockResolvedValue(undefined)
  mocks.credential.mockReturnValue({
    mockCredential: true,
  })
  mocks.reauthenticate.mockResolvedValue(undefined)
  mocks.updatePassword.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useAuthStore', () => {
  it('UT-35: starts signed out and waits for Firebase authentication state', async () => {
    const store = await createStore()

    expect(store.user).toBeNull()
    expect(store.userProfile).toBeNull()
    expect(store.isAuthenticated).toBe(false)
    expect(store.isAuthReady).toBe(false)

    expect(mocks.onAuthStateChanged).toHaveBeenCalledWith(mocks.auth, expect.any(Function))

    authCallback(null)
    await store.waitForAuth()

    expect(store.isAuthReady).toBe(true)
    expect(store.isAuthenticated).toBe(false)
  })

  it('UT-36: registration reports failure when essential provisioning fails', async () => {
    mocks.register.mockResolvedValue({
      user: firebaseUser,
    })

    mocks.setDoc.mockRejectedValueOnce(new Error('Firestore permission denied'))

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const store = await createStore()

    const result = await store.register(firebaseUser.email, 'SecurePassword123!')

    // Wait until the background provisioning failure
    // has actually been handled.
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith('Error setting up new user data:', expect.any(Error))
    })

    expect(mocks.register).toHaveBeenCalledWith(
      mocks.auth,
      firebaseUser.email,
      'SecurePassword123!',
    )

    // Reliability requirement:
    // Registration must not report complete success
    // if essential user provisioning has failed.
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('UT-37: logs in, updates auth state and fetches the profile', async () => {
    mocks.signIn.mockResolvedValue({
      user: firebaseUser,
    })

    const store = await createStore()

    expect(await store.login(firebaseUser.email, 'correct-password')).toEqual({ success: true })

    expect(mocks.signIn).toHaveBeenCalledWith(mocks.auth, firebaseUser.email, 'correct-password')

    expect(store.user).toEqual(firebaseUser)
    expect(store.isAuthenticated).toBe(true)
    expect(store.userProfile).toEqual(profile)
  })

  it('UT-38: sanitises Firebase login errors', async () => {
    mocks.signIn.mockRejectedValue({
      code: 'auth/invalid-credential',
    })

    const store = await createStore()

    const result = await store.login(firebaseUser.email, 'wrong')

    expect(result.success).toBe(false)

    expect(result.error).toBe('ইমেইল বা পাসওয়ার্ড সঠিক নয়।')

    expect(result.error).not.toContain('auth/')
  })

  it('UT-39: rejects profile updates while signed out', async () => {
    const store = await createStore()

    expect(
      await store.updateUserProfile({
        name: 'New',
      }),
    ).toEqual({
      success: false,
      error: 'Not authenticated',
    })

    expect(mocks.updateDoc).not.toHaveBeenCalled()
  })

  it('UT-40: registers a user and completes essential provisioning', async () => {
    mocks.register.mockResolvedValue({
      user: firebaseUser,
    })

    mocks.setDoc.mockResolvedValue(undefined)
    mocks.addDoc.mockResolvedValue({ id: 'new-doc' })

    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => profile,
    })

    const store = await createStore()

    const result = await store.register(firebaseUser.email, 'password123')

    // Registration and provisioning should succeed
    expect(result).toEqual({ success: true })

    expect(store.isAuthenticated).toBe(true)
    expect(store.user).toEqual(firebaseUser)

    // Verify user profile creation
    expect(mocks.setDoc).toHaveBeenCalledWith(
      { path: 'users/user-123' },
      expect.objectContaining({
        uid: 'user-123',
        email: 'test@example.com',
      }),
    )

    // Verify default accounts and categories
    const accountCalls = mocks.addDoc.mock.calls.filter(([ref]) => ref.path.endsWith('/accounts'))

    const categoryCalls = mocks.addDoc.mock.calls.filter(([ref]) =>
      ref.path.endsWith('/categories'),
    )

    expect(accountCalls).toHaveLength(2)
    expect(categoryCalls).toHaveLength(8)

    expect(mocks.getDoc).toHaveBeenCalled()
  })

  it('UT-41: logs out and clears authentication state', async () => {
    const store = await createStore()

    authCallback(firebaseUser)
    await flush()

    expect(await store.logout()).toEqual({
      success: true,
    })

    expect(mocks.signOut).toHaveBeenCalledWith(mocks.auth)

    expect(store.user).toBeNull()
    expect(store.userProfile).toBeNull()
    expect(store.isAuthenticated).toBe(false)
  })

  it('UT-42: rejects password changes when signed out', async () => {
    const store = await createStore()

    expect(await store.changePassword('old', 'new')).toEqual({
      success: false,
      error: 'Not authenticated',
    })

    expect(mocks.updatePassword).not.toHaveBeenCalled()
  })
})
