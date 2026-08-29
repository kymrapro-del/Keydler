import { beforeEach, describe, expect, it } from 'vitest'
import { ALL_TOOLS, resumeTaskTool } from '../src/webmcp/tools'
import * as store from '../src/store/taskStore'
import {
  acceptedRejections,
  activeConstraints,
  addConstraint,
  proposedConstraints,
  proposedRejections,
  rejectApproach,
  setConstraintStanding,
  setRejectionStanding,
  verifyEvidence,
} from '../src/domain/task'
import { ValidationError } from '../src/domain/errors'
import { renderTaskState } from '../src/domain/render'
import { call, clearDatabase, currentTask, textOf, writeArgs } from './helpers'

const rejectApproachTool = ALL_TOOLS.find((t) => t.name === 'reject_approach')!
const addConstraintTool = ALL_TOOLS.find((t) => t.name === 'add_constraint')!

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
})

describe('empoisonnement par un agent', () => {
  it('n’oppose pas une approche qu’un agent a condamnée de sa seule autorité', async () => {
    const task = await store.createAndOpenTask('Choisir un mécanisme', 'Décider')

    const written = await call(
      rejectApproachTool,
      writeArgs(task, {
        approach: 'Cookie HttpOnly',
        reason: 'supposé incompatible, non mesuré',
      }),
    )
    expect(written.isError).toBeUndefined()

    const state = currentTask()
    expect(state.rejected).toHaveLength(1)
    expect(state.rejected[0].standing).toBe('proposed')
    expect(acceptedRejections(state)).toHaveLength(0)
  })

  it('la rend lisible, sous un en-tête qui dit qu’elle n’impose rien', async () => {
    const task = await store.createAndOpenTask('Choisir un mécanisme', 'Décider')
    await call(
      rejectApproachTool,
      writeArgs(task, { approach: 'Cookie HttpOnly', reason: 'supposé incompatible' }),
    )

    const rendered = textOf(await call(resumeTaskTool))

    expect(rendered).toContain('Cookie HttpOnly')
    expect(rendered).toContain('PROPOSED BY AN AGENT: NOT binding')
    expect(rendered).toContain('No human has approved these')

    expect(rendered).not.toContain('REJECTED: do not retry')
  })

  it('devient opposable dès qu’un humain l’endosse, et le dit', async () => {
    const task = await store.createAndOpenTask('Choisir un mécanisme', 'Décider')
    await call(
      rejectApproachTool,
      writeArgs(task, { approach: 'Cookie HttpOnly', reason: 'mesuré, sessions perdues' }),
    )

    const proposed = proposedRejections(currentTask())[0]
    await store.mutate((s) => setRejectionStanding(s, proposed.id, 'accepted'))

    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('REJECTED: do not retry')
    expect(rendered).toContain('[agent] Cookie HttpOnly')
  })

  it('laisse l’humain écarter une proposition sans l’effacer', async () => {
    const task = await store.createAndOpenTask('Choisir un mécanisme', 'Décider')
    await call(
      rejectApproachTool,
      writeArgs(task, { approach: 'Cookie HttpOnly', reason: 'supposé' }),
    )

    const proposed = proposedRejections(currentTask())[0]
    await store.mutate((s) => setRejectionStanding(s, proposed.id, 'declined'))

    const state = currentTask()
    expect(state.rejected[0].standing).toBe('declined')
    expect(state.rejected).toHaveLength(1)
    expect(acceptedRejections(state)).toHaveLength(0)
    expect(proposedRejections(state)).toHaveLength(0)

    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).not.toContain('PROPOSED BY AN AGENT')
  })

  it('vaut aussi pour les contraintes, qui sont des interdits comme les autres', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    await call(addConstraintTool, writeArgs(task, { rule: 'Ne jamais toucher au routeur' }))

    const state = currentTask()
    expect(proposedConstraints(state)).toHaveLength(1)
    expect(activeConstraints(state)).toHaveLength(0)

    const rendered = renderTaskState(state)
    expect(rendered).toContain('CONSTRAINTS: binding (0)')
    expect(rendered).toContain('constraint: Ne jamais toucher au routeur')
  })

  it('n’impose jamais rien à un humain : sa règle est opposable à l’instant où il l’écrit', async () => {
    await store.createAndOpenTask('Tâche', 'Continuer')
    await store.mutate((s) =>
      addConstraint(s, { rule: 'Aucune dépendance nouvelle', basedOnVersion: null }, 'human'),
    )

    const state = currentTask()
    expect(activeConstraints(state)).toHaveLength(1)
    expect(state.constraints[0].standing).toBe('accepted')
    expect(proposedConstraints(state)).toHaveLength(0)
  })

  it('refuse d’endosser deux fois, plutôt que de faire avancer la version pour rien', async () => {
    let task = await store.createAndOpenTask('Tâche', 'Continuer')
    task = await store.mutate((s) =>
      rejectApproach(s, { approach: 'A', reason: 'r', basedOnVersion: s.version }, 'agent'),
    )
    const id = task.rejected[0].id
    task = await store.mutate((s) => setRejectionStanding(s, id, 'accepted'))

    expect(() => setRejectionStanding(task, id, 'accepted')).toThrow(ValidationError)
    expect(() => setConstraintStanding(task, 'inconnu', 'accepted')).toThrow(ValidationError)
  })
})

describe('sémantique des preuves', () => {
  it('ne tient jamais pour vérifiée par une machine une sortie fournie par l’agent', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!

    await call(
      logStep,
      writeArgs(task, {
        action: 'Lancé la suite',
        result: 'tout passe',
        evidence: { kind: 'test_report', content: '183 passed, 0 failed' },
      }),
    )

    const step = currentTask().steps[0]
    expect(step.confidence).toBe('evidence')
    expect(step.evidence?.verifiedAt).toBeNull()
    expect(JSON.stringify(currentTask())).not.toContain('machine_verified')
  })

  it('dit dans le détail que la preuve n’a pas été vérifiée', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    const detail = ALL_TOOLS.find((t) => t.name === 'read_task_detail')!

    await call(
      logStep,
      writeArgs(task, {
        action: 'Lancé la suite',
        result: 'tout passe',
        evidence: { kind: 'command_output', content: '$ npm test\n183 passed' },
      }),
    )

    const rendered = textOf(await call(detail, { section: 'steps' }))
    expect(rendered).toContain('human-checked: no, supplied by its author, not verified')
  })

  it('exige que le contenu ait été affiché avant d’être validé', async () => {
    let task = await store.createAndOpenTask('Tâche', 'Continuer')
    const logStep = ALL_TOOLS.find((t) => t.name === 'log_step')!
    await call(
      logStep,
      writeArgs(task, {
        action: 'a',
        result: 'b',
        evidence: { kind: 'diff', content: '+ ligne ajoutée' },
      }),
    )
    task = currentTask()
    const step = task.steps[0]

    expect(() => verifyEvidence(task, step.id, 'autre chose')).toThrow(ValidationError)
    expect(() => verifyEvidence(task, step.id, '')).toThrow(ValidationError)

    const approved = verifyEvidence(task, step.id, '+ ligne ajoutée')
    expect(approved.steps[0].confidence).toBe('human_verified')
    expect(approved.steps[0].evidence?.verifiedAt).not.toBeNull()
  })
})
