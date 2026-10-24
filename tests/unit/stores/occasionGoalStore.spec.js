import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useOccasionGoalStore } from '/src/stores/occasionGoalStore'

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
  mockCollection: vi.fn(() => ({ path: 'users/user-123/occasionGoals' })),
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

// Match the import used by the store so the real Firebase setup is not loaded.
vi.mock('/src/boot/firebase', () => ({
  firestore: mockFirestore,
  auth: mockAuth,
}))

import { auth } from '/src/boot/firebase'

describe('useOccasionGoalStore', () => {
  let store
  let unsubscribe

  beforeEach(() => {
    setActivePinia(createPinia())
    auth.currentUser = { uid: 'user-123' }
    unsubscribe = vi.fn()

    vi.clearAllMocks()
    mockOnSnapshot.mockReturnValue(unsubscribe)
    mockAddDoc.mockResolvedValue({ id: 'saved-goal-id' })
    mockUpdateDoc.mockResolvedValue(undefined)
    mockDeleteDoc.mockResolvedValue(undefined)

    store = useOccasionGoalStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('starts with an empty goals list and loading disabled', () => {
    expect(store.goals).toEqual([])
    expect(store.loading).toBe(false)
    expect(store.activeGoals).toEqual([])
    expect(store.completedGoals).toEqual([])
    expect(store.totalMonthlyNeeded).toBe(0)
    expect(store.upcomingGoals).toEqual([])
  })

  it('does not listen when no user is signed in', () => {
    auth.currentUser = null

    store.listenGoals()

    expect(mockCollection).not.toHaveBeenCalled()
    expect(mockOnSnapshot).not.toHaveBeenCalled()
  })

  it('listens to goals and sorts the snapshot by target date', () => {
    store.listenGoals()

    expect(mockCollection).toHaveBeenCalledWith(mockFirestore, 'users/user-123/occasionGoals')
    expect(store.loading).toBe(true)

    const snapshotCallback = mockOnSnapshot.mock.calls[0][1]
    snapshotCallback({
      docs: [
        {
          id: 'goal-later',
          data: () => ({ name: 'Later', targetDate: '2027-06-01' }),
        },
        {
          id: 'goal-sooner',
          data: () => ({ name: 'Sooner', targetDate: '2027-01-01' }),
        },
      ],
    })

    expect(store.goals.map((goal) => goal.id)).toEqual(['goal-sooner', 'goal-later'])
    expect(store.loading).toBe(false)
  })

  it('logs listener errors and clears loading', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('snapshot failed')

    store.listenGoals()
    mockOnSnapshot.mock.calls[0][2](error)

    expect(consoleError).toHaveBeenCalledWith('Error fetching goals:', error)
    expect(store.loading).toBe(false)
  })

  it('unsubscribes from the previous listener before listening again', () => {
    store.listenGoals()
    store.listenGoals()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(mockOnSnapshot).toHaveBeenCalledTimes(2)
  })

  it('computes active goals in target-date order and completed goals by newest creation date', () => {
    store.goals = [
      { id: 'active-later', targetDate: '2027-05-01', completed: false },
      { id: 'completed-old', completed: true, createdAt: 100 },
      { id: 'active-sooner', targetDate: '2027-01-01', completed: false },
      { id: 'completed-new', completed: true, createdAt: 300 },
    ]

    expect(store.activeGoals.map((goal) => goal.id)).toEqual(['active-sooner', 'active-later'])
    expect(store.completedGoals.map((goal) => goal.id)).toEqual(['completed-new', 'completed-old'])
  })

  it('calculates the monthly amount needed for active goals', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00'))

    store.goals = [
      {
        id: 'goal-one',
        completed: false,
        targetDate: '2026-04-15',
        targetAmount: 300,
        currentSaved: 0,
      },
      {
        id: 'goal-two',
        completed: false,
        targetDate: '2026-03-15',
        targetAmount: 200,
        currentSaved: 50,
      },
      {
        id: 'completed-goal',
        completed: true,
        targetDate: '2026-04-15',
        targetAmount: 900,
        currentSaved: 0,
      },
    ]

    // Goal one: 300 / 3 months; goal two: 150 / 2 months = 175 total.
    expect(store.totalMonthlyNeeded).toBe(175)
  })

  it('adds a goal optimistically and replaces its temporary ID', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345)

    await store.addGoal({
      name: 'Holiday',
      targetDate: '2027-06-01',
      targetAmount: 1000,
    })
    await Promise.resolve()

    expect(store.goals).toEqual([
      {
        id: 'saved-goal-id',
        name: 'Holiday',
        type: 'custom',
        targetDate: '2027-06-01',
        targetAmount: 1000,
        currentSaved: 0,
        contributions: [],
        completed: false,
        createdAt: 12345,
      },
    ])
    expect(mockAddDoc).toHaveBeenCalledWith(
      { path: 'users/user-123/occasionGoals' },
      expect.objectContaining({
        name: 'Holiday',
        targetAmount: 1000,
      }),
    )
  })

  it('does not add a goal when no user is signed in', async () => {
    auth.currentUser = null

    await store.addGoal({ name: 'Holiday' })

    expect(store.goals).toEqual([])
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('updates a goal optimistically and writes the changes to Firestore', async () => {
    store.goals = [{ id: 'goal-1', name: 'Old name', targetAmount: 100 }]

    await store.updateGoal('goal-1', {
      name: 'New name',
      targetAmount: 200,
    })

    expect(store.goals[0]).toMatchObject({
      name: 'New name',
      targetAmount: 200,
    })
    expect(mockDoc).toHaveBeenCalledWith(mockFirestore, 'users/user-123/occasionGoals/goal-1')
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { path: 'users/user-123/occasionGoals/goal-1' },
      { name: 'New name', targetAmount: 200 },
    )
  })

  it('deletes a goal optimistically and calls deleteDoc', async () => {
    store.goals = [{ id: 'keep' }, { id: 'remove' }]

    await store.deleteGoal('remove')

    expect(store.goals).toEqual([{ id: 'keep' }])
    expect(mockDeleteDoc).toHaveBeenCalledWith({
      path: 'users/user-123/occasionGoals/remove',
    })
  })

  it('adds a contribution and marks a goal completed when its target is reached', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(555)

    store.goals = [
      {
        id: 'goal-1',
        targetAmount: 100,
        currentSaved: 60,
        contributions: [],
        completed: false,
      },
    ]

    await store.addContribution('goal-1', {
      amount: 40,
      date: '2026-10-21',
      notes: 'Monthly savings',
    })

    expect(store.goals[0]).toMatchObject({
      currentSaved: 100,
      completed: true,
      contributions: [
        {
          amount: 40,
          date: '2026-10-21',
          notes: 'Monthly savings',
          createdAt: 555,
        },
      ],
    })
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { path: 'users/user-123/occasionGoals/goal-1' },
      expect.objectContaining({
        currentSaved: 100,
        completed: true,
      }),
    )
  })

  it('does not add a contribution if signed out or the goal does not exist', async () => {
    store.goals = [
      {
        id: 'goal-1',
        targetAmount: 100,
        currentSaved: 0,
        contributions: [],
      },
    ]

    auth.currentUser = null
    await store.addContribution('goal-1', { amount: 10 })

    auth.currentUser = { uid: 'user-123' }
    await store.addContribution('missing-goal', { amount: 10 })

    expect(mockUpdateDoc).not.toHaveBeenCalled()
    expect(store.goals[0].currentSaved).toBe(0)
  })

  it('deletes a contribution and recalculates saved amount and completion', async () => {
    store.goals = [
      {
        id: 'goal-1',
        targetAmount: 100,
        currentSaved: 120,
        completed: true,
        contributions: [{ amount: 70 }, { amount: 50 }],
      },
    ]

    await store.deleteContribution('goal-1', 1)

    expect(store.goals[0]).toMatchObject({
      currentSaved: 70,
      completed: false,
      contributions: [{ amount: 70 }],
    })
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { path: 'users/user-123/occasionGoals/goal-1' },
      expect.objectContaining({
        currentSaved: 70,
        completed: false,
      }),
    )
  })

  it('does not update contributions when signed out or the goal does not exist', async () => {
    store.goals = [
      {
        id: 'goal-1',
        targetAmount: 100,
        currentSaved: 10,
        contributions: [],
      },
    ]

    auth.currentUser = null
    await store.deleteContribution('goal-1', 0)

    auth.currentUser = { uid: 'user-123' }
    await store.deleteContribution('missing-goal', 0)

    expect(mockUpdateDoc).not.toHaveBeenCalled()
    expect(store.goals[0].currentSaved).toBe(10)
  })

  it('fetches goals and resolves after the first snapshot', async () => {
    const fetchPromise = store.fetchGoals()

    expect(store.loading).toBe(true)

    mockOnSnapshot.mock.calls[0][1]({
      docs: [
        {
          id: 'goal-1',
          data: () => ({
            name: 'Trip',
            targetDate: '2027-01-01',
          }),
        },
      ],
    })

    await fetchPromise

    expect(store.goals).toEqual([
      {
        id: 'goal-1',
        name: 'Trip',
        targetDate: '2027-01-01',
      },
    ])
    expect(store.loading).toBe(false)
  })

  it('resolves fetchGoals without listening when signed out', async () => {
    auth.currentUser = null

    await expect(store.fetchGoals()).resolves.toBeUndefined()
    expect(mockOnSnapshot).not.toHaveBeenCalled()
  })

  it('resolves fetchGoals and clears loading when the snapshot errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('fetch failed')
    const fetchPromise = store.fetchGoals()

    mockOnSnapshot.mock.calls[0][2](error)
    await fetchPromise

    expect(consoleError).toHaveBeenCalledWith('Error fetching goals:', error)
    expect(store.loading).toBe(false)
  })

  it('stops listening and clears the unsubscribe callback', () => {
    store.listenGoals()

    store.stopListening()
    store.stopListening()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
