import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'

// These mocks are hoisted before the real Pinia stores are imported.
const mocks = vi.hoisted(() => ({
  user: { currentUser: { uid: 'test-user' } },
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  onSnapshot: vi.fn(),
  notify: vi.fn(),
  back: vi.fn(),
}))

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db, path) => ({ path })),
  doc: vi.fn((_db, path) => ({ path })),
  onSnapshot: mocks.onSnapshot,
  addDoc: mocks.addDoc,
  updateDoc: mocks.updateDoc,
  deleteDoc: vi.fn(() => Promise.resolve()),
}))

vi.mock('/src/boot/firebase', () => ({
  firestore: {},
  auth: mocks.user,
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ back: mocks.back }),
}))

vi.mock('quasar', () => ({
  useQuasar: () => ({ notify: mocks.notify }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key) => key }),
}))

vi.mock('stores/settingsStore', () => ({
  useSettingsStore: () => ({
    currency: '£',
    formatNumber: (n) => String(n),
  }),
}))

import AddIncomePage from '../../src/pages/AddIncomePage.vue'
import AddExpensePage from '../../src/pages/AddExpensePage.vue'
import { useAccountStore } from '../../src/stores/accountStore.js'
import { useTransactionStore } from '../../src/stores/transactionStore.js'
import { useCategoryStore } from '../../src/stores/categoryStore.js'

