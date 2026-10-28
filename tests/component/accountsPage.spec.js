import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import * as QuasarComponents from 'quasar' // Import all built-in components to resolve template issues
import AccountsPage from '/src/pages/AccountsPage.vue' // Adjusted path to match standard project structure

const mockAccountStore = {
  listenAccounts: vi.fn(),
  stopListening: vi.fn(),
  addAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
}

const mockTransactionStore = {
  listenTransactions: vi.fn(),
  stopListening: vi.fn(),
  transactions: [],
}

const mockSettingsStore = {}

vi.mock('stores/accountStore', () => ({
  useAccountStore: () => mockAccountStore,
}))
vi.mock('stores/transactionStore', () => ({
  useTransactionStore: () => mockTransactionStore,
}))
vi.mock('stores/settingsStore', () => ({
  useSettingsStore: () => mockSettingsStore,
}))

// ==========================================
// 2. QUASAR & I18N COMPOSABLE MOCKS
// ==========================================
const mockNotify = vi.fn()
const mockDialog = vi.fn().mockReturnValue({
  onOk: (callback) => {
    callback() // Automatically simulate hitting 'OK'
    return { onCancel: () => {} }
  },
})

vi.mock('quasar', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify,
      dialog: mockDialog,
    }),
  }
})

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key) => key, // Simply returns the key string back for easy testing assertions
  }),
}))

