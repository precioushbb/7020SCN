import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import * as QuasarComponents from 'quasar'
import MarketListsPage from '../../src/pages/MarketListsPage.vue'

const mockNotify = vi.fn()
const mockDialog = vi.fn(() => ({
  onOk: (cb) => {
    cb()
    return { onCancel: () => {} }
  },
}))
vi.mock('quasar', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useQuasar: () => ({ notify: mockNotify, dialog: mockDialog }) }
})
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }))
const fn = () => vi.fn()
const makeStore = (methods, fields = {}) =>
  Object.assign(Object.fromEntries(methods.map((m) => [m, fn()])), fields)
const mockMarketStore = makeStore(
  [
    'listenLists',
    'stopListening',
    'addList',
    'deleteList',
    'addItem',
    'removeItem',
    'updateItem',
    'updateList',
    'getListTotal',
  ],
  { lists: [] },
)
vi.mock('stores/marketListStore', () => ({ useMarketListStore: () => mockMarketStore }))
const mockTransactionStore = makeStore(
  ['listenTransactions', 'stopListening', 'addTransaction', 'deleteTransaction'],
  { transactions: [] },
)
vi.mock('stores/transactionStore', () => ({ useTransactionStore: () => mockTransactionStore }))
const mockAccountStore = makeStore(['listenAccounts', 'stopListening', 'updateBalance'], {
  accounts: [],
})
vi.mock('stores/accountStore', () => ({ useAccountStore: () => mockAccountStore }))
const mockCategoryStore = makeStore(['listenCategories', 'stopListening'], {
  incomeCategories: [],
  expenseCategories: [],
})
vi.mock('stores/categoryStore', () => ({ useCategoryStore: () => mockCategoryStore }))
const mockSettingsStore = {
  language: 'en',
  currency: '$',
  formatNumber: (n) => String(n),
  formatDate: (d) => d,
}
vi.mock('stores/settingsStore', () => ({ useSettingsStore: () => mockSettingsStore }))

describe('MarketListsPage component logic tests', () => {
  let wrapper
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarketStore.lists = []
    mockAccountStore.accounts = []
    mockTransactionStore.transactions = []
    mockCategoryStore.incomeCategories = []
    mockCategoryStore.expenseCategories = []
    wrapper = mount(MarketListsPage, {
      global: {
        components: { ...QuasarComponents },
        directives: { 'close-popup': vi.fn(), ripple: vi.fn() },
        mocks: { $t: (key) => key },
        stubs: { transition: false, 'transition-group': false, teleport: true, LoanCard: true },
      },
    })
  })
  afterEach(() => {
    if (wrapper) wrapper.unmount()
    vi.useRealTimers()
  })
  it('starts and stops listeners', () => {
    expect(mockMarketStore.listenLists).toHaveBeenCalled()
    expect(mockTransactionStore.listenTransactions).toHaveBeenCalled()
    expect(mockAccountStore.listenAccounts).toHaveBeenCalled()
    expect(mockCategoryStore.listenCategories).toHaveBeenCalled()
    wrapper.unmount()
    expect(mockMarketStore.stopListening).toHaveBeenCalled()
  })
  it('counts purchased items', () => {
    expect(
      wrapper.vm.getCompletedCount({
        items: [{ bought: true }, { bought: false }, { bought: true }],
      }),
    ).toBe(2)
  })
  it('does not create an unnamed list', async () => {
    wrapper.vm.newListName = ''
    await wrapper.vm.createList()
    expect(mockMarketStore.addList).not.toHaveBeenCalled()
  })
  it('creates a named list', async () => {
    wrapper.vm.newListName = 'Groceries'
    await wrapper.vm.createList()
    expect(mockMarketStore.addList).toHaveBeenCalledWith({ name: 'Groceries' })
    expect(wrapper.vm.showNewList).toBe(false)
  })
  it('opens a fresh item form', () => {
    wrapper.vm.openAddItem('list1')
    expect(wrapper.vm.activeListId).toBe('list1')
    expect(wrapper.vm.newItem.quantity).toBe(1)
    expect(wrapper.vm.showAddItem).toBe(true)
  })
  it('prevents unnamed items', async () => {
    wrapper.vm.openAddItem('list1')
    await wrapper.vm.addItem()
    expect(mockMarketStore.addItem).not.toHaveBeenCalled()
  })
  it('adds a valid item', async () => {
    wrapper.vm.openAddItem('list1')
    Object.assign(wrapper.vm.newItem, { name: 'Milk', quantity: 2, price: 4 })
    await wrapper.vm.addItem()
    expect(mockMarketStore.addItem).toHaveBeenCalledWith('list1', {
      name: 'Milk',
      quantity: 2,
      price: 4,
    })
  })
  it('deletes a list after confirmation', async () => {
    wrapper.vm.confirmDeleteList({ id: 'list1', name: 'Groceries' })
    await wrapper.vm.doDeleteListOnly()
    expect(mockMarketStore.deleteList).toHaveBeenCalledWith('list1')
    expect(wrapper.vm.deleteListModalOpen).toBe(false)
  })
  it('handles list creation errors', async () => {
    wrapper.vm.newListName = 'Test'
    mockMarketStore.addList.mockRejectedValueOnce(new Error('offline'))
    await wrapper.vm.createList()
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }))
  })
})
