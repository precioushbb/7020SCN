import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import * as QuasarComponents from 'quasar'
import LoansPage from '/src/pages/LoansPage.vue'

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
const mockLoanStore = makeStore(
  [
    'listenLoans',
    'stopListening',
    'addLoan',
    'addLoanWithInstallments',
    'updateLoan',
    'deleteLoan',
    'addPayment',
    'updatePayment',
    'deletePayment',
    'addInstallmentPayment',
    'resetInstallment',
  ],
  { loans: [] },
)
vi.mock('stores/loanStore', () => ({ useLoanStore: () => mockLoanStore }))
const mockAccountStore = makeStore(['listenAccounts', 'stopListening', 'updateBalance'], {
  accounts: [],
})
vi.mock('stores/accountStore', () => ({ useAccountStore: () => mockAccountStore }))
const mockTransactionStore = makeStore(
  ['listenTransactions', 'stopListening', 'addTransaction', 'deleteTransaction'],
  { transactions: [] },
)
vi.mock('stores/transactionStore', () => ({ useTransactionStore: () => mockTransactionStore }))
const mockSettingsStore = {
  language: 'en',
  currency: '$',
  formatNumber: (n) => String(n),
  formatDate: (d) => d,
}
vi.mock('stores/settingsStore', () => ({ useSettingsStore: () => mockSettingsStore }))

describe('LoansPage component logic tests', () => {
  let wrapper
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoanStore.loans = []
    mockAccountStore.accounts = []
    mockTransactionStore.transactions = []
    wrapper = mount(LoansPage, {
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
  it('CT-14: starts and stops financial listeners', () => {
    expect(mockLoanStore.listenLoans).toHaveBeenCalled()
    expect(mockAccountStore.listenAccounts).toHaveBeenCalled()
    expect(mockTransactionStore.listenTransactions).toHaveBeenCalled()
    wrapper.unmount()
    expect(mockLoanStore.stopListening).toHaveBeenCalled()
    expect(mockAccountStore.stopListening).toHaveBeenCalled()
    expect(mockTransactionStore.stopListening).toHaveBeenCalled()
  })
  it('CT-15: opens a blank add-loan dialog', () => {
    wrapper.vm.addForm.personName = 'Old'
    wrapper.vm.openAddDialog()
    expect(wrapper.vm.addForm.personName).toBe('')
    expect(wrapper.vm.showAddDialog).toBe(true)
  })
  it('CT-16: does not create loans with missing name or nonpositive amount', async () => {
    wrapper.vm.addForm.personName = ''
    wrapper.vm.addForm.amount = 100
    await wrapper.vm.saveLoan()
    wrapper.vm.addForm.personName = 'Sam'
    wrapper.vm.addForm.amount = -10
    await wrapper.vm.saveLoan()
    expect(mockLoanStore.addLoan).not.toHaveBeenCalled()
  })
  it('CT-16: creates a valid loan', async () => {
    wrapper.vm.openAddDialog()
    wrapper.vm.addForm.personName = 'Sam'
    wrapper.vm.addForm.amount = 300
    await wrapper.vm.saveLoan()
    expect(mockLoanStore.addLoan).toHaveBeenCalledWith(
      expect.objectContaining({ personName: 'Sam', amount: 300 }),
    )
    expect(wrapper.vm.showAddDialog).toBe(false)
  })
  it('CT-18: requires installments and account for installment loans', async () => {
    wrapper.vm.addForm.personName = 'Sam'
    wrapper.vm.addForm.amount = 300
    wrapper.vm.addForm.installmentCount = 0
    await wrapper.vm.saveLoanEntry()
    expect(mockLoanStore.addLoanWithInstallments).not.toHaveBeenCalled()
  })
  it('CT-19: creates a loan with installments', async () => {
    Object.assign(wrapper.vm.addForm, {
      personName: 'Sam',
      amount: 300,
      installmentCount: 3,
      accountId: 'a1',
      installmentFrequency: 'monthly',
    })
    await wrapper.vm.saveLoanEntry()
    expect(mockLoanStore.addLoanWithInstallments).toHaveBeenCalledWith(
      expect.objectContaining({
        personName: 'Sam',
        amount: 300,
        installmentCount: 3,
        accountId: 'a1',
      }),
    )
  })
  it('CT-20: notifies on loan creation errors', async () => {
    wrapper.vm.addForm.personName = 'Sam'
    wrapper.vm.addForm.amount = 300
    mockLoanStore.addLoan.mockRejectedValueOnce(new Error('offline'))
    await wrapper.vm.saveLoan()
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }))
    expect(wrapper.vm.saving).toBe(false)
  })
})
