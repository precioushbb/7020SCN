import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMarketListStore } from '/src/stores/marketListStore'

const {
  mockCollection,
  mockDoc,
  mockOnSnapshot,
  mockSetDoc,
  mockUpdateDoc,
  mockDeleteDoc,
  mockDeleteField,
  mockAuth,
  mockFirestore,
} = vi.hoisted(() => ({
  mockCollection: vi.fn(),
  mockDoc: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockSetDoc: vi.fn(),
  mockUpdateDoc: vi.fn(),
  mockDeleteDoc: vi.fn(),
  mockDeleteField: vi.fn(),
  mockAuth: { currentUser: { uid: 'test-user' } },
  mockFirestore: { name: 'mock-firestore' },
}))

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    collection: mockCollection,
    doc: mockDoc,
    onSnapshot: mockOnSnapshot,
    setDoc: mockSetDoc,
    updateDoc: mockUpdateDoc,
    deleteDoc: mockDeleteDoc,
    deleteField: mockDeleteField,
  }
})

vi.mock('/src/boot/firebase', () => ({
  firestore: mockFirestore,
  auth: mockAuth,
}))

const makeList = (overrides = {}) => ({
  id: 'list-1',
  name: 'Groceries',
  date: '2026-10-21',
  createdAt: 100,
  convertedAt: null,
  items: [],
  ...overrides,
})

const makeSnapshot = (documents) => ({
  docs: documents.map(({ id, ...data }) => ({
    id,
    data: () => data,
  })),
})

