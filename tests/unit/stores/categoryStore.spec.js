import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCategoryStore } from '/src/stores/categoryStore'

// Match the exact module specifier used in categoryStore.js.
const { collectionMock, docMock, snapshotMock, addMock, updateMock, deleteMock, authMock, dbMock } =
  vi.hoisted(() => ({
    collectionMock: vi.fn(),
    docMock: vi.fn(),
    snapshotMock: vi.fn(),
    addMock: vi.fn(),
    updateMock: vi.fn(),
    deleteMock: vi.fn(),
    authMock: { currentUser: { uid: 'user123' } },
    dbMock: {},
  }))

vi.mock('/src/boot/firebase', () => ({ auth: authMock, firestore: dbMock }))
vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  doc: docMock,
  onSnapshot: snapshotMock,
  addDoc: addMock,
  updateDoc: updateMock,
  deleteDoc: deleteMock,
}))

const examples = [
  { id: 'income1', type: 'income', name: 'Salary', icon: 'payments', color: '#4caf50', budget: 0 },
  {
    id: 'expense1',
    type: 'expense',
    name: 'Groceries',
    icon: 'shopping_cart',
    color: '#f44336',
    budget: 200,
  },
  {
    id: 'expense2',
    type: 'expense',
    name: 'Transport',
    icon: 'directions_bus',
    color: '#2196f3',
    budget: 100,
  },
]
const snapshotOf = (items) => ({
  docs: items.map(({ id, ...data }) => ({ id, data: () => ({ ...data }) })),
})
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

// Simulate a real subscription: retain callbacks and emit snapshots on demand.
let subscriptions
let store
let collectionRef

beforeEach(() => {
  vi.resetAllMocks()
  setActivePinia(createPinia())
  authMock.currentUser = { uid: 'user123' }
  collectionRef = { path: 'users/user123/categories' }
  collectionMock.mockReturnValue(collectionRef)
  docMock.mockImplementation((_db, path) => ({ path }))
  addMock.mockResolvedValue({ id: 'saved1' })
  updateMock.mockResolvedValue(undefined)
  deleteMock.mockResolvedValue(undefined)
  subscriptions = []
  snapshotMock.mockImplementation((ref, next, error) => {
    const subscription = { ref, next, error, unsubscribe: vi.fn() }
    subscriptions.push(subscription)
    return subscription.unsubscribe
  })
  store = useCategoryStore()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const seed = () => {
  store.categories = examples.map((item) => ({ ...item }))
}
const emit = (items, index = subscriptions.length - 1) =>
  subscriptions[index].next(snapshotOf(items))
const fail = (error, index = subscriptions.length - 1) => subscriptions[index].error(error)

// CRUD methods currently start Firestore promises but do not await them.
describe('categoryStore initial state and derived categories', () => {
  it('starts empty and not loading', () => {
    expect(store.categories).toEqual([])
    expect(store.loading).toBe(false)
    expect(store.incomeCategories).toEqual([])
    expect(store.expenseCategories).toEqual([])
  })

  it('filters income and expense categories reactively', () => {
    seed()
    expect(store.incomeCategories.map((c) => c.id)).toEqual(['income1'])
    expect(store.expenseCategories.map((c) => c.id)).toEqual(['expense1', 'expense2'])
    store.categories.push({ id: 'income2', type: 'income', name: 'Bonus' })
    expect(store.incomeCategories.map((c) => c.id)).toEqual(['income1', 'income2'])
    store.categories.splice(1, 1)
    expect(store.expenseCategories.map((c) => c.id)).toEqual(['expense2'])
  })
})

describe('listenCategories', () => {
  it('subscribes to the authenticated user collection and loads snapshots', () => {
    store.listenCategories()
    expect(collectionMock).toHaveBeenCalledWith(dbMock, 'users/user123/categories')
    expect(snapshotMock).toHaveBeenCalledWith(
      collectionRef,
      expect.any(Function),
      expect.any(Function),
    )
    expect(store.loading).toBe(true)
    emit(examples)
    expect(store.categories).toEqual(examples)
    expect(store.loading).toBe(false)
    emit([])
    expect(store.categories).toEqual([])
  })

  it('does not subscribe when signed out', () => {
    authMock.currentUser = null
    store.listenCategories()
    expect(collectionMock).not.toHaveBeenCalled()
    expect(snapshotMock).not.toHaveBeenCalled()
    expect(store.loading).toBe(false)
  })

  it('clears loading and logs subscription errors', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    store.listenCategories()
    const error = new Error('Offline')
    fail(error)
    expect(spy).toHaveBeenCalledWith('Error fetching categories:', error)
    expect(store.loading).toBe(false)
  })

  it('unsubscribes the previous listener before replacing it', () => {
    store.listenCategories()
    store.listenCategories()
    expect(subscriptions).toHaveLength(2)
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce()
    expect(subscriptions[1].unsubscribe).not.toHaveBeenCalled()
  })
})

describe('fetchCategories', () => {
  it('remains pending until the first snapshot and then resolves', async () => {
    let resolved = false
    const promise = store.fetchCategories().then(() => {
      resolved = true
    })
    await flush()
    expect(resolved).toBe(false)
    expect(store.loading).toBe(true)
    emit(examples)
    await promise
    expect(resolved).toBe(true)
    expect(store.categories).toEqual(examples)
    expect(store.loading).toBe(false)
  })

  it('resolves without subscribing when signed out', async () => {
    authMock.currentUser = null
    await expect(store.fetchCategories()).resolves.toBeUndefined()
    expect(snapshotMock).not.toHaveBeenCalled()
  })

  it('resolves on a Firestore error and clears loading', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const promise = store.fetchCategories()
    const error = new Error('Fetch failed')
    fail(error)
    await expect(promise).resolves.toBeUndefined()
    expect(store.loading).toBe(false)
    expect(spy).toHaveBeenCalledWith('Error fetching categories:', error)
  })

  it('replaces an existing subscription', async () => {
    store.listenCategories()
    const promise = store.fetchCategories()
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce()
    emit(examples)
    await promise
    expect(store.categories).toEqual(examples)
  })
})

