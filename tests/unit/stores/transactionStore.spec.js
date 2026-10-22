import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTransactionStore } from '/src/stores/transactionStore'

const {
  mockFirestore,
  mockAuth,
  mockCollection,
  mockDoc,
  mockOnSnapshot,
  mockAddDoc,
  mockUpdateDoc,
  mockDeleteDoc,
} = vi.hoisted(() => ({
  mockFirestore: { name: 'mock-firestore' },
  mockAuth: { currentUser: { uid: 'user-123' } },
  mockCollection: vi.fn(() => ({ path: 'users/user-123/transactions' })),
  mockDoc: vi.fn((...args) => ({ path: args.at(-1) })),
  mockOnSnapshot: vi.fn(),
  mockAddDoc: vi.fn(),
  mockUpdateDoc: vi.fn(),
  mockDeleteDoc: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  collection: mockCollection,
  doc: mockDoc,
  onSnapshot: mockOnSnapshot,
  addDoc: mockAddDoc,
  updateDoc: mockUpdateDoc,
  deleteDoc: mockDeleteDoc,
}))

vi.mock('/src/boot/firebase', () => ({
  firestore: mockFirestore,
  auth: mockAuth,
}))

describe('useTransactionStore', () => {
  let store
  let unsubscribe

  beforeEach(() => {
    setActivePinia(createPinia())
    mockAuth.currentUser = { uid: 'user-123' }
    unsubscribe = vi.fn()

    vi.clearAllMocks()
    mockOnSnapshot.mockReturnValue(unsubscribe)
    mockAddDoc.mockResolvedValue({ id: 'saved-transaction-id' })
    mockUpdateDoc.mockResolvedValue(undefined)
    mockDeleteDoc.mockResolvedValue(undefined)

    store = useTransactionStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts with empty transactions and zero totals', () => {
    expect(store.transactions).toEqual([])
    expect(store.loading).toBe(false)
    expect(store.totalIncome).toBe(0)
    expect(store.totalExpense).toBe(0)
    expect(store.recentTransactions).toEqual([])
  })

  it('does not start a listener when the user is signed out', () => {
    mockAuth.currentUser = null

    store.listenTransactions()

    expect(mockCollection).not.toHaveBeenCalled()
    expect(mockOnSnapshot).not.toHaveBeenCalled()
  })

  it('listens to the current user transactions and sorts newest first', () => {
    store.listenTransactions()

    expect(mockCollection).toHaveBeenCalledWith(mockFirestore, 'users/user-123/transactions')
    expect(store.loading).toBe(true)

    mockOnSnapshot.mock.calls[0][1]({
      docs: [
        { id: 'old', data: () => ({ type: 'income', amount: 10, createdAt: 100 }) },
        { id: 'new', data: () => ({ type: 'expense', amount: 20, createdAt: 300 }) },
        { id: 'middle', data: () => ({ type: 'income', amount: 30, createdAt: 200 }) },
      ],
    })

    expect(store.transactions.map((tx) => tx.id)).toEqual(['new', 'middle', 'old'])
    expect(store.loading).toBe(false)
  })

  it('logs listener errors and clears loading', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('snapshot failed')

    store.listenTransactions()
    mockOnSnapshot.mock.calls[0][2](error)

    expect(consoleError).toHaveBeenCalledWith('Error fetching transactions:', error)
    expect(store.loading).toBe(false)
  })

  it('unsubscribes from the previous listener before listening again', () => {
    store.listenTransactions()
    store.listenTransactions()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(mockOnSnapshot).toHaveBeenCalledTimes(2)
  })

  it('calculates total income and expenses', () => {
    store.transactions = [
      { id: '1', type: 'income', amount: 1000 },
      { id: '2', type: 'expense', amount: 250 },
      { id: '3', type: 'income', amount: 500 },
      { id: '4', type: 'transfer', amount: 200 },
      { id: '5', type: 'expense', amount: 50 },
    ]

    expect(store.totalIncome).toBe(1500)
    expect(store.totalExpense).toBe(300)
  })

  it('treats missing amounts as zero in totals', () => {
    store.transactions = [
      { id: '1', type: 'income' },
      { id: '2', type: 'expense', amount: null },
    ]

    expect(store.totalIncome).toBe(0)
    expect(store.totalExpense).toBe(0)
  })

  it('returns at most ten recent non-transfer transactions', () => {
    store.transactions = Array.from({ length: 12 }, (_, index) => ({
      id: `tx-${index}`,
      type: index === 10 ? 'transfer' : 'expense',
      createdAt: index,
    }))

    expect(store.recentTransactions).toHaveLength(10)
    expect(store.recentTransactions.every((tx) => tx.type !== 'transfer')).toBe(true)
    expect(store.recentTransactions[0].id).toBe('tx-11')
    expect(store.recentTransactions[1].id).toBe('tx-9')
  })

  it('adds a transaction optimistically and replaces the temporary ID', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345)

    await store.addTransaction({
      type: 'expense',
      amount: 75,
      category: 'Food',
      accountId: 'account-1',
      notes: 'Lunch',
      date: '2026-10-21',
      time: '12:30',
    })
    await Promise.resolve()

    expect(store.transactions[0]).toMatchObject({
      id: 'saved-transaction-id',
      type: 'expense',
      amount: 75,
      category: 'Food',
      accountId: 'account-1',
      fromAccountId: null,
      toAccountId: null,
      fee: 0,
      date: '2026-10-21',
      time: '12:30',
      notes: 'Lunch',
      createdAt: 12345,
    })
    expect(mockAddDoc).toHaveBeenCalledWith(
      { path: 'users/user-123/transactions' },
      expect.objectContaining({
        type: 'expense',
        amount: 75,
        category: 'Food',
        notes: 'Lunch',
      }),
    )
  })

  it('uses defaults for optional transaction fields', async () => {
    vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-10-21T00:00:00.000Z')
    vi.spyOn(Date.prototype, 'toTimeString').mockReturnValue('09:15:00 GMT+0000')

    await store.addTransaction({ type: 'income' })

    expect(mockAddDoc).toHaveBeenCalledWith(
      { path: 'users/user-123/transactions' },
      expect.objectContaining({
        amount: 0,
        category: '',
        accountId: null,
        fromAccountId: null,
        toAccountId: null,
        fee: 0,
        date: '2026-10-21',
        time: '09:15',
        notes: '',
      }),
    )
  })

  it('does not add a transaction when signed out', async () => {
    mockAuth.currentUser = null

    await store.addTransaction({ type: 'expense', amount: 10 })

    expect(store.transactions).toEqual([])
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('updates a transaction optimistically and calls updateDoc', async () => {
    store.transactions = [{ id: 'tx-1', type: 'expense', amount: 10 }]

    await store.updateTransaction('tx-1', { amount: 25, notes: 'Updated' })

    expect(store.transactions[0]).toMatchObject({ amount: 25, notes: 'Updated' })
    expect(mockDoc).toHaveBeenCalledWith(mockFirestore, 'users/user-123/transactions/tx-1')
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { path: 'users/user-123/transactions/tx-1' },
      { amount: 25, notes: 'Updated' },
    )
  })

  it('does not update a transaction when signed out', async () => {
    mockAuth.currentUser = null

    await store.updateTransaction('tx-1', { amount: 25 })

    expect(mockUpdateDoc).not.toHaveBeenCalled()
  })

  it('deletes a transaction optimistically and calls deleteDoc', async () => {
    store.transactions = [{ id: 'keep' }, { id: 'remove' }]

    await store.deleteTransaction('remove')

    expect(store.transactions).toEqual([{ id: 'keep' }])
    expect(mockDeleteDoc).toHaveBeenCalledWith({
      path: 'users/user-123/transactions/remove',
    })
  })

  it('does not delete a transaction when signed out', async () => {
    mockAuth.currentUser = null

    await store.deleteTransaction('tx-1')

    expect(mockDeleteDoc).not.toHaveBeenCalled()
  })

  it('searches transactions by category, notes, amount, and date', () => {
    store.transactions = [
      { id: '1', category: 'Groceries', notes: 'Weekly shop', amount: 150, date: '2026-10-21' },
      { id: '2', category: 'Transport', notes: 'Bus ticket', amount: 25, date: '2026-10-20' },
      { id: '3', category: 'Salary', notes: 'Monthly pay', amount: 2000, date: '2026-10-01' },
    ]

    expect(store.searchTransactions('groc').map((tx) => tx.id)).toEqual(['1'])
    expect(store.searchTransactions('BUS').map((tx) => tx.id)).toEqual(['2'])
    expect(store.searchTransactions('2000').map((tx) => tx.id)).toEqual(['3'])
    expect(store.searchTransactions('2026-10-20').map((tx) => tx.id)).toEqual(['2'])
  })

  it('fetches transactions and resolves after the first snapshot', async () => {
    const fetchPromise = store.fetchTransactions()

    expect(store.loading).toBe(true)

    mockOnSnapshot.mock.calls[0][1]({
      docs: [{ id: 'tx-1', data: () => ({ type: 'income', amount: 50, createdAt: 100 }) }],
    })

    await fetchPromise

    expect(store.transactions).toEqual([{ id: 'tx-1', type: 'income', amount: 50, createdAt: 100 }])
    expect(store.loading).toBe(false)
  })

  it('resolves fetchTransactions without listening when signed out', async () => {
    mockAuth.currentUser = null

    await expect(store.fetchTransactions()).resolves.toBeUndefined()
    expect(mockOnSnapshot).not.toHaveBeenCalled()
  })

  it('resolves fetchTransactions and clears loading when the snapshot errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('fetch failed')
    const fetchPromise = store.fetchTransactions()

    mockOnSnapshot.mock.calls[0][2](error)
    await fetchPromise

    expect(consoleError).toHaveBeenCalledWith('Error fetching transactions:', error)
    expect(store.loading).toBe(false)
  })

  it('stops listening and clears the unsubscribe callback', () => {
    store.listenTransactions()

    store.stopListening()
    store.stopListening()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
