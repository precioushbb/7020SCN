import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'user-123' } },
  onSnapshot: vi.fn(),
  collection: vi.fn(),
  unsubscribe: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('/src/boot/firebase', () => ({
  auth: mocks.auth,
  firestore: { name: 'mock-firestore' },
}))

vi.mock('firebase/firestore', () => ({
  collection: mocks.collection,
  onSnapshot: mocks.onSnapshot,
  doc: vi.fn(),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
}))

// Other dashboard stores are outside this test's scope.
vi.mock('stores/accountStore', () => ({
  useAccountStore: () => ({
    accounts: [],
    totalBalance: 0,
    listenAccounts: vi.fn(),
    stopListening: vi.fn(),
  }),
}))

vi.mock('stores/categoryStore', () => ({
  useCategoryStore: () => ({
    incomeCategories: [],
    expenseCategories: [],
    listenCategories: vi.fn(),
    stopListening: vi.fn(),
  }),
}))

vi.mock('stores/settingsStore', () => ({
  useSettingsStore: () => ({
    currency: '£',
    formatNumber: (value) => Number(value || 0).toLocaleString('en-GB'),
    formatDate: (value) => value,
  }),
}))

vi.mock('stores/authStore', () => ({
  useAuthStore: () => ({
    user: { email: 'user@example.com' },
    userProfile: { name: 'Test User' },
  }),
}))

vi.mock('stores/loanStore', () => ({
  useLoanStore: () => ({
    totalReceivable: 0,
    totalPayable: 0,
    totalLoanAmount: 0,
    thisMonthDue: 0,
    thisMonthDueList: [],
    listenLoans: vi.fn(),
    stopListening: vi.fn(),
  }),
}))

vi.mock('stores/occasionGoalStore', () => ({
  useOccasionGoalStore: () => ({
    activeGoals: [],
    listenGoals: vi.fn(),
    stopListening: vi.fn(),
  }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key) => key }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.routerPush }),
}))

vi.mock('quasar', () => ({
  useQuasar: () => ({
    screen: { gt: { sm: true } },
    notify: vi.fn(),
  }),
}))

import IndexPage from '../../src/pages/IndexPage.vue'
import { useTransactionStore } from '../../src/stores/transactionStore.js'

const sampleTransactions = [
  {
    id: 'tx-1',
    type: 'income',
    amount: 1500,
    category: 'Salary',
    notes: 'Monthly salary',
    date: '2026-10-20',
    createdAt: 100,
  },
  {
    id: 'tx-2',
    type: 'expense',
    amount: 200,
    category: 'Groceries',
    notes: 'Food shopping',
    date: '2026-10-21',
    createdAt: 300,
  },
  {
    id: 'tx-3',
    type: 'expense',
    amount: 50,
    category: 'Transport',
    notes: 'Bus fare',
    date: '2026-10-21',
    createdAt: 200,
  },
]

// Simulate a Firestore realtime snapshot.
function emitSnapshot(transactions) {
  const callback = mocks.onSnapshot.mock.calls[0][1]

  callback({
    docs: transactions.map((tx) => ({
      id: tx.id,
      data: () => {
        const { id, ...data } = tx
        return data
      },
    })),
  })
}

function mountDashboard() {
  const pinia = createPinia()
  setActivePinia(pinia)

  const wrapper = shallowMount(IndexPage, {
    global: {
      plugins: [pinia],
      mocks: {
        $t: (key) => key,
        $router: { push: mocks.routerPush },
        $q: { screen: { gt: { sm: true } } },
      },
      directives: {
        ripple: {},
      },
    },
  })

  return {
    wrapper,
    store: useTransactionStore(),
  }
}

describe('Transaction Store + Dashboard Integration', () => {
  let wrapper
  let store

  beforeEach(() => {
    vi.clearAllMocks()

    mocks.auth.currentUser = { uid: 'user-123' }

    mocks.collection.mockReturnValue({
      path: 'users/user-123/transactions',
    })

    mocks.onSnapshot.mockReturnValue(mocks.unsubscribe)

    localStorage.clear()

    const result = mountDashboard()
    wrapper = result.wrapper
    store = result.store
  })

  afterEach(() => {
    wrapper?.unmount()
  })

  it('INT-TX-01: subscribes to transactions on dashboard mount', () => {
    expect(mocks.collection).toHaveBeenCalledWith(expect.anything(), 'users/user-123/transactions')

    expect(mocks.onSnapshot).toHaveBeenCalledTimes(1)
    expect(store.loading).toBe(true)
  })

  it('INT-TX-02: updates store when Firestore sends transactions', async () => {
    emitSnapshot(sampleTransactions)
    await nextTick()

    expect(store.transactions).toHaveLength(3)
    expect(store.loading).toBe(false)

    expect(store.transactions.map((tx) => tx.id)).toEqual(['tx-2', 'tx-3', 'tx-1'])
  })

  it('INT-TX-03: calculates income and expenses correctly', async () => {
    emitSnapshot(sampleTransactions)
    await nextTick()

    expect(store.totalIncome).toBe(1500)
    expect(store.totalExpense).toBe(250)

    // Verify that dashboard rendering uses these totals.
    const text = wrapper.text()

    expect(text).toContain('1.5K')
    expect(text).toContain('250')
  })

  it('INT-TX-04: displays newest transactions first', async () => {
    emitSnapshot(sampleTransactions)
    await nextTick()

    expect(store.recentTransactions.map((tx) => tx.id)).toEqual(['tx-2', 'tx-3', 'tx-1'])

    expect(store.recentTransactions[0].category).toBe('Groceries')
  })

  it('INT-TX-05: excludes transfers from recent transactions', async () => {
    emitSnapshot([
      ...sampleTransactions,
      {
        id: 'tx-4',
        type: 'transfer',
        amount: 500,
        category: 'Transfer',
        createdAt: 400,
      },
    ])

    await nextTick()

    expect(store.transactions).toHaveLength(4)
    expect(store.recentTransactions).toHaveLength(3)

    expect(store.recentTransactions.some((tx) => tx.type === 'transfer')).toBe(false)

    expect(store.totalIncome).toBe(1500)
    expect(store.totalExpense).toBe(250)
  })

  it('INT-TX-06: handles an empty transaction collection', async () => {
    emitSnapshot([])
    await nextTick()

    expect(store.transactions).toEqual([])
    expect(store.recentTransactions).toEqual([])
    expect(store.totalIncome).toBe(0)
    expect(store.totalExpense).toBe(0)
    expect(store.loading).toBe(false)

    expect(wrapper.text()).toContain('dashboard.noTransactionsYet')
  })

  it('INT-TX-07: unsubscribes when dashboard unmounts', async () => {
    emitSnapshot(sampleTransactions)
    await flushPromises()

    wrapper.unmount()

    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