describe('addCategory', () => {
  it('optimistically inserts defaults and persists the exact payload', async () => {
    await store.addCategory({ type: 'expense', name: 'Other' })
    const payload = {
      type: 'expense',
      name: 'Other',
      icon: 'category',
      color: '#111111',
      budget: 0,
    }
    expect(store.categories).toHaveLength(1)
    expect(store.categories[0]).toMatchObject(payload)
    expect(store.categories[0].id).toMatch(/^temp_/)
    expect(addMock).toHaveBeenCalledWith(collectionRef, payload)
    await flush()
    expect(store.categories[0].id).toBe('saved1')
  })

  it('preserves explicitly provided fields', async () => {
    const payload = {
      type: 'income',
      name: 'Freelance',
      icon: 'work',
      color: '#abcdef',
      budget: 125,
    }
    await store.addCategory(payload)
    expect(addMock).toHaveBeenCalledWith(collectionRef, payload)
  })

  it('does not add a category when signed out', async () => {
    authMock.currentUser = null
    await store.addCategory({ type: 'expense', name: 'Other' })
    expect(store.categories).toEqual([])
    expect(addMock).not.toHaveBeenCalled()
  })

  it('currently keeps an optimistic category if persistence fails', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('Write failed')
    addMock.mockRejectedValue(error)
    await store.addCategory({ type: 'expense', name: 'Other' })
    await vi.waitFor(() =>
      expect(spy).toHaveBeenCalledWith('[Firestore] Category write queued:', error),
    )
    expect(store.categories[0].id).toMatch(/^temp_/)
  })
})

