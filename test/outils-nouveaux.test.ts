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
  it('is a write, and counts among the tools on the page', () => {
    expect(WRITE_TOOLS).toContain(askHumanTool)
    expect(askHumanTool.annotations?.readOnlyHint).toBe(false)
    expect(ALL_TOOLS.filter((t) => t.name === 'ask_human')).toHaveLength(1)
  })

  it('opens a question the next conversation will see', async () => {
    const task = currentTask()
    const result = await call(
      askHumanTool,
      writeArgs(task, {
        question: 'Which of the five telemetry baselines should the gate use?',
        why: 'The thresholds are relative to them and I cannot measure them here.',
      }),
    )

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('OK: ask_human recorded.')
    expect(openQuestions(currentTask())).toHaveLength(1)
  })

  it('refuses a question without its reason: nobody would know what to answer', async () => {
    const task = currentTask()
    const result = await call(askHumanTool, writeArgs(task, { question: 'Should I?' }))
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('why')
  })

  it('replays a retry without asking the question twice', async () => {
    const task = currentTask()
    const args = writeArgs(task, { question: 'Which region?', why: 'It changes the endpoint.' })

    const first = await call(askHumanTool, args)
    const second = await call(askHumanTool, args)

    expect(textOf(second)).toContain('Replay of an earlier call')
    expect(textOf(first)).toContain('OK')
    expect(openQuestions(currentTask())).toHaveLength(1)
  })

  it('tells the agent an open question is waiting, without making it guess', async () => {
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

  it('attaches evidence to a step that was only a claim', async () => {
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
    // Evidence supplied by the agent is not verified evidence.
    expect(step.evidence!.verifiedAt).toBeNull()
  })

  it('refuses to overwrite evidence already attached', async () => {
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

  it('refuses a step that does not exist, without writing anything', async () => {
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

  it('does not touch a step the human has verified', async () => {
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
  it('changes the next action without inventing a step', async () => {
    const before = currentTask().steps.length
    const result = await call(
      setNextActionTool,
      writeArgs(currentTask(), { next: 'Benchmark approach C against the p95 baseline' }),
    )

    expect(result.isError).toBeFalsy()
    expect(currentTask().next).toBe('Benchmark approach C against the p95 baseline')
    // That is the whole point: recording an intention is not recording a fact.
    expect(currentTask().steps).toHaveLength(before)
  })

  it('refuses an empty next action', async () => {
    const result = await call(setNextActionTool, writeArgs(currentTask(), { next: '   ' }))
    expect(result.isError).toBe(true)
  })
})
