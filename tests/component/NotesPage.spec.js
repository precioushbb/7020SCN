import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import * as QuasarComponents from 'quasar'
import NotesPage from '/src/pages/NotesPage.vue'

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
const mockNoteStore = makeStore(
  ['listenNotes', 'stopListening', 'addNote', 'updateNote', 'deleteNote'],
  { notes: [] },
)
vi.mock('stores/noteStore', () => ({ useNoteStore: () => mockNoteStore }))
const mockSettingsStore = {
  language: 'en',
  currency: '$',
  formatNumber: (n) => String(n),
  formatDate: (d) => d,
}
vi.mock('stores/settingsStore', () => ({ useSettingsStore: () => mockSettingsStore }))

describe('NotesPage component logic tests', () => {
  let wrapper
  beforeEach(() => {
    vi.clearAllMocks()
    mockNoteStore.notes = []
    wrapper = mount(NotesPage, {
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
  it('subscribes on mount and unsubscribes on unmount', () => {
    expect(mockNoteStore.listenNotes).toHaveBeenCalledOnce()
    wrapper.unmount()
    expect(mockNoteStore.stopListening).toHaveBeenCalledOnce()
  })
  it('resets fields when opening the add dialog', () => {
    wrapper.vm.form.title = 'Old'
    wrapper.vm.openAddDialog()
    expect(wrapper.vm.form.title).toBe('')
    expect(wrapper.vm.isEditing).toBe(false)
    expect(wrapper.vm.showDialog).toBe(true)
  })
  it('prefills the edit dialog', () => {
    wrapper.vm.openEditDialog({ id: 'n1', title: 'Rent', description: 'Monthly' })
    expect(wrapper.vm.editingId).toBe('n1')
    expect(wrapper.vm.form.title).toBe('Rent')
    expect(wrapper.vm.form.description).toBe('Monthly')
  })
  it('rejects a missing title', async () => {
    wrapper.vm.form.title = ''
    await wrapper.vm.saveNote()
    expect(mockNoteStore.addNote).not.toHaveBeenCalled()
  })
  it('creates a note and closes the dialog', async () => {
    wrapper.vm.openAddDialog()
    wrapper.vm.form.title = 'Bills'
    wrapper.vm.form.description = 'October'
    await wrapper.vm.saveNote()
    expect(mockNoteStore.addNote).toHaveBeenCalledWith({ title: 'Bills', description: 'October' })
    expect(wrapper.vm.showDialog).toBe(false)
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }))
  })
  it('updates an existing note', async () => {
    wrapper.vm.openEditDialog({ id: 'n1', title: 'Old' })
    wrapper.vm.form.title = 'New'
    await wrapper.vm.saveNote()
    expect(mockNoteStore.updateNote).toHaveBeenCalledWith('n1', { title: 'New', description: '' })
  })
  it('reports database errors', async () => {
    wrapper.vm.form.title = 'Test'
    mockNoteStore.addNote.mockRejectedValueOnce(new Error('offline'))
    await wrapper.vm.saveNote()
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }))
    expect(wrapper.vm.saving).toBe(false)
  })
  it('confirms note deletion', async () => {
    wrapper.vm.confirmDelete({ id: 'n1', title: 'Old' })
    expect(mockDialog).toHaveBeenCalled()
    expect(mockNoteStore.deleteNote).toHaveBeenCalledWith('n1')
  })
})
