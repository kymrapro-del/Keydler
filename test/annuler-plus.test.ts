import { beforeEach, describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import {
  editConstraint,
  renameTask,
  setNext,
  undoLastSupervision,
  undoable,
} from '../src/domain/task'
import { describeEntry } from '../src/ui/history'
import { renderChanges } from '../src/domain/changes'
import type { TaskState } from '../src/domain/types'

let task: TaskState

beforeEach(() => {
  task = buildCoreTask()
})

describe('le journal retient ce qui a été remplacé', () => {
  it('garde l’ancien titre quand la tâche est renommée', () => {
    const before = task.title
    const next = renameTask(task, 'A different name')
    expect(next.audit.at(-1)!.previous).toBe(before)
  })

  it('garde l’ancienne prochaine action', () => {
    const before = task.next
    const next = setNext(task, { next: 'Something else entirely', basedOnVersion: null })
    expect(next.audit.at(-1)!.previous).toBe(before)
  })

  it('garde l’ancienne formulation d’une règle', () => {
    const rule = task.constraints[0]
    const next = editConstraint(task, rule.id, 'A reworded rule')
    expect(next.audit.at(-1)!.previous).toBe(rule.rule)
  })

  it('se lit dans l’historique, pas seulement dans les données', () => {
    const next = renameTask(task, 'A different name')
    const line = describeEntry(next.audit.at(-1)!)
    expect(line.detail).toContain(task.title)
  })

  it('consigne une valeur vide plutôt que rien, quand il n’y avait rien', () => {
    // Confondre « il n'y avait rien » avec « rien n'a été consigné » rendait
    // impossible d'annuler la toute première pose d'un champ.
    const sansNext = { ...task, next: null }
    const next = setNext(sansNext, { next: 'First next action', basedOnVersion: null })
    expect(next.audit.at(-1)!.previous).toBe('')
    expect(undoLastSupervision(next).next).toBeNull()
  })
})

describe('annuler ce qui a été remplacé', () => {
  it('rend son titre à la tâche', () => {
    const before = task.title
    const renamed = renameTask(task, 'A different name')
    expect(undoable(renamed)).toContain('renamed')

    const back = undoLastSupervision(renamed)
    expect(back.title).toBe(before)
  })

  it('rend l’ancienne prochaine action', () => {
    const before = task.next!
    const changed = setNext(task, { next: 'Something else entirely', basedOnVersion: null })
    const back = undoLastSupervision(changed)
    expect(back.next).toBe(before)
  })

  it('rend son ancienne formulation à une règle', () => {
    const rule = task.constraints[0]
    const edited = editConstraint(task, rule.id, 'A reworded rule')
    const back = undoLastSupervision(edited)
    expect(back.constraints.find((c) => c.id === rule.id)!.rule).toBe(rule.rule)
  })

  it('ne propose pas d’annuler ce qui a déjà été rechangé à la main', () => {
    const renamed = renameTask(task, 'A different name')
    const again = renameTask(renamed, 'A third name')

    // La plus récente reste annulable ; l'ancienne ne doit pas ressurgir.
    const back = undoLastSupervision(again)
    expect(back.title).toBe('A different name')
  })

  it('dit à l’agent ce qui a été rendu, en phrase', () => {
    const renamed = renameTask(task, 'A different name')
    const back = undoLastSupervision(renamed)
    const rendered = renderChanges(back, renamed.version)

    expect(rendered).not.toContain('undo')
    expect(rendered).toContain('The human')
  })
})
