import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useNoteStore } from '/src/stores/noteStore'

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
  mockCollection: vi.fn(() => ({
    path: 'users/user-123/notes',
  })),
  mockDoc: vi.fn((...args) => ({
    path: args.at(-1),
  })),
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

// Mock Firebase initialisation so the real configuration is not loaded.
vi.mock('/src/boot/firebase', () => ({
  firestore: mockFirestore,
  auth: mockAuth,
}))

import { auth } from '/src/boot/firebase'

describe('useNoteStore', () => {
  let store
  let unsubscribe

  beforeEach(() => {
    setActivePinia(createPinia())

    auth.currentUser = { uid: 'user-123' }

    unsubscribe = vi.fn()

    vi.clearAllMocks()

    mockOnSnapshot.mockReturnValue(unsubscribe)
    mockAddDoc.mockResolvedValue({ id: 'saved-note-id' })
    mockUpdateDoc.mockResolvedValue(undefined)
    mockDeleteDoc.mockResolvedValue(undefined)

    store = useNoteStore()
  })

  it('starts with an empty notes list and loading disabled', () => {
    expect(store.notes).toEqual([])
    expect(store.loading).toBe(false)
  })

  it('does not listen when no user is signed in', () => {
    auth.currentUser = null

    store.listenNotes()

    expect(mockCollection).not.toHaveBeenCalled()
    expect(mockOnSnapshot).not.toHaveBeenCalled()
  })

  it('subscribes to the signed-in user notes and sorts newest first', () => {
    store.listenNotes()

    const snapshotCallback = mockOnSnapshot.mock.calls[0][1]

    expect(mockCollection).toHaveBeenCalledWith(mockFirestore, 'users/user-123/notes')
    expect(store.loading).toBe(true)

    snapshotCallback({
      docs: [
        {
          id: 'older',
          data: () => ({ title: 'Older', createdAt: 100 }),
        },
        {
          id: 'newer',
          data: () => ({ title: 'Newer', createdAt: 300 }),
        },
        {
          id: 'middle',
          data: () => ({ title: 'Middle', createdAt: 200 }),
        },
      ],
    })

    expect(store.notes.map((note) => note.id)).toEqual(['newer', 'middle', 'older'])
    expect(store.loading).toBe(false)
  })

  it('logs snapshot errors and clears loading', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const error = new Error('snapshot failed')

    store.listenNotes()

    const errorCallback = mockOnSnapshot.mock.calls[0][2]
    errorCallback(error)

    expect(consoleError).toHaveBeenCalledWith('Error fetching notes:', error)
    expect(store.loading).toBe(false)

    consoleError.mockRestore()
  })

  it('unsubscribes from the previous listener before starting a new one', () => {
    store.listenNotes()
    store.listenNotes()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(mockOnSnapshot).toHaveBeenCalledTimes(2)
  })

  it('adds a note optimistically and replaces its temporary id after saving', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(12345)

    await store.addNote({
      title: 'Shopping',
      description: 'Buy milk',
    })

    expect(store.notes).toEqual([
      {
        id: 'saved-note-id',
        title: 'Shopping',
        description: 'Buy milk',
        pinned: false,
        createdAt: 12345,
      },
    ])

    expect(mockAddDoc).toHaveBeenCalledWith(
      { path: 'users/user-123/notes' },
      {
        title: 'Shopping',
        description: 'Buy milk',
        pinned: false,
        createdAt: 12345,
      },
    )

    vi.restoreAllMocks()
  })

  it('does not add a note when no user is signed in', async () => {
    auth.currentUser = null

    await store.addNote({ title: 'Shopping' })

    expect(store.notes).toEqual([])
    expect(mockAddDoc).not.toHaveBeenCalled()
  })

  it('updates a note optimistically and writes the changes to Firestore', async () => {
    store.notes = [
      {
        id: 'note-1',
        title: 'Old title',
        description: 'Old description',
      },
    ]

    await store.updateNote('note-1', {
      title: 'New title',
    })

    expect(store.notes[0]).toMatchObject({
      title: 'New title',
      description: '',
    })

    expect(mockDoc).toHaveBeenCalledWith(mockFirestore, 'users/user-123/notes/note-1')

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { path: 'users/user-123/notes/note-1' },
      {
        title: 'New title',
        description: '',
      },
    )
  })

  it('does not update a note when no user is signed in', async () => {
    auth.currentUser = null

    await store.updateNote('note-1', {
      title: 'Updated',
    })

    expect(mockUpdateDoc).not.toHaveBeenCalled()
  })

  it('deletes a note optimistically and calls deleteDoc', async () => {
    store.notes = [
      { id: 'note-1', title: 'Keep' },
      { id: 'note-2', title: 'Delete' },
    ]

    await store.deleteNote('note-2')

    expect(store.notes).toEqual([{ id: 'note-1', title: 'Keep' }])

    expect(mockDoc).toHaveBeenCalledWith(mockFirestore, 'users/user-123/notes/note-2')

    expect(mockDeleteDoc).toHaveBeenCalledWith({
      path: 'users/user-123/notes/note-2',
    })
  })

  it('toggles a note pin optimistically and updates Firestore', async () => {
    store.notes = [
      {
        id: 'note-1',
        title: 'Pinned note',
        pinned: false,
      },
    ]

    await store.togglePin('note-1', false)

    expect(store.notes[0].pinned).toBe(true)

    expect(mockUpdateDoc).toHaveBeenCalledWith(
      { path: 'users/user-123/notes/note-1' },
      { pinned: true },
    )
  })

  it('stops listening and clears the unsubscribe callback', () => {
    store.listenNotes()

    store.stopListening()
    store.stopListening()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