describe('useMarketListStore', () => {
  let store
  let snapshotNext
  let snapshotError
  let mockUnsubscribe

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useMarketListStore()

    mockAuth.currentUser = { uid: 'test-user' }
    mockCollection.mockReset().mockReturnValue({ path: 'users/test-user/marketLists' })
    mockDoc.mockReset().mockImplementation((...args) => ({
      id: 'generated-list-id',
      args,
    }))
    mockSetDoc.mockReset().mockResolvedValue(undefined)
    mockUpdateDoc.mockReset().mockResolvedValue(undefined)
    mockDeleteDoc.mockReset().mockResolvedValue(undefined)
    mockDeleteField.mockReset().mockReturnValue({ fieldValue: 'delete-field' })
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
    vi.spyOn(Date, 'now').mockReturnValue(1792600000000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initial state and list totals', () => {
    it('starts with an empty list and loading disabled', () => {
      expect(store.lists).toEqual([])
      expect(store.loading).toBe(false)
    })

    it('calculates the total price of items in a list', () => {
      store.lists = [
        makeList({
          id: 'groceries',
          items: [
            { id: '1', name: 'Rice', price: 2500 },
            { id: '2', name: 'Milk', price: 1200 },
            { id: '3', name: 'Bread' },
          ],
        }),
      ]

      expect(store.getListTotal('groceries')).toBe(3700)
    })

    it('returns zero when calculating the total for an unknown list', () => {
      expect(store.getListTotal('missing-list')).toBe(0)
    })
  })

  describe('listenLists', () => {
    it('subscribes to Firestore and maps list documents and items', () => {
      store.listenLists()

      expect(store.loading).toBe(true)
      expect(mockCollection).toHaveBeenCalledWith(mockFirestore, 'users/test-user/marketLists')
      expect(mockOnSnapshot).toHaveBeenCalled()

      snapshotNext(
        makeSnapshot([
          {
            id: 'list-1',
            name: 'Groceries',
            date: '2026-10-21',
            createdAt: 100,
            items: {
              itemA: { name: 'Apples', price: 300, createdAt: 10 },
              itemB: { name: 'Rice', price: 900, createdAt: 20 },
            },
          },
        ]),
      )

      expect(store.loading).toBe(false)
      expect(store.lists).toHaveLength(1)
      expect(store.lists[0]).toMatchObject({
        id: 'list-1',
        name: 'Groceries',
        date: '2026-10-21',
        createdAt: 100,
        convertedAt: null,
      })
      expect(store.lists[0].items.map((item) => item.id)).toEqual(['itemB', 'itemA'])
    })

    it('sorts lists by createdAt in descending order', () => {
      store.listenLists()

      snapshotNext(
        makeSnapshot([
          { id: 'older', name: 'Older', createdAt: 10, items: {} },
          { id: 'newer', name: 'Newer', createdAt: 30, items: {} },
        ]),
      )

      expect(store.lists.map((list) => list.id)).toEqual(['newer', 'older'])
    })

    it('handles lists without items', () => {
      store.listenLists()
      snapshotNext(makeSnapshot([{ id: 'empty', name: 'Empty', createdAt: 10 }]))

      expect(store.lists[0].items).toEqual([])
      expect(store.loading).toBe(false)
    })

    it('does not subscribe when no user is authenticated', () => {
      mockAuth.currentUser = null

      store.listenLists()

      expect(mockCollection).not.toHaveBeenCalled()
      expect(mockOnSnapshot).not.toHaveBeenCalled()
      expect(store.loading).toBe(false)
    })

    it('logs snapshot errors and clears loading', () => {
      store.listenLists()
      const error = new Error('snapshot failed')

      snapshotError(error)

      expect(console.error).toHaveBeenCalledWith('Error fetching market lists:', error)
      expect(store.loading).toBe(false)
    })

    it('unsubscribes from the previous listener before subscribing again', () => {
      store.listenLists()
      store.listenLists()

      expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
    })
  })

  describe('addList', () => {
    it('creates a list optimistically and writes it to Firestore', async () => {
      const id = await store.addList({ name: 'Weekly shopping' })

      expect(id).toBe('generated-list-id')
      expect(store.lists).toHaveLength(1)
      expect(store.lists[0]).toMatchObject({
        id: 'generated-list-id',
        name: 'Weekly shopping',
        convertedAt: null,
        items: [],
      })
      expect(mockDoc).toHaveBeenCalledWith({ path: 'users/test-user/marketLists' })
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'generated-list-id' }),
        expect.objectContaining({
          name: 'Weekly shopping',
          date: expect.any(String),
          createdAt: 1792600000000,
          items: {},
        }),
      )
    })

    it('returns null and does not write when unauthenticated', async () => {
      mockAuth.currentUser = null

      await expect(store.addList({ name: 'Shopping' })).resolves.toBeNull()

      expect(store.lists).toEqual([])
      expect(mockSetDoc).not.toHaveBeenCalled()
    })

    it('handles a failed Firestore write without removing the optimistic list', async () => {
      mockSetDoc.mockRejectedValueOnce(new Error('offline'))

      await store.addList({ name: 'Offline list' })
      await Promise.resolve()

      expect(store.lists[0].name).toBe('Offline list')
      expect(console.warn).toHaveBeenCalledWith('[Firestore] List write queued:', expect.any(Error))
    })
  })

  describe('updateList and deleteList', () => {
    beforeEach(() => {
      store.lists = [makeList(), makeList({ id: 'list-2', name: 'Old name' })]
    })

    it('updates list data optimistically and persists the change', async () => {
      await store.updateList('list-1', { name: 'Updated groceries' })

      expect(store.lists[0].name).toBe('Updated groceries')
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({
          args: [mockFirestore, 'users/test-user/marketLists/list-1'],
        }),
        { name: 'Updated groceries' },
      )
    })

    it('deletes a list optimistically and from Firestore', async () => {
      await store.deleteList('list-1')

      expect(store.lists.map((list) => list.id)).toEqual(['list-2'])
      expect(mockDeleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({
          args: [mockFirestore, 'users/test-user/marketLists/list-1'],
        }),
      )
    })

    it('does not update or delete lists when unauthenticated', async () => {
      mockAuth.currentUser = null

      await store.updateList('list-1', { name: 'Changed' })
      await store.deleteList('list-1')

      expect(store.lists).toHaveLength(2)
      expect(mockUpdateDoc).not.toHaveBeenCalled()
      expect(mockDeleteDoc).not.toHaveBeenCalled()
    })

    it('does not fail when updating an ID not present in local state', async () => {
      await store.updateList('missing', { name: 'Missing' })

      expect(mockUpdateDoc).toHaveBeenCalled()
      expect(store.lists).toHaveLength(2)
    })
  })

  describe('items', () => {
    beforeEach(() => {
      store.lists = [
        makeList({
          id: 'list-1',
          items: [
            { id: 'item-1', name: 'Apples', quantity: '2', price: 500, bought: false },
            { id: 'item-2', name: 'Milk', quantity: '1', price: 300, bought: false },
          ],
        }),
      ]
    })

    it('adds an item optimistically and writes it to Firestore', async () => {
      await store.addItem('list-1', {
        name: 'Bread',
        quantity: '2 loaves',
        price: 250,
      })

      expect(store.lists[0].items[0]).toMatchObject({
        id: '1792600000000',
        name: 'Bread',
        quantity: '2 loaves',
        price: 250,
        bought: false,
        createdAt: 1792600000000,
      })
      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.any(Object), {
        'items.1792600000000': expect.objectContaining({
          name: 'Bread',
          quantity: '2 loaves',
          price: 250,
          bought: false,
        }),
      })
    })

    it('uses defaults for missing quantity and price', async () => {
      await store.addItem('list-1', { name: 'Eggs' })

      expect(store.lists[0].items[0]).toMatchObject({
        name: 'Eggs',
        quantity: '',
        price: 0,
        bought: false,
      })
    })

    it('does not write items when unauthenticated', async () => {
      mockAuth.currentUser = null

      await store.addItem('list-1', { name: 'Eggs', price: 100 })

      expect(store.lists[0].items).toHaveLength(2)
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })

    it('updates an item optimistically and uses dotted Firestore fields', async () => {
      await store.updateItem('list-1', 'item-1', {
        name: 'Green apples',
        price: 650,
      })

      expect(store.lists[0].items[0]).toMatchObject({
        name: 'Green apples',
        price: 650,
      })
      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.any(Object), {
        'items.item-1.name': 'Green apples',
        'items.item-1.price': 650,
      })
    })

    it('toggles the bought state locally and in Firestore', async () => {
      await store.toggleBought('list-1', 'item-1', false)

      expect(store.lists[0].items[0].bought).toBe(true)
      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.any(Object), {
        'items.item-1.bought': true,
      })
    })

    it('removes an item locally and marks its Firestore field for deletion', async () => {
      await store.removeItem('list-1', 'item-1')

      expect(store.lists[0].items.map((item) => item.id)).toEqual(['item-2'])
      expect(mockDeleteField).toHaveBeenCalled()
      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.any(Object), {
        'items.item-1': { fieldValue: 'delete-field' },
      })
    })

    it('does not update items when unauthenticated', async () => {
      mockAuth.currentUser = null

      await store.updateItem('list-1', 'item-1', { price: 800 })
      await store.toggleBought('list-1', 'item-1', false)
      await store.removeItem('list-1', 'item-1')

      expect(store.lists[0].items[0].price).toBe(500)
      expect(store.lists[0].items).toHaveLength(2)
      expect(mockUpdateDoc).not.toHaveBeenCalled()
    })

    it('handles an item ID that is not present in local state', async () => {
      await store.updateItem('list-1', 'missing-item', { price: 100 })
      await store.toggleBought('list-1', 'missing-item', false)
      await store.removeItem('list-1', 'missing-item')

      expect(mockUpdateDoc).toHaveBeenCalledTimes(3)
      expect(store.lists[0].items).toHaveLength(2)
    })
  })

  describe('stopListening', () => {
    it('unsubscribes and clears the active listener', () => {
      store.listenLists()

      store.stopListening()
      store.stopListening()

      expect(mockUnsubscribe).toHaveBeenCalledTimes(1)
    })
  })
})
