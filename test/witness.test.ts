import { beforeEach, describe, expect, it } from 'vitest'
import { getWitness, onCall, recordCall, resetCalls } from '../src/webmcp/witness'

beforeEach(resetCalls)

describe('the call witness', () => {
  it('counts everything, even what it does not keep', () => {
    for (let i = 0; i < 500; i++) recordCall('resume_task', i % 5 === 0)

    const { total, refused, recents } = getWitness()
    expect(total).toBe(500)
    expect(refused).toBe(100)
    expect(recents.length).toBeLessThanOrEqual(20)
  })

  it('keeps the most recent, not the first', () => {
    for (let i = 0; i < 40; i++) recordCall(`tool-${i}`, false)
    const { recents } = getWitness()
    expect(recents.at(-1)?.tool).toBe('tool-39')
    expect(recents.some((c) => c.tool === 'tool-0')).toBe(false)
  })

  it('tells a refusal from an applied call', () => {
    recordCall('log_step', true)
    recordCall('resume_task', false)
    const { total, refused, recents } = getWitness()
    expect(total).toBe(2)
    expect(refused).toBe(1)
    expect(recents.filter((c) => c.refused)).toHaveLength(1)
  })

  it('returns a snapshot, not its live array', () => {
    recordCall('a', false)
    const retenu = getWitness()
    recordCall('b', false)

    expect(retenu.recents).toHaveLength(1)
    expect(retenu.total).toBe(1)
    expect(getWitness().recents).toHaveLength(2)
  })

  it('resets counters and memory', () => {
    for (let i = 0; i < 30; i++) recordCall('x', true)
    resetCalls()
    expect(getWitness()).toMatchObject({ total: 0, refused: 0 })
    expect(getWitness().recents).toHaveLength(0)
  })

  it('notifies its subscribers, and stops when they withdraw', () => {
    let vus = 0
    const stop = onCall(() => {
      vus += 1
    })
    recordCall('a', false)
    recordCall('b', true)
    stop()
    recordCall('c', false)
    expect(vus).toBe(2)
  })
})
