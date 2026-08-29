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

describe('the audit trail keeps what was replaced', () => {
  it('keeps the old title when the task is renamed', () => {
    const before = task.title
    const next = renameTask(task, 'A different name')
    expect(next.audit.at(-1)!.previous).toBe(before)
  })

  it('keeps the old next action', () => {
    const before = task.next
    const next = setNext(task, { next: 'Something else entirely', basedOnVersion: null })
    expect(next.audit.at(-1)!.previous).toBe(before)
  })

  it('keeps the old wording of a rule', () => {
    const rule = task.constraints[0]
    const next = editConstraint(task, rule.id, 'A reworded rule')
    expect(next.audit.at(-1)!.previous).toBe(rule.rule)
  })

  it('reads in the history, not only in the data', () => {
    const next = renameTask(task, 'A different name')
    const line = describeEntry(next.audit.at(-1)!)
    expect(line.detail).toContain(task.title)
  })

  it('records an empty value rather than nothing, when there was nothing', () => {
    // Confusing "there was nothing" with "nothing was recorded" made it
    // impossible to undo the very first setting of a field.
    const sansNext = { ...task, next: null }
    const next = setNext(sansNext, { next: 'First next action', basedOnVersion: null })
    expect(next.audit.at(-1)!.previous).toBe('')
    expect(undoLastSupervision(next).next).toBeNull()
  })
})

describe('undoing what was replaced', () => {
  it('gives the task its title back', () => {
    const before = task.title
    const renamed = renameTask(task, 'A different name')
    expect(undoable(renamed)).toContain('renamed')

    const back = undoLastSupervision(renamed)
    expect(back.title).toBe(before)
  })

  it('gives the old next action back', () => {
    const before = task.next!
    const changed = setNext(task, { next: 'Something else entirely', basedOnVersion: null })
    const back = undoLastSupervision(changed)
    expect(back.next).toBe(before)
  })

  it('gives a rule its old wording back', () => {
    const rule = task.constraints[0]
    const edited = editConstraint(task, rule.id, 'A reworded rule')
    const back = undoLastSupervision(edited)
    expect(back.constraints.find((c) => c.id === rule.id)!.rule).toBe(rule.rule)
  })

  it('does not offer to undo what was already changed again by hand', () => {
    const renamed = renameTask(task, 'A different name')
    const again = renameTask(renamed, 'A third name')

    // The most recent one stays undoable; the older one must not resurface.
    const back = undoLastSupervision(again)
    expect(back.title).toBe('A different name')
  })

  it('tells the agent what was given back, in a sentence', () => {
    const renamed = renameTask(task, 'A different name')
    const back = undoLastSupervision(renamed)
    const rendered = renderChanges(back, renamed.version)

    expect(rendered).not.toContain('undo')
    expect(rendered).toContain('The human')
  })
})
