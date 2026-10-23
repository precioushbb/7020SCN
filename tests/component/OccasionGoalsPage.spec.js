import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import * as QuasarComponents from 'quasar'
import OccasionGoalsPage from '/src/pages/OccasionGoalsPage.vue'

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
const mockGoalStore = makeStore(
  [
    'listenGoals',
    'stopListening',
    'addGoal',
    'updateGoal',
    'addContribution',
    'deleteContribution',
    'deleteGoal',
  ],
  { goals: [] },
)
vi.mock('stores/occasionGoalStore', () => ({ useOccasionGoalStore: () => mockGoalStore }))
const mockSettingsStore = {
  language: 'en',
  currency: '$',
  formatNumber: (n) => String(n),
  formatDate: (d) => d,
}
vi.mock('stores/settingsStore', () => ({ useSettingsStore: () => mockSettingsStore }))

describe('OccasionGoalsPage component logic tests', () => {
  let wrapper
  beforeEach(() => {
    vi.clearAllMocks()
    mockGoalStore.goals = []
    wrapper = mount(OccasionGoalsPage, {
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
  it('subscribes and unsubscribes', () => {
    expect(mockGoalStore.listenGoals).toHaveBeenCalled()
    wrapper.unmount()
    expect(mockGoalStore.stopListening).toHaveBeenCalled()
  })
  it('opens a blank goal form', () => {
    wrapper.vm.goalForm.name = 'Old'
    wrapper.vm.openAddDialog()
    expect(wrapper.vm.goalForm.name).toBe('')
    expect(wrapper.vm.showGoalDialog).toBe(true)
  })
  it('creates a goal', async () => {
    wrapper.vm.openAddDialog()
    Object.assign(wrapper.vm.goalForm, {
      name: 'Holiday',
      type: 'custom',
      targetAmount: 1000,
      targetDate: '2027-12-01',
    })
    await wrapper.vm.saveGoal()
    expect(mockGoalStore.addGoal).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Holiday', targetAmount: 1000 }),
    )
    expect(wrapper.vm.showGoalDialog).toBe(false)
  })
  it('opens goal details and preloads the edit form', () => {
    const goal = {
      id: 'g1',
      name: 'Trip',
      type: 'custom',
      targetDate: '2027-12-01',
      targetAmount: 500,
      currentSaved: 100,
      contributions: [],
    }
    mockGoalStore.goals = [goal]
    wrapper.vm.openDetail(goal)
    wrapper.vm.openEditFromDetail()
    expect(wrapper.vm.goalForm.name).toBe('Trip')
    expect(wrapper.vm.showGoalDialog).toBe(true)
  })
  it('updates an existing goal', async () => {
    const goal = {
      id: 'g1',
      name: 'Trip',
      type: 'custom',
      targetDate: '2027-12-01',
      targetAmount: 500,
      contributions: [],
    }
    mockGoalStore.goals = [goal]
    wrapper.vm.openDetail(goal)
    wrapper.vm.openEditFromDetail()
    wrapper.vm.goalForm.name = 'Updated Trip'
    await wrapper.vm.saveGoal()
    expect(mockGoalStore.updateGoal).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({ name: 'Updated Trip' }),
    )
  })
  it('does not add contributions without a selected goal', async () => {
    await wrapper.vm.saveContribution()
    expect(mockGoalStore.addContribution).not.toHaveBeenCalled()
  })
  it('adds a contribution to the selected goal', async () => {
    const goal = { id: 'g1', name: 'Trip', contributions: [] }
    mockGoalStore.goals = [goal]
    wrapper.vm.openDetail(goal)
    wrapper.vm.openAddContribution()
    wrapper.vm.contribForm.amount = 50
    await wrapper.vm.saveContribution()
    expect(mockGoalStore.addContribution).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({ amount: 50 }),
    )
    expect(wrapper.vm.showContribDialog).toBe(false)
  })
  it('clears saving state after a rejected goal creation', async () => {
    wrapper.vm.openAddDialog()
    wrapper.vm.goalForm.name = 'Test'
    mockGoalStore.addGoal.mockRejectedValueOnce(new Error('offline'))
    await expect(wrapper.vm.saveGoal()).rejects.toThrow('offline')
    expect(wrapper.vm.saving).toBe(false)
  })
})
