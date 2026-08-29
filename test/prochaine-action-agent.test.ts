import { beforeEach, describe, expect, it } from 'vitest'
import { addConstraint, createTask, setNext } from '../src/domain/task'
import { StaleStateError } from '../src/domain/errors'
import type { TaskState } from '../src/domain/types'

// `set_next_action` validated the shape of `based_on_version` then threw the value away. On the
// real deployment: a stale write overwrote the next action the human had just set, the entry was
// recorded as `actor: 'human'`, and the operation was named `set_next` on success,
// `set_next_action` on failure.
describe('set_next_action, écrit par un agent', () => {
  let log: TaskState

  beforeEach(() => {
    log = createTask({ title: 'Un cahier', next: 'La première chose' })
  })

  it('refuse une version périmée', () => {
    const advanced = addConstraint(log, { rule: 'Une règle', basedOnVersion: null }, 'human')
    expect(advanced.version).toBeGreaterThan(log.version)

    expect(() =>
      setNext(advanced, { next: 'Autre chose', basedOnVersion: log.version }, 'agent'),
    ).toThrow(StaleStateError)
  })

  it('laisse passer la version courante', () => {
    const after = setNext(log, { next: 'Autre chose', basedOnVersion: log.version }, 'agent')
    expect(after.next).toBe('Autre chose')
  })

  it('consigne l’agent comme auteur, jamais l’humain', () => {
    const after = setNext(log, { next: 'Autre chose', basedOnVersion: log.version }, 'agent')
    const entry = after.audit[after.audit.length - 1]

    expect(entry.actor).toBe('agent')
    expect(entry.outcome).toBe('applied')
  })

  it('garde la version invoquée dans le registre', () => {
    // Without it, you cannot read back afterwards which state the agent was
    // working from, that is, know whether it was working blind.
    const after = setNext(log, { next: 'Autre chose', basedOnVersion: log.version }, 'agent')
    expect(after.audit[after.audit.length - 1].basedOnVersion).toBe(log.version)
  })

  it('porte le même nom que l’outil qui l’a déclenchée', () => {
    // The refusal is recorded under the name of the tool (`recordRefusal` gets
    // `tool.name`). If success carried another one, the log would show the
    // same action under two names, and only when it fails.
    const after = setNext(log, { next: 'Autre chose', basedOnVersion: log.version }, 'agent')
    expect(after.audit[after.audit.length - 1].operation).toBe('set_next_action')
  })
})

describe('set_next_action, écrit par l’humain', () => {
  it('reste attribué à l’humain et sans version imposée', () => {
    const log = createTask({ title: 'Un cahier', next: 'La première chose' })
    const after = setNext(log, { next: 'Autre chose', basedOnVersion: null })
    const entry = after.audit[after.audit.length - 1]

    expect(entry.actor).toBe('human')
    expect(entry.basedOnVersion).toBeNull()
  })

  it('peut vider le champ, ce qu’un agent ne peut pas', () => {
    // The ban on the agent side comes from the schema (`minLength: 1`) and
    // from `requireText` in the tool, not here: the domain accepts empty so
    // the human can clear a next action that has become wrong.
    const log = createTask({ title: 'Un cahier', next: 'La première chose' })
    expect(setNext(log, { next: '', basedOnVersion: null }).next).toBeNull()
  })
})
