import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  askHumanTool,
  attachEvidenceTool,
  setNextActionTool,
  ALL_TOOLS,
  WRITE_TOOLS,
} from '../src/webmcp/tools'
import { answerQuestion, logStep, openQuestions } from '../src/domain/task'
import * as store from '../src/store/taskStore'
import { call, clearDatabase, currentTask, textOf, writeArgs } from './helpers'

beforeEach(async () => {
  store.__resetStore()
  await clearDatabase()
  await store.init()
  await store.createAndOpenTask('Ship the issuer', 'Read the spec')
})

afterEach(() => {
  store.__resetStore()
})

describe('ask_human', () => {
  it('est une écriture, et compte parmi les outils de la page', () => {
    expect(WRITE_TOOLS).toContain(askHumanTool)
    expect(askHumanTool.annotations?.readOnlyHint).toBe(false)
    expect(ALL_TOOLS.filter((t) => t.name === 'ask_human')).toHaveLength(1)
  })

  it('ouvre une question que la conversation suivante verra', async () => {
    const task = currentTask()
    const result = await call(
      askHumanTool,
      writeArgs(task, {
        question: 'Which of the five telemetry baselines should the gate use?',
        why: 'The thresholds are relative to them and I cannot measure them here.',
      }),
    )

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('OK — ask_human recorded.')
    expect(openQuestions(currentTask())).toHaveLength(1)
  })

  it('refuse une question sans son motif : personne ne saurait quoi répondre', async () => {
    const task = currentTask()
    const result = await call(askHumanTool, writeArgs(task, { question: 'Should I?' }))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('why')
  })

  it('rejoue une reprise sans poser la question deux fois', async () => {
    const task = currentTask()
    const args = writeArgs(task, { question: 'Which region?', why: 'It changes the endpoint.' })

    const first = await call(askHumanTool, args)
    const second = await call(askHumanTool, args)

    expect(textOf(second)).toContain('Replay of an earlier call')
    expect(textOf(first)).toContain('OK')
    expect(openQuestions(currentTask())).toHaveLength(1)
  })

  it('dit à l’agent qu’une question ouverte l’attend, sans la lui faire deviner', async () => {
    const task = currentTask()
    await call(
      askHumanTool,
      writeArgs(task, { question: 'Which region?', why: 'It changes the endpoint.' }),
    )
    await store.mutate((s) => answerQuestion(s, openQuestions(s)[0].id, 'eu-west-1'))

    const { resumeTaskTool } = await import('../src/webmcp/tools')
    const rendered = textOf(await call(resumeTaskTool))
    expect(rendered).toContain('ANSWERED BY THE HUMAN')
    expect(rendered).toContain('eu-west-1')
  })
})

describe('attach_evidence', () => {
  async function claimedStep(): Promise<string> {
    await store.mutate((s) =>
      logStep(
        s,
        { action: 'Ran the migration', result: 'no error', basedOnVersion: null },
        'agent',
      ),
    )
    return currentTask().steps.at(-1)!.id
  }

  it('attache une preuve à une étape restée simple affirmation', async () => {
    const stepId = await claimedStep()
    expect(currentTask().steps.at(-1)!.confidence).toBe('claimed')

    const result = await call(
      attachEvidenceTool,
      writeArgs(currentTask(), {
        step_id: stepId,
        evidence: { kind: 'command_output', content: 'ALTER TABLE\nCOMMIT' },
      }),
    )

    expect(result.isError).toBeFalsy()
    const step = currentTask().steps.find((s) => s.id === stepId)!
    expect(step.confidence).toBe('evidence')
    expect(step.evidence!.content).toContain('\n')
    // Une preuve fournie par l'agent n'est pas une preuve vérifiée.
    expect(step.evidence!.verifiedAt).toBeNull()
  })

  it('refuse d’écraser une preuve déjà attachée', async () => {
    const stepId = await claimedStep()
    await call(
      attachEvidenceTool,
      writeArgs(currentTask(), {
        step_id: stepId,
        evidence: { kind: 'command_output', content: 'first' },
      }),
    )

    const result = await call(
      attachEvidenceTool,
      writeArgs(currentTask(), {
        step_id: stepId,
        evidence: { kind: 'command_output', content: 'second' },
      }),
    )

    expect(result.isError).toBe(true)
    expect(currentTask().steps.find((s) => s.id === stepId)!.evidence!.content).toBe('first')
  })

  it('refuse une étape qui n’existe pas, sans rien écrire', async () => {
    const before = currentTask().version
    const result = await call(
      attachEvidenceTool,
      writeArgs(currentTask(), {
        step_id: 'no-such-step',
        evidence: { kind: 'url', content: 'https://example.test' },
      }),
    )
    expect(result.isError).toBe(true)
    expect(currentTask().steps).toHaveLength(0)
    expect(currentTask().version).toBe(before)
  })

  it('ne touche pas à une étape que l’humain a validée', async () => {
    await store.mutate((s) =>
      logStep(
        s,
        {
          action: 'Ran the suite',
          result: 'green',
          evidence: { kind: 'test_report', content: '148 passed' },
          basedOnVersion: null,
        },
        'human',
      ),
    )
    const stepId = currentTask().steps.at(-1)!.id

    const result = await call(
      attachEvidenceTool,
      writeArgs(currentTask(), {
        step_id: stepId,
        evidence: { kind: 'command_output', content: 'something else' },
      }),
    )

    expect(result.isError).toBe(true)
    expect(currentTask().steps.at(-1)!.confidence).toBe('human_verified')
  })
})

describe('set_next_action', () => {
  it('change la prochaine action sans inventer une étape', async () => {
    const before = currentTask().steps.length
    const result = await call(
      setNextActionTool,
      writeArgs(currentTask(), { next: 'Benchmark approach C against the p95 baseline' }),
    )

    expect(result.isError).toBeFalsy()
    expect(currentTask().next).toBe('Benchmark approach C against the p95 baseline')
    // C'est tout l'intérêt : consigner une intention n'est pas consigner un fait.
    expect(currentTask().steps).toHaveLength(before)
  })

  it('refuse une prochaine action vide', async () => {
    const result = await call(setNextActionTool, writeArgs(currentTask(), { next: '   ' }))
    expect(result.isError).toBe(true)
  })
})
