import { beforeEach, describe, expect, it } from 'vitest'
import { addConstraint, createTask, setNext } from '../src/domain/task'
import { StaleStateError } from '../src/domain/errors'
import type { TaskState } from '../src/domain/types'

// `set_next_action` validated the shape of `based_on_version` then threw the value away. On the
// real deployment: a stale write overwrote the next action the human had just set, the entry was
// recorded as `actor: 'human'`, and the operation was named `set_next` on success,
// `set_next_action` on failure.
describe('set_next_action, written by an agent', () => {
  let log: TaskState

  beforeEach(() => {
    log = createTask({ title: 'Un cahier', next: 'La première chose' })
  })

  it('refuses a stale version', () => {
    const advanced = addConstraint(log, { rule: 'Une règle', basedOnVersion: null }, 'human')
    expect(advanced.version).toBeGreaterThan(log.version)

    expect(() =>
      setNext(advanced, { next: 'Autre chose', basedOnVersion: log.version }, 'agent'),
    ).toThrow(StaleStateError)
  })

  it('lets the current version through', () => {
    const after = setNext(log, { next: 'Autre chose', basedOnVersion: log.version }, 'agent')
    expect(after.next).toBe('Autre chose')
  })

  it('records the agent as the author, never the human', () => {
    const after = setNext(log, { next: 'Autre chose', basedOnVersion: log.version }, 'agent')
    const entry = after.audit[after.audit.length - 1]

    expect(entry.actor).toBe('agent')
    expect(entry.outcome).toBe('applied')
  })

  it('keeps the claimed version in the record', () => {
    // Without it, you cannot read back afterwards which state the agent was
    // working from, that is, know whether it was working blind.
    const after = setNext(log, { next: 'Autre chose', basedOnVersion: log.version }, 'agent')
    expect(after.audit[after.audit.length - 1].basedOnVersion).toBe(log.version)
  })

  it('carries the same name as the tool that triggered it', () => {
    // The refusal is recorded under the name of the tool (`recordRefusal` gets
    // `tool.name`). If success carried another one, the log would show the
    // same action under two names, and only when it fails.
    const after = setNext(log, { next: 'Autre chose', basedOnVersion: log.version }, 'agent')
    expect(after.audit[after.audit.length - 1].operation).toBe('set_next_action')
  })
})

describe('set_next_action, written by the human', () => {
  it('stays attributed to the human, with no version imposed', () => {
    const log = createTask({ title: 'Un cahier', next: 'La première chose' })
    const after = setNext(log, { next: 'Autre chose', basedOnVersion: null })
    const entry = after.audit[after.audit.length - 1]

    expect(entry.actor).toBe('human')
    expect(entry.basedOnVersion).toBeNull()
  })

  it('can clear the field, which an agent cannot', () => {
    // The ban on the agent side comes from the schema (`minLength: 1`) and
    // from `requireText` in the tool, not here: the domain accepts empty so
    // the human can clear a next action that has become wrong.
    const log = createTask({ title: 'Un cahier', next: 'La première chose' })
    expect(setNext(log, { next: '', basedOnVersion: null }).next).toBeNull()
  })
})
