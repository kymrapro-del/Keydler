import { beforeEach, describe, expect, it } from 'vitest'
import { getWitness, onCall, recordCall, resetCalls } from '../src/webmcp/witness'

beforeEach(resetCalls)

describe('témoin d’appels', () => {
  it('compte tout, même ce qu’il ne retient pas', () => {
    for (let i = 0; i < 500; i++) recordCall('resume_task', i % 5 === 0)

    const { total, refused, recents } = getWitness()
    expect(total).toBe(500)
    expect(refused).toBe(100)
    expect(recents.length).toBeLessThanOrEqual(20)
  })

  it('retient les plus récents, pas les premiers', () => {
    for (let i = 0; i < 40; i++) recordCall(`outil-${i}`, false)
    const { recents } = getWitness()
    expect(recents.at(-1)?.tool).toBe('outil-39')
    expect(recents.some((c) => c.tool === 'outil-0')).toBe(false)
  })

  it('distingue un refus d’un appel appliqué', () => {
    recordCall('log_step', true)
    recordCall('resume_task', false)
    const { total, refused, recents } = getWitness()
    expect(total).toBe(2)
    expect(refused).toBe(1)
    expect(recents.filter((c) => c.refused)).toHaveLength(1)
  })

  it('rend un instantané, pas son tableau vivant', () => {
    recordCall('a', false)
    const retenu = getWitness()
    recordCall('b', false)

    expect(retenu.recents).toHaveLength(1)
    expect(retenu.total).toBe(1)
    expect(getWitness().recents).toHaveLength(2)
  })

  it('remet à zéro compteurs et mémoire', () => {
    for (let i = 0; i < 30; i++) recordCall('x', true)
    resetCalls()
    expect(getWitness()).toMatchObject({ total: 0, refused: 0 })
    expect(getWitness().recents).toHaveLength(0)
  })

  it('prévient ses abonnés, et cesse quand ils se retirent', () => {
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
