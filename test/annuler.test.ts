import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import {
  activeConstraints,
  addConstraint,
  answerQuestion,
  askHuman,
  logStep,
  openQuestions,
  proposedConstraints,
  proposedRejections,
  rejectApproach,
  renameTask,
  setArchived,
  setConstraintActive,
  setConstraintStanding,
  setRejectionStanding,
  undoLastSupervision,
  undoable,
} from '../src/domain/task'
import { ValidationError } from '../src/domain/errors'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildDemoTask()
})

describe('annuler la dernière décision de supervision', () => {
  it('ne propose rien quand rien n’est annulable', () => {
    const fresh = logStep(task, { action: 'a', result: 'b', basedOnVersion: null }, 'agent')
    expect(undoable(fresh)).toBeNull()
    expect(() => undoLastSupervision(fresh)).toThrow(ValidationError)
  })

  it('rétablit une règle levée par erreur', () => {
    const rule = activeConstraints(task)[0]
    const lifted = setConstraintActive(task, rule.id, false)
    expect(activeConstraints(lifted).some((c) => c.id === rule.id)).toBe(false)

    expect(undoable(lifted)).toContain('lifted')
    const back = undoLastSupervision(lifted)
    expect(activeConstraints(back).some((c) => c.id === rule.id)).toBe(true)
    expect(back.audit.at(-1)).toMatchObject({ operation: 'undo', actor: 'human' })
  })

  it('remet une proposition acceptée par erreur à l’état de proposition', () => {
    const proposed = addConstraint(
      task,
      { rule: 'Keep flags stable', basedOnVersion: null },
      'agent',
    )
    const id = proposedConstraints(proposed).at(-1)!.id
    const accepted = setConstraintStanding(proposed, id, 'accepted')

    const back = undoLastSupervision(accepted)
    expect(proposedConstraints(back).some((c) => c.id === id)).toBe(true)
    // Une règle rendue à l'état de proposition ne contraint plus personne.
    expect(activeConstraints(back).some((c) => c.id === id)).toBe(false)
  })

  it('remet un rejet décliné par erreur à l’état de proposition', () => {
    const proposed = rejectApproach(
      task,
      { approach: 'Sharding by tenant', reason: 'unmeasured', basedOnVersion: null },
      'agent',
    )
    const id = proposedRejections(proposed).at(-1)!.id
    const declined = setRejectionStanding(proposed, id, 'declined')

    const back = undoLastSupervision(declined)
    expect(proposedRejections(back).some((r) => r.id === id)).toBe(true)
  })

  it('désarchive une tâche archivée par erreur', () => {
    const archived = setArchived(task, true)
    const back = undoLastSupervision(archived)
    expect(back.archived).toBe(false)
  })

  it('n’efface rien : l’annulation est une écriture de plus', () => {
    const rule = activeConstraints(task)[0]
    const lifted = setConstraintActive(task, rule.id, false)
    const back = undoLastSupervision(lifted)

    expect(back.version).toBe(lifted.version + 1)
    expect(back.audit.some((e) => e.operation === 'deactivate_constraint')).toBe(true)
    expect(back.audit.at(-1)!.detail).toContain(rule.rule)
  })

  it('remonte à la décision précédente quand on annule deux fois', () => {
    const rules = activeConstraints(task)
    let next = setConstraintActive(task, rules[0].id, false)
    next = setConstraintActive(next, rules[1].id, false)

    next = undoLastSupervision(next)
    expect(activeConstraints(next).some((c) => c.id === rules[1].id)).toBe(true)

    next = undoLastSupervision(next)
    expect(activeConstraints(next).some((c) => c.id === rules[0].id)).toBe(true)
    expect(undoable(next)).toBeNull()
  })

  it('ignore ce qu’un agent a écrit : on n’annule que ses propres décisions', () => {
    const proposed = addConstraint(task, { rule: 'Agent rule', basedOnVersion: null }, 'agent')
    expect(undoable(proposed)).toBeNull()
  })

  it('ne touche pas à ce qui n’est plus dans l’état qu’il avait laissé', () => {
    const rule = activeConstraints(task)[0]
    const lifted = setConstraintActive(task, rule.id, false)
    // L'humain a changé d'avis à la main entre-temps.
    const restored = setConstraintActive(lifted, rule.id, true)

    // La levée n'est plus en vigueur : l'annuler la rejouerait à l'envers.
    expect(undoable(restored)).toContain('restored')
  })

  it('n’annule ni une réponse, ni une étape consignée', () => {
    // Une réponse a pu être lue et suivie par un agent : la retirer d'un clic
    // effacerait ce sur quoi il s'est appuyé. Une étape est le récit d'un
    // travail, pas une décision de supervision.
    const asked = askHuman(
      task,
      { question: 'Which region?', why: 'It changes the endpoint.', basedOnVersion: null },
      'agent',
    )
    const answered = answerQuestion(asked, openQuestions(asked)[0].id, 'eu-west-1')
    expect(undoable(answered)).toBeNull()

    expect(
      undoable(logStep(task, { action: 'a', result: 'b', basedOnVersion: null }, 'human')),
    ).toBeNull()
  })

  it('annule en revanche un renommage, qui n’est qu’un mot remplacé', () => {
    expect(undoable(renameTask(task, 'A new title'))).toContain('renamed')
  })
})

describe('annuler depuis la page', () => {
  let root: HTMLElement
  let unmount: () => void

  async function settled(turns = 8) {
    for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  async function written(before: number) {
    await waitUntil(() => (store.currentTask()?.version ?? 0) > before, 'l’écriture')
    __renderNow()
  }

  beforeEach(async () => {
    store.__resetStore()
    await clearDatabase()
    await store.init()
    document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    unmount = mount(root)
    await store.openPreparedTask(buildDemoTask())
    await settled()
  })

  afterEach(() => {
    unmount()
    history.replaceState(null, '', '/')
  })

  it('n’affiche pas de bouton tant qu’il n’y a rien à annuler', () => {
    expect(root.querySelector('#undo')).toBeNull()
  })

  it('apparaît après une décision, et dit laquelle', async () => {
    const before = store.currentTask()!.version
    root.querySelector<HTMLButtonElement>('[data-toggle]')!.click()
    await written(before)

    const undo = root.querySelector<HTMLButtonElement>('#undo')!
    expect(undo).not.toBeNull()
    expect(undo.textContent).toContain('Undo')
    expect(undo.getAttribute('aria-label')).toContain('lifted')
  })

  it('rend la décision, et le bouton disparaît', async () => {
    const rule = store.currentTask()!.constraints.find((c) => c.active)!
    let before = store.currentTask()!.version
    root.querySelector<HTMLButtonElement>('[data-toggle]')!.click()
    await written(before)

    before = store.currentTask()!.version
    root.querySelector<HTMLButtonElement>('#undo')!.click()
    await written(before)

    expect(store.currentTask()!.constraints.find((c) => c.id === rule.id)!.active).toBe(true)
    expect(root.querySelector('#undo')).toBeNull()
  })
})