// Minimal Quasar stubs preserve v-model events and QForm submission.
const QForm = defineComponent({
  name: 'QForm',
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

const QInput = defineComponent({
  name: 'QInput',

  inheritAttrs: false,

  props: ['modelValue', 'type', 'label', 'prefix', 'rules', 'outlined', 'color', 'inputClass'],

  emits: ['update:modelValue'],

  setup(props, { emit }) {
    return () =>
      h('input', {
        'data-label': props.label,

        type: props.type === 'number' ? 'number' : 'text',

        value: props.modelValue ?? '',

        onInput: (event) => {
          const value = event.target.value

          emit('update:modelValue', props.type === 'number' ? Number(value) : value)
        },
      })
  },
})

const QSelect = defineComponent({
  name: 'QSelect',
  props: ['modelValue', 'options', 'label'],
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () =>
      h(
        'select',
        {
          'data-label': props.label,
          value: props.modelValue ?? '',
          onChange: (e) => emit('update:modelValue', e.target.value),
        },
        [
          h('option', { value: '' }, 'Choose'),
          ...(props.options || []).map((o) => h('option', { value: o.value }, o.label)),
        ],
      )
  },
})

const QBtn = defineComponent({
  name: 'QBtn',
  props: ['type'],
  setup(props) {
    return () =>
      h(
        'button',
        {
          type: props.type || 'button',
        },
        'Save',
      )
  },
})

const passthrough = (name) =>
  defineComponent({
    name,
    setup(_, { slots }) {
      return () => h('div', slots.default?.())
    },
  })

const stubs = {
  QPage: passthrough('QPage'),
  QCard: passthrough('QCard'),
  QCardSection: passthrough('QCardSection'),
  QForm,
  QInput,
  QSelect,
  QBtn,
  QItem: passthrough('QItem'),
  QItemSection: passthrough('QItemSection'),
  QItemLabel: passthrough('QItemLabel'),
  QAvatar: passthrough('QAvatar'),
  QIcon: passthrough('QIcon'),
  QPopupProxy: passthrough('QPopupProxy'),
  QDate: passthrough('QDate'),
  QTime: passthrough('QTime'),
}

let accounts, transactions, categories

beforeEach(() => {
  vi.clearAllMocks()

  mocks.user.currentUser = { uid: 'test-user' }
  mocks.addDoc.mockResolvedValue({ id: 'saved-tx' })
  mocks.updateDoc.mockResolvedValue(undefined)
  mocks.onSnapshot.mockImplementation(() => vi.fn())

  setActivePinia(createPinia())

  accounts = useAccountStore()
  transactions = useTransactionStore()
  categories = useCategoryStore()

  accounts.accounts = [
    { id: 'a1', name: 'Main', balance: 1000 },
    { id: 'a2', name: 'Savings', balance: 300 },
  ]

  categories.categories = [
    {
      id: 'c1',
      name: 'Salary',
      type: 'income',
      icon: 'work',
      color: '#333',
    },
    {
      id: 'c2',
      name: 'Food',
      type: 'expense',
      icon: 'food',
      color: '#333',
    },
  ]
})

function mountPage(component) {
  return shallowMount(component, {
    global: {
      plugins: [],
      stubs,
      mocks: {
        $t: (key) => key,
        $router: { back: mocks.back },
      },
    },
  })
}

async function fillAndSubmit(wrapper, { amount, category, account = 'a1' }) {
  await wrapper.get('input[type="number"]').setValue(String(amount))

  await wrapper.get('select[data-label="common.category"]').setValue(category)

  await wrapper.get('select[data-label="common.account"]').setValue(account)

  await wrapper.get('form').trigger('submit')
  await nextTick()

  // The store intentionally fires off Firestore writes
  // without awaiting them.
  await Promise.resolve()
}

describe('High-risk integration: form → Pinia transaction/account stores → Firebase', () => {
  it('IT-01: saving £500 income records transaction and increases only selected account', async () => {
    const wrapper = mountPage(AddIncomePage)

    await fillAndSubmit(wrapper, {
      amount: 500,
      category: 'Salary',
    })

    expect(transactions.totalIncome).toBe(500)

    expect(transactions.transactions[0]).toMatchObject({
      type: 'income',
      amount: 500,
      category: 'Salary',
      accountId: 'a1',
    })

    expect(accounts.accounts[0].balance).toBe(1500)
    expect(accounts.accounts[1].balance).toBe(300)

    expect(mocks.addDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'users/test-user/transactions',
      }),
      expect.objectContaining({
        type: 'income',
        amount: 500,
      }),
    )

    expect(mocks.updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'users/test-user/accounts/a1',
      }),
      { balance: 1500 },
    )

    expect(mocks.back).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('IT-02: saving £200 expense records transaction and reduces selected account', async () => {
    const wrapper = mountPage(AddExpensePage)

    await fillAndSubmit(wrapper, {
      amount: 200,
      category: 'Food',
    })

    expect(transactions.totalExpense).toBe(200)

    expect(transactions.transactions[0]).toMatchObject({
      type: 'expense',
      amount: 200,
      category: 'Food',
      accountId: 'a1',
    })

    expect(accounts.accounts[0].balance).toBe(800)
    expect(accounts.accounts[1].balance).toBe(300)

    expect(mocks.updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'users/test-user/accounts/a1',
      }),
      { balance: 800 },
    )

    wrapper.unmount()
  })

  it('IT-03: selecting another account leaves the original account unchanged', async () => {
    const wrapper = mountPage(AddIncomePage)

    await fillAndSubmit(wrapper, {
      amount: 75,
      category: 'Salary',
      account: 'a2',
    })

    expect(accounts.accounts.map((a) => a.balance)).toEqual([1000, 375])

    expect(mocks.updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'users/test-user/accounts/a2',
      }),
      { balance: 375 },
    )

    wrapper.unmount()
  })

  it.each([0, -5])(
    'IT-04: invalid amount %s does not create a transaction or change balance',
    async (amount) => {
      const wrapper = mountPage(AddIncomePage)

      await fillAndSubmit(wrapper, {
        amount,
        category: 'Salary',
      })

      expect(transactions.transactions).toHaveLength(0)
      expect(accounts.totalBalance).toBe(1300)

      expect(mocks.addDoc).not.toHaveBeenCalled()
      expect(mocks.updateDoc).not.toHaveBeenCalled()

      wrapper.unmount()
    },
  )

  it('IT-05: rejected transaction write exposes optimistic consistency risk', async () => {
    mocks.addDoc.mockRejectedValueOnce(new Error('Permission denied'))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const wrapper = mountPage(AddIncomePage)

      await fillAndSubmit(wrapper, {
        amount: 100,
        category: 'Salary',
      })

      await vi.waitFor(() => expect(warn).toHaveBeenCalled())

      // This documents CURRENT behaviour,
      // not desirable consistency.
      expect(transactions.totalIncome).toBe(100)
      expect(accounts.accounts[0].balance).toBe(1100)
      expect(mocks.back).toHaveBeenCalled()

      wrapper.unmount()
    } finally {
      warn.mockRestore()
    }
  })

  it('IT-06: rejected balance write exposes optimistic consistency risk', async () => {
    mocks.updateDoc.mockRejectedValueOnce(new Error('Permission denied'))

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const wrapper = mountPage(AddExpensePage)

      await fillAndSubmit(wrapper, {
        amount: 50,
        category: 'Food',
      })

      await vi.waitFor(() => expect(warn).toHaveBeenCalled())

      // Local state updates even though
      // remote balance write was rejected.
      expect(transactions.totalExpense).toBe(50)
      expect(accounts.accounts[0].balance).toBe(950)
      expect(mocks.back).toHaveBeenCalled()

      wrapper.unmount()
    } finally {
      warn.mockRestore()
    }
  })
})
