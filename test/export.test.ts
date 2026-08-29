import { describe, expect, it } from 'vitest'
import { buildMeasureTask } from '../src/demo/measures'
import { buildDemoTask } from '../src/demo/seed'
import { buildFullExport, buildTaskExport, exportFilename } from '../src/export/notebook'
import { completeTask, logStep, recordRefusal } from '../src/domain/task'

describe('exporting a log', () => {
  it('shows the evidence content that the compact render hides', () => {
    const output = buildTaskExport(buildDemoTask())
    expect(output).toContain('## Attached evidence')
    expect(output).toContain('auth suite: 183 passed, 0 failed, 0 skipped')
    expect(output).toContain('bench --auth-refresh')
  })

  it('renders the write log, refusals included', () => {
    let task = buildMeasureTask(1)
    task = recordRefusal(task, {
      operation: 'log_step',
      actor: 'agent',
      basedOnVersion: 1,
      detail: 'stale write on v1',
    })

    const output = buildTaskExport(task)
    expect(output).toContain('## Write log')
    expect(output).toContain('**refused**')
    expect(output).toContain('`log_step`')
  })

  it('does not lose a detail holding a vertical bar in the table', () => {
    let task = buildMeasureTask(2)
    task = logStep(
      task,
      { action: 'a | b | c', result: 'r', basedOnVersion: task.version },
      'agent',
    )
    const line = buildTaskExport(task)
      .split('\n')
      .find((l) => l.includes('a \\| b \\| c'))
    expect(line).toBeDefined()
  })

  it('attaches the full state, to replay or to check', () => {
    const task = buildMeasureTask(3)
    const output = buildTaskExport(task)
    const json = output.split('```json\n')[1].split('\n```')[0]
    expect(JSON.parse(json).id).toBe(task.id)
    expect(JSON.parse(json).version).toBe(task.version)
  })

  it('gathers every log on a device into one file', () => {
    const tasks = [buildMeasureTask(1), buildMeasureTask(2), buildMeasureTask(3)]
    const output = buildFullExport(tasks)
    expect(output).toContain('# 3 logs from Keydler')
    for (const t of tasks) expect(output).toContain(t.title)
  })

  it('says plainly that there is nothing to gather', () => {
    expect(buildFullExport([])).toContain('No Keydler log')
  })

  it('does not let evidence close the block that holds it', () => {
    let task = buildMeasureTask(4)
    task = logStep(
      task,
      {
        action: 'Output containing a closing fence',
        result: 'r',
        evidence: { kind: 'command_output', content: '```\n# Fake injected heading\n```' },
        basedOnVersion: task.version,
      },
      'agent',
    )

    const output = buildTaskExport(task)

    expect(output).toContain('````\n```\n# Fake injected heading\n```\n````')
  })

  it('survives an out-of-range timestamp rather than taking the export down', () => {
    const task = { ...buildMeasureTask(5), updatedAt: 1e20 }
    expect(() => buildTaskExport(task)).not.toThrow()
    expect(buildTaskExport(task)).toContain('unreadable timestamp')
  })

  it('gives a stable filename with no risky character', () => {
    const task = buildMeasureTask(5)
    const name = exportFilename(task)
    expect(name).toMatch(/^keydler-[a-z0-9-]+-v\d+\.md$/)
    expect(exportFilename(task)).toBe(name)
  })
})

describe('export: edge cases', () => {
  it('omits empty sections rather than showing hollow headings', () => {
    const nu = { ...buildMeasureTask(1), steps: [], audit: [], decisions: [] }
    const output = buildTaskExport(nu)
    expect(output).not.toContain('## Attached evidence')
    expect(output).not.toContain('## Write log')
    expect(output).toContain('## Full state')
  })

  it('renders the closing summary of a completed task', () => {
    const task = completeTask(
      buildMeasureTask(2),
      { summary: 'Selected approach delivered.', basedOnVersion: buildMeasureTask(2).version },
      'agent',
    )
    const output = buildTaskExport(task)
    expect(output).toContain('- Status: completed')
    expect(output).toContain('Selected approach delivered.')
  })

  it('marks one piece of evidence as checked by a human, and another not', () => {
    let task = buildDemoTask()
    const output = buildTaskExport(task)
    expect(output).toContain('- Checked by a human: no')
    expect(output).toMatch(/- Checked by a human: \d{4}-/)
    task = { ...task, steps: [] }
    expect(buildTaskExport(task)).not.toContain('- Verified :')
  })
})
