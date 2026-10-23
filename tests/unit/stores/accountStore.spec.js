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
    it('TC-20:initialises with an empty accounts array', () => {
      expect(store.accounts).toEqual([])
    })

    it('TC-21: initialises loading as false', () => {
      expect(store.loading).toBe(false)
    })

    it('TC-22: initialises totalBalance as zero', () => {
      expect(store.totalBalance).toBe(0)
    })
  })

  describe('totalBalance', () => {
    it('TC-23: calculates the total balance of all accounts', () => {
      store.accounts = sampleAccounts

      expect(store.totalBalance).toBe(1500)
    })

    it('TC-24: treats missing or zero balances as zero', () => {
      store.accounts = [{ id: '1', balance: 100 }, { id: '2' }, { id: '3', balance: 0 }]

      expect(store.totalBalance).toBe(100)
    })

    it('TC-25: updates when an account balance changes', () => {
      store.accounts = sampleAccounts
      store.accounts[0].balance = 2000

      expect(store.totalBalance).toBe(2500)
    })
  })

  describe('getUserAccountsRef behaviour', () => {
    it('TC-26: uses the authenticated user account collection', () => {
      store.listenAccounts()

      expect(mockCollection).toHaveBeenCalledWith(mockFirestore, 'users/user123/accounts')
    })

    it('TC-27: does not listen when the user is unauthenticated', () => {
      mockAuth.currentUser = null

      store.listenAccounts()

      expect(mockCollection).not.toHaveBeenCalled()
      expect(mockOnSnapshot).not.toHaveBeenCalled()
      expect(store.loading).toBe(false)
    })
  })

  describe('listenAccounts', () => {
    it('TC-28: subscribes to Firestore and loads accounts', () => {
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

    it('TC-29: sets loading to true while waiting for the snapshot', () => {
      store.listenAccounts()

      expect(store.loading).toBe(true)
    })

    it('TC-30: sets loading to false when Firestore returns an error', () => {
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

    it('TC-31: unsubscribes from the previous listener before listening again', () => {
      const unsubscribe = vi.fn()
      mockOnSnapshot.mockReturnValue(unsubscribe)

      store.listenAccounts()
      store.listenAccounts()

      expect(unsubscribe).toHaveBeenCalledOnce()
      expect(mockOnSnapshot).toHaveBeenCalledTimes(2)
    })
  })

  describe('fetchAccounts', () => {
    it('TC-32: fetches accounts and resolves after the snapshot arrives', async () => {
      mockOnSnapshot.mockImplementation((ref, onSuccess) => {
        onSuccess(createSnapshot(sampleAccounts))
        return vi.fn()
      })

      await store.fetchAccounts()

      expect(store.accounts).toEqual(sampleAccounts)
      expect(store.totalBalance).toBe(1500)
      expect(store.loading).toBe(false)
    })

    it('TC-33: resolves without fetching when the user is unauthenticated', async () => {
      mockAuth.currentUser = null

      await expect(store.fetchAccounts()).resolves.toBeUndefined()

      expect(mockOnSnapshot).not.toHaveBeenCalled()
      expect(store.loading).toBe(false)
    })

    it('TC-34: resolves and clears loading when the snapshot fails', async () => {
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
    it('TC-35:adds an account with the supplied details', async () => {
      const account = {
        name: 'Investment',
        type: 'investment',
        balance: 2500,
        icon: 'trending_up',
        color: '#FF0000',
      }

      await store.addAccount(account)

      expect(store.accounts).toHaveLength(1)
      expect(store.accounts[0]).toMatchObject({
        name: 'Investment',
        type: 'investment',
        balance: 2500,
        icon: 'trending_up',
        color: '#FF0000',
      })

      expect(store.accounts[0].id).toMatch(/^temp_/)
      expect(mockAddDoc).toHaveBeenCalledWith(
        mockAccountsRef,
        expect.objectContaining({
          name: 'Investment',
          type: 'investment',
          balance: 2500,
          icon: 'trending_up',
          color: '#FF0000',
          createdAt: expect.any(Number),
        }),
      )
    })

    it('TC-36:uses default values when optional fields are missing', async () => {
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

    it('TC-37: replaces the temporary ID after Firestore successfully adds the account', async () => {
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

    it('TC-38: does not add an account when the user is unauthenticated', async () => {
      mockAuth.currentUser = null

      await store.addAccount({
        name: 'Savings',
        type: 'savings',
        balance: 100,
      })

      expect(store.accounts).toEqual([])
      expect(mockAddDoc).not.toHaveBeenCalled()
    })

    it('TC-39: handles a failed Firestore write without removing the optimistic account', async () => {
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

    it('TC-40: updates account details optimistically', async () => {
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

    it('TC-41: persists account changes to Firestore', async () => {
      const changes = { name: 'Updated Savings' }

      await store.updateAccount('account1', changes)

      expect(mockDoc).toHaveBeenCalledWith(mockFirestore, 'users/user123/accounts/account1')
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        { path: 'users/user123/accounts/account1' },
        changes,
      )
    })

    it('TC-42: does not update Firestore when the user is unauthenticated', async () => {
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

    it('TC-43: increases an account balance by the supplied amount', async () => {
      await store.updateBalance('account1', 500)

      expect(store.accounts[0].balance).toBe(1500)
    })

    it('TC-44: decreases an account balance when given a negative amount', async () => {
      await store.updateBalance('account1', -200)

      expect(store.accounts[0].balance).toBe(800)
    })

    it('TC-45: persists the updated balance to Firestore', async () => {
      await store.updateBalance('account1', 300)

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        { path: 'users/user123/accounts/account1' },
        { balance: 1300 },
      )
    })

    it('TC-46: does nothing if the account does not exist', async () => {
      await store.updateBalance('unknown', 500)

      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })

    it('TC-47: does nothing if the user is unauthenticated', async () => {
      mockAuth.currentUser = null

      await store.updateBalance('account1', 500)

      expect(store.accounts[0].balance).toBe(1000)
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })

    it('TC-48: treats a missing balance and amount as zero', async () => {
      store.accounts = [{ id: 'account3' }]

      await store.updateBalance('account3', undefined)

      expect(store.accounts[0].balance).toBe(0)
    })
  })

  describe('deleteAccount', () => {
    beforeEach(() => {
      store.accounts = sampleAccounts.map((account) => ({ ...account }))
    })

    it('TC-49: removes an account optimistically', async () => {
      await store.deleteAccount('account1')

      expect(store.accounts).toHaveLength(1)
      expect(store.accounts[0].id).toBe('account2')
    })

    it('TC-50: deletes the account from Firestore', async () => {
      await store.deleteAccount('account1')

      expect(mockDoc).toHaveBeenCalledWith(mockFirestore, 'users/user123/accounts/account1')
      expect(mockDeleteDoc).toHaveBeenCalledWith({
        path: 'users/user123/accounts/account1',
      })
    })

    it('TC-51: does not delete when the user is unauthenticated', async () => {
      mockAuth.currentUser = null

      await store.deleteAccount('account1')

      expect(store.accounts).toHaveLength(2)
      expect(mockDeleteDoc).not.toHaveBeenCalled()
    })
  })

  describe('stopListening', () => {
    it('TC-52: unsubscribes from the active Firestore listener', () => {
      const unsubscribe = vi.fn()
      mockOnSnapshot.mockReturnValue(unsubscribe)

      store.listenAccounts()
      store.stopListening()

      expect(unsubscribe).toHaveBeenCalledOnce()
    })

    it('TC-53: does not throw when no listener exists', () => {
      expect(() => store.stopListening()).not.toThrow()
    })

    it('TC-54: does not unsubscribe twice after stopping the listener', () => {
      const unsubscribe = vi.fn()
      mockOnSnapshot.mockReturnValue(unsubscribe)

      store.listenAccounts()
      store.stopListening()
      store.stopListening()

      expect(unsubscribe).toHaveBeenCalledOnce()
    })
  })
})
