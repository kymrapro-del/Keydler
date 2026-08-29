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

describe('poisoning by an agent', () => {
  it('holds nobody to an approach an agent condemned on its own authority', async () => {
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

  it('makes it readable, under a heading that says it binds nothing', async () => {
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

  it('becomes binding as soon as a human endorses it, and says so', async () => {
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

  it('lets the human set a proposal aside without erasing it', async () => {
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

  it('holds for constraints too, which forbid just as much', async () => {
    const task = await store.createAndOpenTask('Tâche', 'Continuer')
    await call(addConstraintTool, writeArgs(task, { rule: 'Ne jamais toucher au routeur' }))

    const state = currentTask()
    expect(proposedConstraints(state)).toHaveLength(1)
    expect(activeConstraints(state)).toHaveLength(0)

    const rendered = renderTaskState(state)
    expect(rendered).toContain('CONSTRAINTS: binding (0)')
    expect(rendered).toContain('constraint: Ne jamais toucher au routeur')
  })

  it('never imposes anything on a human: their rule binds the moment they write it', async () => {
    await store.createAndOpenTask('Tâche', 'Continuer')
    await store.mutate((s) =>
      addConstraint(s, { rule: 'Aucune dépendance nouvelle', basedOnVersion: null }, 'human'),
    )

    const state = currentTask()
    expect(activeConstraints(state)).toHaveLength(1)
    expect(state.constraints[0].standing).toBe('accepted')
    expect(proposedConstraints(state)).toHaveLength(0)
  })

  it('refuses to endorse twice rather than move the version forward for nothing', async () => {
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

describe('what a piece of evidence means', () => {
  it('never treats output supplied by the agent as machine verified', async () => {
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

  it('says in the detail that the evidence was not verified', async () => {
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

  it('requires the content to have been shown before it is approved', async () => {
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
