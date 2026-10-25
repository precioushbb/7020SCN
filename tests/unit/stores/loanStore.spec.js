import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { createPinia, setActivePinia } from 'pinia'

import { useLoanStore } from '/src/stores/loanStore'

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

  mockAuth: { currentUser: { uid: 'test-user' } },

  mockFirestore: { name: 'mock-firestore' },
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

const makeLoan = (overrides = {}) => ({
  id: 'loan-1',

  type: 'receivable',

  personName: 'Alex',

  amount: 1000,

  paidAmount: 200,

  payments: [],

  settled: false,

  createdAt: 100,

  ...overrides,
})

const makeSnapshot = (items) => ({
  docs: items.map(({ id, ...data }) => ({
    id,

    data: () => data,
  })),
})

describe('useLoanStore', () => {
  let store

  let snapshotNext

  let snapshotError

  let mockUnsubscribe

  beforeEach(() => {
    setActivePinia(createPinia())

    store = useLoanStore()

    mockAuth.currentUser = { uid: 'test-user' }

    mockCollection.mockReset().mockReturnValue({ path: 'users/test-user/loans' })

    mockDoc.mockReset().mockImplementation((...args) => ({ args }))

    mockAddDoc.mockReset().mockResolvedValue({ id: 'created-loan-id' })

    mockUpdateDoc.mockReset().mockResolvedValue(undefined)

    mockDeleteDoc.mockReset().mockResolvedValue(undefined)

    mockUnsubscribe = vi.fn()

    snapshotNext = undefined

    snapshotError = undefined

    mockOnSnapshot.mockReset().mockImplementation((_ref, next, error) => {
      snapshotNext = next

      snapshotError = error

      return mockUnsubscribe
    })

    vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initial state and computed values', () => {
    it('UT-43: starts with an empty list and loading disabled', () => {
      expect(store.loans).toEqual([])

      expect(store.loading).toBe(false)
    })

    it('UT-44: separates receivables, payables, and installment loans', () => {
      store.loans = [
        makeLoan({ id: 'r1', type: 'receivable', createdAt: 10 }),

        makeLoan({ id: 'p1', type: 'payable', createdAt: 30 }),

        makeLoan({ id: 'l1', type: 'loan', createdAt: 20 }),

        makeLoan({ id: 'r2', type: 'receivable', createdAt: 40 }),
      ]

      expect(store.receivables.map((loan) => loan.id)).toEqual(['r2', 'r1'])

      expect(store.payables.map((loan) => loan.id)).toEqual(['p1'])

      expect(store.loanEntries.map((loan) => loan.id)).toEqual(['l1'])
    })

    it('UT-45: calculates outstanding receivables and payables', () => {
      store.loans = [
        makeLoan({ type: 'receivable', amount: 1000, paidAmount: 250 }),

        makeLoan({ id: 'r2', type: 'receivable', amount: 500, paidAmount: 100 }),

        makeLoan({ id: 'p1', type: 'payable', amount: 800, paidAmount: 300 }),
      ]

      expect(store.totalReceivable).toBe(1150)

      expect(store.totalPayable).toBe(500)
    })

    it('UT-46: calculates outstanding loan-entry amounts using totalAmount when available', () => {
      store.loans = [
        makeLoan({ type: 'loan', amount: 1000, totalAmount: 1200, paidAmount: 200 }),

        makeLoan({ id: 'l2', type: 'loan', amount: 300, paidAmount: 50 }),
      ]

      expect(store.totalLoanAmount).toBe(1250)
    })

    it('UT-47: treats missing amounts as zero', () => {
      store.loans = [
        makeLoan({ type: 'receivable', amount: undefined, paidAmount: undefined }),

        makeLoan({ id: 'p1', type: 'payable', amount: undefined, paidAmount: undefined }),

        makeLoan({
          id: 'l1',

          type: 'loan',

          amount: undefined,

          totalAmount: undefined,

          paidAmount: undefined,
        }),
      ]

      expect(store.totalReceivable).toBe(0)

      expect(store.totalPayable).toBe(0)

      expect(store.totalLoanAmount).toBe(0)
    })
  })

  describe('fetchLoans and listenLoans', () => {
    it('UT-48: loads and sorts loans from the Firestore snapshot', async () => {
      const older = makeLoan({ id: 'older', createdAt: 10 })

      const newer = makeLoan({ id: 'newer', createdAt: 30 })

      const fetchPromise = store.fetchLoans()

      expect(store.loading).toBe(true)

      snapshotNext(makeSnapshot([older, newer]))

      await fetchPromise

      expect(store.loans.map((loan) => loan.id)).toEqual(['newer', 'older'])

      expect(store.loading).toBe(false)

      expect(mockOnSnapshot).toHaveBeenCalled()
    })

    it('UT-49: resolves without listening when no user is authenticated', async () => {
      mockAuth.currentUser = null

      await expect(store.fetchLoans()).resolves.toBeUndefined()

      expect(mockCollection).not.toHaveBeenCalled()

      expect(mockOnSnapshot).not.toHaveBeenCalled()

      expect(store.loading).toBe(false)
    })

    it('UT-50: clears loading and resolves if the snapshot reports an error', async () => {
      const fetchPromise = store.fetchLoans()

      const error = new Error('snapshot failed')

      snapshotError(error)

      await fetchPromise

      expect(console.error).toHaveBeenCalledWith('Error fetching loans:', error)

      expect(store.loading).toBe(false)
    })

    it('UT-51: unsubscribes from an existing listener before fetching again', async () => {
      const firstFetch = store.fetchLoans()

      snapshotNext(makeSnapshot([]))

      await firstFetch
      const secondFetch = store.fetchLoans()

      expect(mockUnsubscribe).toHaveBeenCalledTimes(1)

      snapshotNext(makeSnapshot([]))

      await secondFetch
    })
  })

  describe('addLoan', () => {
    it('UT-52: adds a loan optimistically and writes it to Firestore', async () => {
      await store.addLoan({
        type: 'receivable',

        personName: 'Jordan',

        amount: 750,

        date: '2026-10-01',

        notes: 'Personal loan',
      })

      expect(store.loans).toHaveLength(1)

      expect(store.loans[0]).toMatchObject({
        type: 'receivable',

        personName: 'Jordan',

        amount: 750,

        paidAmount: 0,

        date: '2026-10-01',

        notes: 'Personal loan',

        payments: [],

        settled: false,
      })

      expect(mockAddDoc).toHaveBeenCalledWith(
        { path: 'users/test-user/loans' },

        expect.objectContaining({ personName: 'Jordan', amount: 750 }),
      )

      await Promise.resolve()

      await Promise.resolve()

      expect(store.loans[0].id).toBe('created-loan-id')
    })

    it('UT-53: does not add a loan when no user is authenticated', async () => {
      mockAuth.currentUser = null

      await store.addLoan({ type: 'receivable', personName: 'Jordan', amount: 100 })

      expect(store.loans).toEqual([])

      expect(mockAddDoc).not.toHaveBeenCalled()
    })

    it('UT-54: uses defaults for optional loan fields', async () => {
      await store.addLoan({ type: 'payable', personName: 'Sam' })

      expect(mockAddDoc).toHaveBeenCalledWith(
        expect.anything(),

        expect.objectContaining({
          amount: 0,

          notes: '',

          payments: [],

          settled: false,
        }),
      )
    })
  })

  describe('payments on receivables and payables', () => {
    beforeEach(() => {
      store.loans = [makeLoan({ id: 'loan-1', amount: 1000, paidAmount: 200, payments: [] })]
    })

    it('UT-55: rejects negative loan payments', async () => {
      // Arrange

      store.loans = [
        makeLoan({
          id: 'loan-1',

          amount: 1000,

          paidAmount: 200,

          payments: [],
        }),
      ]

      // Act

      await store.addPayment('loan-1', {
        amount: -100,
      })

      // Assert

      expect(store.loans[0].paidAmount).toBe(200)

      expect(store.loans[0].payments).toHaveLength(0)

      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })

    it('UT-56: adds a payment and marks the loan settled when fully paid', async () => {
      await store.addPayment('loan-1', {
        amount: 800,

        date: '2026-10-20',

        notes: 'Final payment',

        accountId: 'account-1',
      })

      expect(store.loans[0].paidAmount).toBe(1000)

      expect(store.loans[0].settled).toBe(true)

      expect(store.loans[0].payments).toHaveLength(1)

      expect(store.loans[0].payments[0]).toMatchObject({
        amount: 800,

        date: '2026-10-20',

        notes: 'Final payment',

        accountId: 'account-1',

        transactionId: null,
      })

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),

        expect.objectContaining({ paidAmount: 1000, settled: true }),
      )
    })

    it('UT-57: updates an existing payment and adjusts the paid total by the difference', async () => {
      store.loans[0].payments = [{ amount: 200, date: '2026-10-01' }]

      await store.updatePayment('loan-1', 0, { amount: 350 })

      expect(store.loans[0].payments[0].amount).toBe(350)

      expect(store.loans[0].paidAmount).toBe(350)

      expect(store.loans[0].settled).toBe(false)
    })

    it('UT-58: deletes a payment and reduces the paid total', async () => {
      store.loans[0].payments = [{ amount: 200 }, { amount: 100 }]

      store.loans[0].paidAmount = 300

      await store.deletePayment('loan-1', 0)

      expect(store.loans[0].payments).toEqual([{ amount: 100 }])

      expect(store.loans[0].paidAmount).toBe(100)

      expect(store.loans[0].settled).toBe(false)
    })

    it('UT-59: ignores payment actions for unknown loans', async () => {
      await store.addPayment('missing', { amount: 50 })

      await store.updatePayment('missing', 0, { amount: 50 })

      await store.deletePayment('missing', 0)

      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })

    it('UT-60: prevents payments exceeding the outstanding loan balance', async () => {
      // Arrange

      store.loans = [
        makeLoan({
          id: 'loan-1',

          amount: 1000,

          paidAmount: 800,

          payments: [{ amount: 800 }],

          settled: false,
        }),
      ]

      // Act

      await store.addPayment('loan-1', {
        amount: 500,
      })

      // Assert

      expect(store.loans[0].paidAmount).toBe(800)

      expect(store.loans[0].payments).toHaveLength(1)

      expect(store.loans[0].settled).toBe(false)

      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })

    it('UT-61: does not update payments when the user is unauthenticated', async () => {
      mockAuth.currentUser = null

      await store.addPayment('loan-1', { amount: 50 })

      expect(store.loans[0].paidAmount).toBe(200)

      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })
  })

  describe('updateLoan and deleteLoan', () => {
    beforeEach(() => {
      store.loans = [makeLoan({ id: 'loan-1' }), makeLoan({ id: 'loan-2' })]
    })

    it('UT-62: updates local loan data and persists the change', async () => {
      await store.updateLoan('loan-1', { personName: 'Updated name', amount: 1200 })

      expect(store.loans[0]).toMatchObject({ personName: 'Updated name', amount: 1200 })

      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), {
        personName: 'Updated name',

        amount: 1200,
      })
    })

    it('UT-63: deletes a loan locally and from Firestore', async () => {
      await store.deleteLoan('loan-1')

      expect(store.loans.map((loan) => loan.id)).toEqual(['loan-2'])

      expect(mockDeleteDoc).toHaveBeenCalledWith(expect.anything())
    })

    it('UT-64: does not update or delete when unauthenticated', async () => {
      mockAuth.currentUser = null

      await store.updateLoan('loan-1', { amount: 10 })

      await store.deleteLoan('loan-1')

      expect(store.loans).toHaveLength(2)

      expect(mockUpdateDoc).not.toHaveBeenCalled()

      expect(mockDeleteDoc).not.toHaveBeenCalled()
    })
  })

  describe('installment loan creation', () => {
    it('UT-65: creates installments including interest and adjusts the final installment for rounding', async () => {
      await store.addLoanWithInstallments({
        personName: 'Taylor',

        amount: 100,

        interestRate: 10,

        installmentCount: 3,

        installmentFrequency: 'daily',

        date: '2026-10-01',

        accountId: 'account-1',
      })

      expect(store.loans).toHaveLength(1)
      const loan = store.loans[0]

      expect(loan).toMatchObject({
        type: 'loan',

        personName: 'Taylor',

        amount: 100,

        interestRate: 10,

        totalAmount: 110,

        installmentCount: 3,

        installmentFrequency: 'daily',

        accountId: 'account-1',

        settled: false,
      })

      expect(loan.installments).toHaveLength(3)

      expect(loan.installments.map((inst) => inst.dueDate)).toEqual([
        '2026-10-02',

        '2026-10-03',

        '2026-10-04',
      ])

      expect(loan.installments.reduce((sum, inst) => sum + inst.amount, 0)).toBeCloseTo(110)

      expect(loan.installments.every((inst) => inst.paid === false)).toBe(true)

      expect(mockAddDoc).toHaveBeenCalledWith(
        expect.anything(),

        expect.objectContaining({ type: 'loan', totalAmount: 110 }),
      )
    })

    it('UT-66: does not create an installment loan without an authenticated user', async () => {
      mockAuth.currentUser = null

      await store.addLoanWithInstallments({
        personName: 'Taylor',

        amount: 100,

        date: '2026-10-01',
      })

      expect(store.loans).toEqual([])

      expect(mockAddDoc).not.toHaveBeenCalled()
    })
  })

  describe('installment payments', () => {
    beforeEach(() => {
      store.loans = [
        makeLoan({
          id: 'installment-loan',

          type: 'loan',

          amount: 100,

          interestRate: 0,

          totalAmount: 100,

          paidAmount: 0,

          settled: false,

          installments: [
            {
              number: 1,

              amount: 50,

              dueDate: '2026-10-10',

              paid: false,

              paidAmount: 0,

              paidDate: null,
            },

            {
              number: 2,

              amount: 50,

              dueDate: '2026-11-10',

              paid: false,

              paidAmount: 0,

              paidDate: null,
            },
          ],
        }),
      ]
    })

    it('UT-67: records a partial installment payment without marking it paid', async () => {
      // Arrange
      const loan = store.loans[0]

      expect(loan.id).toBe('installment-loan')

      expect(loan.installments[0].paidAmount).toBe(0)

      // Act

      await store.addInstallmentPayment('installment-loan', 0, { amount: 20 }, false)

      // Assert

      expect(loan.installments[0].paidAmount).toBe(20)

      expect(loan.installments[0].paid).toBe(false)

      expect(loan.paidAmount).toBe(20)

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),

        expect.objectContaining({
          paidAmount: 20,

          settled: false,
        }),
      )
    })

    it('UT-68: recalculates remaining installments after a partial payment', async () => {
      // Arrange

      store.loans = [
        makeLoan({
          id: 'installment-loan',

          type: 'loan',

          amount: 100,

          interestRate: 0,

          totalAmount: 100,

          paidAmount: 0,

          settled: false,

          installments: [
            {
              number: 1,

              amount: 50,

              paidAmount: 0,

              paid: false,

              payments: [],
            },

            {
              number: 2,

              amount: 50,

              paidAmount: 0,

              paid: false,

              payments: [],
            },
          ],
        }),
      ]

      // Act

      await store.addInstallmentPayment('installment-loan', 0, { amount: 20 }, false)
      const loan = store.loans[0]

      // Remaining amount across installments
      const remainingAmount = loan.installments.reduce(
        (sum, inst) => sum + (inst.amount - inst.paidAmount),

        0,
      )

      // Assert

      expect(loan.paidAmount).toBe(20)

      expect(remainingAmount).toBe(80)
    })

    it('UT-69: marks an installment paid when cumulative payments reach its amount', async () => {
      await store.addInstallmentPayment('installment-loan', 0, { amount: 50, date: '2026-10-05' })
      const loan = store.loans[0]

      expect(loan.installments[0].paid).toBe(true)

      expect(loan.installments[0].paidAmount).toBe(50)

      expect(loan.paidAmount).toBe(50)

      expect(loan.settled).toBe(false)
    })

    it('UT-70: resets an installment and subtracts its recorded payments', async () => {
      const loan = store.loans[0]

      loan.installments[0] = {
        ...loan.installments[0],

        paid: true,

        paidAmount: 50,

        paidDate: '2026-10-05',

        payments: [{ amount: 50 }],
      }

      loan.paidAmount = 50

      await store.resetInstallment('installment-loan', 0)

      expect(loan.installments[0]).toMatchObject({
        paid: false,

        paidAmount: 0,

        paidDate: null,

        payments: [],
      })

      expect(loan.paidAmount).toBe(0)

      expect(loan.settled).toBe(false)

      expect(mockUpdateDoc).toHaveBeenCalled()
    })

    it('UT-71: ignores missing loans, missing installments, and unauthenticated requests', async () => {
      await store.addInstallmentPayment('missing', 0, { amount: 10 })

      await store.resetInstallment('missing', 0)

      await store.addInstallmentPayment('installment-loan', 99, { amount: 10 })

      await store.resetInstallment('installment-loan', 99)

      mockAuth.currentUser = null

      await store.addInstallmentPayment('installment-loan', 0, { amount: 10 })

      await store.resetInstallment('installment-loan', 0)

      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })
  })

  describe('monthly due calculations', () => {
    it('UT-72: calculates current-month due totals, counts, and due list', () => {
      const now = new Date()

      const currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 15)

      const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 15)

      const toDate = (date) => {
        const year = date.getFullYear()

        const month = String(date.getMonth() + 1).padStart(2, '0')

        const day = String(date.getDate()).padStart(2, '0')

        return `${year}-${month}-${day}`
      }

      store.loans = [
        makeLoan({
          id: 'due-loan',

          type: 'loan',

          personName: 'Casey',

          installments: [
            {
              number: 1,

              dueDate: toDate(currentMonthDate),

              amount: 60,

              paidAmount: 10,

              paid: false,
            },

            { number: 2, dueDate: toDate(nextMonthDate), amount: 40, paidAmount: 0, paid: false },

            { number: 3, dueDate: toDate(currentMonthDate), amount: 25, paidAmount: 0, paid: true },
          ],
        }),

        makeLoan({
          id: 'settled-loan',

          type: 'loan',

          settled: true,

          installments: [
            { number: 1, dueDate: toDate(currentMonthDate), amount: 500, paid: false },
          ],
        }),
      ]

      expect(store.thisMonthDue).toBe(50)

      expect(store.thisMonthDueCount).toBe(1)

      expect(store.thisMonthDueList).toEqual([
        expect.objectContaining({
          personName: 'Casey',

          installmentNumber: 1,

          amount: 50,

          dueDate: toDate(currentMonthDate),
        }),
      ])

      expect(store.upcomingMonthlySchedule).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ total: 50, count: 1 }),

          expect.objectContaining({ total: 40, count: 1 }),
        ]),
      )
    })
  })
})