describe('updateCategory', () => {
  beforeEach(seed)

  it('updates local state and sends the expected Firestore payload', async () => {
    const payload = {
      type: 'expense',
      name: 'Food',
      icon: 'restaurant',
      color: '#ff9800',
      budget: 450,
    }
    await store.updateCategory('expense1', payload)
    expect(store.categories.find((c) => c.id === 'expense1')).toMatchObject(payload)
    expect(docMock).toHaveBeenCalledWith(dbMock, 'users/user123/categories/expense1')
    expect(updateMock).toHaveBeenCalledWith({ path: 'users/user123/categories/expense1' }, payload)
  })

  it('defaults a missing budget to zero', async () => {
    await store.updateCategory('expense1', {
      type: 'expense',
      name: 'Food',
      icon: 'restaurant',
      color: '#aaa',
    })
    expect(store.categories[1].budget).toBe(0)
    expect(updateMock.mock.calls[0][1].budget).toBe(0)
  })

  it('does not update when signed out', async () => {
    authMock.currentUser = null
    await store.updateCategory('expense1', { name: 'Changed' })
    expect(store.categories[1].name).toBe('Groceries')
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('currently attempts persistence even if the category is absent locally', async () => {
    await store.updateCategory('missing', { type: 'expense', name: 'Missing', budget: 1 })
    expect(store.categories).toHaveLength(3)
    expect(updateMock).toHaveBeenCalledOnce()
  })

  it('currently retains the optimistic change after Firestore rejects it', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('Update failed')
    updateMock.mockRejectedValue(error)
    await store.updateCategory('expense1', { type: 'expense', name: 'Food', budget: 50 })
    await vi.waitFor(() =>
      expect(spy).toHaveBeenCalledWith('[Firestore] Category update queued:', error),
    )
    expect(store.categories[1].name).toBe('Food')
  })
})

describe('deleteCategory', () => {
  beforeEach(seed)

  it('removes locally and deletes from the correct Firestore path', async () => {
    await store.deleteCategory('expense1')
    expect(store.categories.map((c) => c.id)).toEqual(['income1', 'expense2'])
    expect(docMock).toHaveBeenCalledWith(dbMock, 'users/user123/categories/expense1')
    expect(deleteMock).toHaveBeenCalledWith({ path: 'users/user123/categories/expense1' })
  })

  it('does nothing when signed out', async () => {
    authMock.currentUser = null
    await store.deleteCategory('expense1')
    expect(store.categories).toHaveLength(3)
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('currently sends a delete request even if the ID is not in local state', async () => {
    await store.deleteCategory('missing')
    expect(store.categories).toHaveLength(3)
    expect(deleteMock).toHaveBeenCalledWith({ path: 'users/user123/categories/missing' })
  })

  it('currently retains optimistic removal after a rejected delete', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('Delete failed')
    deleteMock.mockRejectedValue(error)
    await store.deleteCategory('expense1')
    await vi.waitFor(() =>
      expect(spy).toHaveBeenCalledWith('[Firestore] Category delete queued:', error),
    )
    expect(store.categories.some((c) => c.id === 'expense1')).toBe(false)
  })
})

describe('monthly budgets', () => {
  beforeEach(seed)

  it('creates a budget map and persists a month-specific field', async () => {
    await store.setMonthlyBudget('expense1', '2026-10', 400)
    expect(store.categories[1].budgets).toEqual({ '2026-10': 400 })
    expect(updateMock).toHaveBeenCalledWith(
      { path: 'users/user123/categories/expense1' },
      { 'budgets.2026-10': 400 },
    )
  })

  it('replaces one month without changing other months', async () => {
    store.categories[1].budgets = { '2026-09': 200, '2026-10': 300 }
    await store.setMonthlyBudget('expense1', '2026-10', 450)
    expect(store.categories[1].budgets).toEqual({ '2026-09': 200, '2026-10': 450 })
  })

  it.each([0, -100, 0.5])('currently accepts the budget boundary/input %s', async (amount) => {
    await store.setMonthlyBudget('expense1', '2026-10', amount)
    expect(store.categories[1].budgets['2026-10']).toBe(amount)
    expect(updateMock).toHaveBeenCalledWith(expect.anything(), { 'budgets.2026-10': amount })
  })

  it('does not modify state or Firestore when signed out', async () => {
    authMock.currentUser = null
    await store.setMonthlyBudget('expense1', '2026-10', 400)
    expect(store.categories[1].budgets).toBeUndefined()
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('currently attempts Firestore update for a category absent locally', async () => {
    await store.setMonthlyBudget('missing', '2026-10', 400)
    expect(store.categories).toHaveLength(3)
    expect(updateMock).toHaveBeenCalledWith(
      { path: 'users/user123/categories/missing' },
      { 'budgets.2026-10': 400 },
    )
  })

  it('logs rejected budget writes and keeps the optimistic value', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('Budget failed')
    updateMock.mockRejectedValue(error)
    await store.setMonthlyBudget('expense1', '2026-10', 400)
    await vi.waitFor(() =>
      expect(spy).toHaveBeenCalledWith('[Firestore] Budget update queued:', error),
    )
    expect(store.categories[1].budgets['2026-10']).toBe(400)
  })

  it('reads the selected monthly budget', () => {
    expect(store.getMonthlyBudget({ budgets: { '2026-09': 200, '2026-10': 400 } }, '2026-10')).toBe(
      400,
    )
  })

  it('returns null for missing budgets or months', () => {
    expect(store.getMonthlyBudget({}, '2026-10')).toBeNull()
    expect(store.getMonthlyBudget({ budgets: { '2026-09': 200 } }, '2026-10')).toBeNull()
  })

  it('currently treats an explicit zero budget as missing (potential defect)', () => {
    expect(store.getMonthlyBudget({ budgets: { '2026-10': 0 } }, '2026-10')).toBeNull()
  })
})

describe('stopListening', () => {
  it('unsubscribes once and safely handles repeated stops', () => {
    store.listenCategories()
    store.stopListening()
    store.stopListening()
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not throw when there is no listener', () => {
    expect(() => store.stopListening()).not.toThrow()
  })
})
