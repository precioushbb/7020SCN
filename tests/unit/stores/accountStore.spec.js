import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createPinia, setActivePinia } from 'pinia'

import { useAccountStore } from '/src/stores/accountStore'

// Mock Firebase methods

const {
  mockCollection,

  mockDoc,

  mockOnSnapshot,

  mockAddDoc,

  mockUpdateDoc,

  mockDeleteDoc,

  mockAuth,

  mockFirestore,
} = vi.hoisted(() => ({
  mockCollection: vi.fn(),

  mockDoc: vi.fn(),

  mockOnSnapshot: vi.fn(),

  mockAddDoc: vi.fn(),

  mockUpdateDoc: vi.fn(),

  mockDeleteDoc: vi.fn(),

  mockAuth: { currentUser: { uid: 'user123' } },

  mockFirestore: {},
}))

vi.mock('/src/boot/firebase', () => ({
  auth: mockAuth,

  firestore: mockFirestore,
}))

vi.mock('firebase/firestore', () => ({
  collection: mockCollection,

  doc: mockDoc,

  onSnapshot: mockOnSnapshot,

  addDoc: mockAddDoc,

  updateDoc: mockUpdateDoc,

  deleteDoc: mockDeleteDoc,
}))

describe('useAccountStore', () => {
  let store

  let mockAccountsRef

  const sampleAccounts = [
    {
      id: 'account1',

      name: 'Savings',

      type: 'savings',

      balance: 1000,

      icon: 'savings',

      color: '#00AA00',
    },

    {
      id: 'account2',

      name: 'Current',

      type: 'current',

      balance: 500,

      icon: 'wallet',

      color: '#0000FF',
    },
  ]

  // Simulate a Firestore snapshot

  const createSnapshot = (accounts) => ({
    docs: accounts.map(({ id, ...data }) => ({
      id,

      data: () => data,
    })),
  })

  beforeEach(() => {
    setActivePinia(createPinia())

    vi.clearAllMocks()

    mockAuth.currentUser = { uid: 'user123' }

    mockAccountsRef = { path: 'users/user123/accounts' }

    mockCollection.mockReturnValue(mockAccountsRef)

    mockDoc.mockImplementation((db, path) => ({ path }))

    mockAddDoc.mockResolvedValue({ id: 'newAccount123' })

    mockUpdateDoc.mockResolvedValue(undefined)

    mockDeleteDoc.mockResolvedValue(undefined)

    // By default, return an unsubscribe function.

    mockOnSnapshot.mockImplementation(() => vi.fn())

    store = useAccountStore()
  })

  describe('initial state', () => {
    it('UT-01: initialises with an empty accounts array', () => {
      expect(store.accounts).toEqual([])
    })

    it('UT-02: initialises loading as false', () => {
      expect(store.loading).toBe(false)
    })

    it('UT-03: initialises totalBalance as zero', () => {
      expect(store.totalBalance).toBe(0)
    })
  })

  describe('totalBalance', () => {
    it('UT-04: calculates the total balance of all accounts', () => {
      store.accounts = sampleAccounts

      expect(store.totalBalance).toBe(1500)
    })

    it('UT-05: treats missing or zero balances as zero', () => {
      store.accounts = [{ id: '1', balance: 100 }, { id: '2' }, { id: '3', balance: 0 }]

      expect(store.totalBalance).toBe(100)
    })

    it('UT-06: updates when an account balance changes', () => {
      store.accounts = sampleAccounts

      store.accounts[0].balance = 2000

      expect(store.totalBalance).toBe(2500)
    })
  })

  describe('getUserAccountsRef behaviour', () => {
    it('UT-07: uses the authenticated user account collection', () => {
      store.listenAccounts()

      expect(mockCollection).toHaveBeenCalledWith(mockFirestore, 'users/user123/accounts')
    })

    it('UT-08: does not listen when the user is unauthenticated', () => {
      mockAuth.currentUser = null

      store.listenAccounts()

      expect(mockCollection).not.toHaveBeenCalled()

      expect(mockOnSnapshot).not.toHaveBeenCalled()

      expect(store.loading).toBe(false)
    })
  })

  describe('listenAccounts', () => {
    it('UT-09: subscribes to Firestore and loads accounts', () => {
      mockOnSnapshot.mockImplementation((ref, onSuccess) => {
        onSuccess(createSnapshot(sampleAccounts))

        return vi.fn()
      })

      store.listenAccounts()

      expect(mockOnSnapshot).toHaveBeenCalledWith(
        mockAccountsRef,

        expect.any(Function),

        expect.any(Function),
      )

      expect(store.accounts).toEqual(sampleAccounts)

      expect(store.loading).toBe(false)
    })

    it('UT-10: sets loading to true while waiting for the snapshot', () => {
      store.listenAccounts()

      expect(store.loading).toBe(true)
    })

    it('UT-11: sets loading to false when Firestore returns an error', () => {
      const error = new Error('Firestore error')

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockOnSnapshot.mockImplementation((ref, onSuccess, onError) => {
        onError(error)

        return vi.fn()
      })

      store.listenAccounts()

      expect(consoleSpy).toHaveBeenCalledWith('Error fetching accounts:', error)

      expect(store.loading).toBe(false)

      consoleSpy.mockRestore()
    })

    it('UT-12: unsubscribes from the previous listener before listening again', () => {
      const unsubscribe = vi.fn()

      mockOnSnapshot.mockReturnValue(unsubscribe)

      store.listenAccounts()

      store.listenAccounts()

      expect(unsubscribe).toHaveBeenCalledOnce()

      expect(mockOnSnapshot).toHaveBeenCalledTimes(2)
    })
  })

  describe('fetchAccounts', () => {
    it('UT-13: resolves without fetching when the user is unauthenticated', async () => {
      mockAuth.currentUser = null

      await expect(store.fetchAccounts()).resolves.toBeUndefined()

      expect(mockOnSnapshot).not.toHaveBeenCalled()

      expect(store.loading).toBe(false)
    })

    it('UT-14: resolves and clears loading when the snapshot fails', async () => {
      const error = new Error('Unable to fetch accounts')

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockOnSnapshot.mockImplementation((ref, onSuccess, onError) => {
        onError(error)

        return vi.fn()
      })

      await expect(store.fetchAccounts()).resolves.toBeUndefined()

      expect(store.loading).toBe(false)

      expect(consoleSpy).toHaveBeenCalledWith('Error fetching accounts:', error)

      consoleSpy.mockRestore()
    })
  })

  describe('addAccount', () => {
    it('UT-15: uses default values when optional fields are missing', async () => {
      await store.addAccount({
        name: 'Cash',

        type: 'cash',
      })

      expect(store.accounts[0]).toMatchObject({
        name: 'Cash',

        type: 'cash',

        balance: 0,

        icon: 'account_balance_wallet',

        color: '#111111',
      })
    })

    it('UT-16: replaces the temporary ID after Firestore successfully adds the account', async () => {
      mockAddDoc.mockResolvedValue({ id: 'saved123' })

      await store.addAccount({
        name: 'Savings',

        type: 'savings',

        balance: 100,
      })

      // addAccount does not await the Firestore promise chain.

      await Promise.resolve()

      await Promise.resolve()

      expect(store.accounts[0].id).toBe('saved123')
    })

    it('UT-17: does not add an account when the user is unauthenticated', async () => {
      mockAuth.currentUser = null

      await store.addAccount({
        name: 'Savings',

        type: 'savings',

        balance: 100,
      })

      expect(store.accounts).toEqual([])

      expect(mockAddDoc).not.toHaveBeenCalled()
    })

    it('UT-18: handles a failed Firestore write without removing the optimistic account', async () => {
      const error = new Error('Write failed')

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      mockAddDoc.mockRejectedValue(error)

      await store.addAccount({
        name: 'Savings',

        type: 'savings',

        balance: 100,
      })

      await Promise.resolve()

      await Promise.resolve()

      expect(store.accounts).toHaveLength(1)

      expect(store.accounts[0].id).toMatch(/^temp_/)

      expect(consoleSpy).toHaveBeenCalledWith('[Firestore] Account write queued:', error)

      consoleSpy.mockRestore()
    })
  })

  describe('updateAccount', () => {
    beforeEach(() => {
      store.accounts = sampleAccounts.map((account) => ({ ...account }))
    })

    it('UT-19: updates account details optimistically', async () => {
      await store.updateAccount('account1', {
        name: 'Updated Savings',

        balance: 2000,
      })

      expect(store.accounts[0]).toMatchObject({
        id: 'account1',

        name: 'Updated Savings',

        balance: 2000,
      })
    })

    it('UT-20: persists account changes to Firestore', async () => {
      const changes = { name: 'Updated Savings' }

      await store.updateAccount('account1', changes)

      expect(mockDoc).toHaveBeenCalledWith(mockFirestore, 'users/user123/accounts/account1')

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        { path: 'users/user123/accounts/account1' },

        changes,
      )
    })

    it('UT-21: does not update Firestore when the user is unauthenticated', async () => {
      mockAuth.currentUser = null

      await store.updateAccount('account1', {
        name: 'Updated Savings',
      })

      expect(store.accounts[0].name).toBe('Savings')

      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })
  })

  describe('updateBalance', () => {
    beforeEach(() => {
      store.accounts = sampleAccounts.map((account) => ({ ...account }))
    })

    it('UT-22: increases an account balance by the supplied amount', async () => {
      // Arrange: Set initial balance

      store.accounts = [
        {
          id: 'account1',

          balance: 1000,
        },
      ]

      // Act: Increase balance by 500

      await store.updateBalance('account1', 500)

      // Assert: Verify updated balance

      expect(store.accounts[0].balance).toBe(1500)
    })

    it('UT-23: decreases an account balance when given a negative amount', async () => {
      // Arrange

      store.accounts = [{ id: 'account1', balance: 1000 }]

      mockUpdateDoc.mockResolvedValue(undefined)

      // Act

      await store.updateBalance('account1', -200)

      // Assert

      expect(store.accounts[0].balance).toBe(800)
    })

    it('UT-24: persists the updated balance to Firestore', async () => {
      // Set the initial account balance

      store.accounts = [
        {
          id: 'account1',

          balance: 1000,
        },
      ]

      mockUpdateDoc.mockResolvedValue(undefined)

      mockUpdateDoc.mockClear()

      // Update balance by 300

      await store.updateBalance('account1', 300)

      // Verify Firestore receives the correct updated balance

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        { path: 'users/user123/accounts/account1' },

        { balance: 1300 },
      )

      // Verify optimistic Pinia state update

      expect(store.accounts[0].balance).toBe(1300)
    })

    it('UT-25: does nothing if the account does not exist', async () => {
      await store.updateBalance('unknown', 500)

      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })

    it('UT-26: does nothing if the user is unauthenticated', async () => {
      mockAuth.currentUser = null

      store.accounts = [{ id: 'account1', balance: 1000 }]

      mockUpdateDoc.mockClear()

      await store.updateBalance('account1', 500)

      expect(store.accounts[0].balance).toBe(1000)

      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })
  })

  describe('deleteAccount', () => {
    beforeEach(() => {
      store.accounts = sampleAccounts.map((account) => ({ ...account }))
    })

    it('UT-27: removes an account optimistically', async () => {
      await store.deleteAccount('account1')

      expect(store.accounts).toHaveLength(1)

      expect(store.accounts[0].id).toBe('account2')
    })

    it('UT-28: deletes the account from Firestore', async () => {
      await store.deleteAccount('account1')

      expect(mockDoc).toHaveBeenCalledWith(mockFirestore, 'users/user123/accounts/account1')

      expect(mockDeleteDoc).toHaveBeenCalledWith({
        path: 'users/user123/accounts/account1',
      })
    })

    it('UT-29: does not delete when the user is unauthenticated', async () => {
      mockAuth.currentUser = null

      await store.deleteAccount('account1')

      expect(store.accounts).toHaveLength(2)

      expect(mockDeleteDoc).not.toHaveBeenCalled()
    })
  })

  describe('stopListening', () => {
    it('UT-30: unsubscribes from the active Firestore listener', () => {
      const unsubscribe = vi.fn()

      mockOnSnapshot.mockReturnValue(unsubscribe)

      store.listenAccounts()

      store.stopListening()

      expect(unsubscribe).toHaveBeenCalledOnce()
    })

    it('UT-31: does not throw when no listener exists', () => {
      expect(() => store.stopListening()).not.toThrow()
    })

    it('UT-32: does not unsubscribe twice after stopping the listener', () => {
      const unsubscribe = vi.fn()

      mockOnSnapshot.mockReturnValue(unsubscribe)

      store.listenAccounts()

      store.stopListening()

      store.stopListening()

      expect(unsubscribe).toHaveBeenCalledOnce()
    })
  })

  it('UT-33: restores the original balance when Firestore rejects the update', async () => {
    // Arrange

    store.accounts = [{ id: 'account1', balance: 1000 }]

    mockUpdateDoc.mockRejectedValueOnce(new Error('Permission denied'))

    // Act

    await store.updateBalance('account1', 500)

    await vi.waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled()
    })

    // Assert

    expect(store.accounts[0].balance).toBe(1000)
  })

  it('UT-34: rejects non-numeric amounts without changing the account balance', async () => {
    // Arrange

    store.accounts = [{ id: 'account1', balance: 1000 }]

    mockUpdateDoc.mockClear()

    // Act

    await store.updateBalance('account1', 'invalid')

    // Assert

    expect(store.accounts[0].balance).toBe(1000)

    expect(mockUpdateDoc).not.toHaveBeenCalled()
  })
})