// ==========================================
// 3. TEST SUITE IMPLEMENTATION
// ==========================================
describe('Account Component Logic Tests', () => {
  let wrapper

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockTransactionStore.transactions = []

    // Mount the component with complete UI context to prevent warnings
    wrapper = mount(AccountsPage, {
      global: {
        components: {
          ...QuasarComponents, // Registers q-item, q-slide-item, q-input, etc.
        },
        directives: {
          'close-popup': vi.fn(), // Stubs out the directive v-close-popup
        },
        mocks: {
          $t: (key) => key, // Stubs template-level interpolations like {{ $t(...) }}
        },
      },
    })
  })

  // --- Lifecycle Tests ---
  describe('Lifecycle Hooks', () => {
    it('CT-01: should invoke listener endpoints on mount', () => {
      expect(mockAccountStore.listenAccounts).toHaveBeenCalled()
      expect(mockTransactionStore.listenTransactions).toHaveBeenCalled()
    })

    it('CT-02: should unsubscribe from listener endpoints on unmount', () => {
      wrapper.unmount()
      expect(mockAccountStore.stopListening).toHaveBeenCalled()
      expect(mockTransactionStore.stopListening).toHaveBeenCalled()
    })
  })

  // --- Function: getTypeLabel ---
  describe('getTypeLabel()', () => {
    it('CT-03: should correctly map account types to translation keys', () => {
      const { getTypeLabel } = wrapper.vm
      expect(getTypeLabel('Cash')).toBe('accounts.cashAccount')
      expect(getTypeLabel('Bank')).toBe('accounts.bankAccount')
      expect(getTypeLabel('Mobile Banking')).toBe('accounts.mobileAccount')
    })

    it('CT-04:should return the original string if type is unmapped', () => {
      const { getTypeLabel } = wrapper.vm
      expect(getTypeLabel('UnknownType')).toBe('UnknownType')
    })
  })

  // --- Function: getLastTx ---
  describe('getLastTx()', () => {
    it('CT-05: should return null if there are no transactions available', () => {
      const { getLastTx } = wrapper.vm
      expect(getLastTx(1)).toBeNull()
    })

    it('CT-06: should return the most recent transaction matching the specified accountId context', () => {
      const { getLastTx } = wrapper.vm
      const mockTxs = [
        { id: 101, accountId: 1, amount: 50 },
        { id: 102, fromAccountId: 2, toAccountId: 1, amount: 20 },
        { id: 103, accountId: 99, amount: 10 },
      ]
      mockTransactionStore.transactions = mockTxs

      expect(getLastTx(1)).toEqual(mockTxs[0])
    })
  })

  // --- Function: openAddDialog ---
  describe('openAddDialog()', () => {
    it('CT-07: should clear form fields and open the dialog context in create mode', () => {
      const { openAddDialog, form } = wrapper.vm

      // Inject dummy dirty data first
      form.name = 'Old Name'
      form.balance = 500

      openAddDialog()

      expect(wrapper.vm.isEditing).toBe(false)
      expect(wrapper.vm.editingId).toBeNull()
      expect(form.name).toBe('')
      expect(form.balance).toBe(0)
      expect(wrapper.vm.showDialog).toBe(true)
    })
  })

  // --- Function: openEditDialog ---
  describe('openEditDialog()', () => {
    it('CT-08: should prepopulate the form with account metrics and open in editing mode', () => {
      const { openEditDialog, form } = wrapper.vm
      const accountMock = {
        id: 42,
        name: 'Savings Fund',
        type: 'Bank',
        balance: 2500,
        icon: 'savings',
        color: '#ef4444',
      }

      openEditDialog(accountMock)

      expect(wrapper.vm.isEditing).toBe(true)
      expect(wrapper.vm.editingId).toBe(42)
      expect(form.name).toBe('Savings Fund')
      expect(form.type).toBe('Bank')
      expect(form.balance).toBe(2500)
      expect(wrapper.vm.showDialog).toBe(true)
    })
  })

  // --- Function: saveAccount ---
  describe('saveAccount()', () => {
    it('CT-09: should halt execution if form validation fields (name) are omitted', async () => {
      const { saveAccount, form } = wrapper.vm
      form.name = '' // invalid state

      await saveAccount()

      expect(mockAccountStore.addAccount).not.toHaveBeenCalled()
    })

    it('CT-10: should invoke store addAccount and notify user when creating a new record', async () => {
      const { saveAccount, form } = wrapper.vm
      wrapper.vm.isEditing = false
      form.name = 'New Pocket'
      form.type = 'Cash'

      await saveAccount()

      expect(mockAccountStore.addAccount).toHaveBeenCalledWith({
        name: 'New Pocket',
        type: 'Cash',
        balance: 0,
        icon: 'account_balance_wallet',
        color: '#111111',
      })
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'positive',
        message: 'accounts.accountAdded',
        position: 'top',
      })
      expect(wrapper.vm.showDialog).toBe(false)
    })

    it('CT-11: should invoke store updateAccount when updating an existing account context', async () => {
      const { saveAccount, form } = wrapper.vm
      wrapper.vm.isEditing = true
      wrapper.vm.editingId = 12
      form.name = 'Updated Budget'

      await saveAccount()

      expect(mockAccountStore.updateAccount).toHaveBeenCalledWith(12, expect.any(Object))
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'positive',
        message: 'accounts.accountUpdated',
        position: 'top',
      })
    })

    it('CT-12: should catch exceptions cleanly and push an error banner to user feedback', async () => {
      const { saveAccount, form } = wrapper.vm
      form.name = 'Faulty Record'
      mockAccountStore.addAccount.mockRejectedValueOnce(new Error('DB Network Down'))

      await saveAccount()

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'negative',
        message: 'common.errorDB Network Down',
        position: 'top',
      })
      expect(wrapper.vm.saving).toBe(false)
    })
  })

  // --- Function: onSwipe ---
  describe('onSwipe()', () => {
    it('CT-13: should call wrapper reset immediately and fire conditional events following timers', () => {
      const { onSwipe } = wrapper.vm
      const mockReset = vi.fn()
      const dummyAccount = { id: 7, name: 'Swipe Account' }

      onSwipe({ reset: mockReset }, 'edit', dummyAccount)

      // Jump timers forward to clear reset interval
      vi.advanceTimersByTime(100)
      expect(mockReset).toHaveBeenCalled()

      // Jump past the execution fallback delay threshold
      vi.advanceTimersByTime(200)
      expect(wrapper.vm.isEditing).toBe(true)
      expect(wrapper.vm.editingId).toBe(7)
    })
  })
})
