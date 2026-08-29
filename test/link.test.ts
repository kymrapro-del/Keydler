import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { addConstraint, logStep } from '../src/domain/task'
import {
  MAX_LINK_LENGTH,
  TooLargeForLinkError,
  packTask,
  readLinkFragment,
  unpackTask,
} from '../src/export/link'
import type { TaskState } from '../src/domain/types'

describe('a notebook that fits in a link', () => {
  it('makes the round trip without losing anything', async () => {
    const task = buildDemoTask()
    const packed = await packTask(task)
    const back = await unpackTask(packed)

    expect(back.id).toBe(task.id)
    expect(back.title).toBe(task.title)
    expect(back.version).toBe(task.version)
    expect(back.constraints.map((c) => c.rule)).toEqual(task.constraints.map((c) => c.rule))
    expect(back.steps.map((s) => s.action)).toEqual(task.steps.map((s) => s.action))
    expect(back.steps[0].evidence).toEqual(task.steps[0].evidence)
    expect(back.audit.length).toBe(task.audit.length)
  })

  it('produces only characters that are safe in a URL', async () => {
    const packed = await packTask(buildDemoTask())
    expect(packed).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('refuses a notebook too large rather than producing a broken link', async () => {
    let big = buildDemoTask()
    for (let i = 0; i < 400; i++) {
      big = logStep(
        big,
        {
          action: `Step number ${i} with a long enough action to weigh something`,
          result: 'x'.repeat(300),
          evidence: { kind: 'command_output', content: 'y'.repeat(1200) },
          basedOnVersion: null,
        },
        'agent',
      )
    }

    // A link truncated by a mail client is worse than a clear refusal.
    await expect(packTask(big)).rejects.toBeInstanceOf(TooLargeForLinkError)
    await expect(packTask(big)).rejects.toThrow(/export/i)
  })

  it('stays under the limit for an ordinary notebook', async () => {
    let task = buildDemoTask()
    for (let i = 0; i < 20; i++) {
      task = addConstraint(task, { rule: `Rule number ${i}`, basedOnVersion: null }, 'human')
    }
    expect((await packTask(task)).length).toBeLessThan(MAX_LINK_LENGTH)
  })

  it('refuses a damaged fragment without bringing the page down', async () => {
    await expect(unpackTask('definitely-not-a-task')).rejects.toThrow()
    await expect(unpackTask('')).rejects.toThrow()
  })

  it('refuses a fragment that decodes to something other than a notebook', async () => {
    const notATask = await packTask({ nope: true } as unknown as TaskState)
    await expect(unpackTask(notATask)).rejects.toThrow()
  })

  it('works without CompressionStream, settling for being longer', async () => {
    const real = globalThis.CompressionStream
    // @ts-expect-error the API is removed on purpose to exercise the fallback
    delete globalThis.CompressionStream

    try {
      const task = buildDemoTask()
      const packed = await packTask(task)
      expect((await unpackTask(packed)).title).toBe(task.title)
    } finally {
      globalThis.CompressionStream = real
    }
  })

  it('compresses for real when the API is there', async () => {
    if (typeof globalThis.CompressionStream !== 'function') return

    const task = buildDemoTask()
    const withCompression = await packTask(task)

    const real = globalThis.CompressionStream
    // @ts-expect-error deliberate fallback, to compare
    delete globalThis.CompressionStream
    const without = await packTask(task)
    globalThis.CompressionStream = real

    expect(withCompression.length).toBeLessThan(without.length)
  })
})

describe('what a link never carries', () => {
  it('holds no credential value, since the notebook holds none', async () => {
    const packed = await packTask(buildDemoTask())
    const decoded = JSON.stringify(await unpackTask(packed))
    for (const word of ['ciphertext', 'passphrase', 'sealed', 'secrets']) {
      expect(decoded, word).not.toContain(word)
    }
  })
})

describe('reading the fragment of a URL', () => {
  const original = window.location.hash

  afterEach(() => {
    history.replaceState(null, '', original || '/')
  })

  it('finds nothing on an ordinary URL', () => {
    history.replaceState(null, '', '/t/abc')
    expect(readLinkFragment()).toBeNull()
  })

  it('finds the payload when it is there', () => {
    history.replaceState(null, '', '/t/abc#log=AbC-_123')
    expect(readLinkFragment()).toBe('AbC-_123')
  })

  it('ignores a fragment that is not ours', () => {
    history.replaceState(null, '', '/t/abc#section-2')
    expect(readLinkFragment()).toBeNull()
  })

  it('refuses a payload with doubtful characters rather than decoding it', () => {
    history.replaceState(null, '', '/t/abc#log=<script>')
    expect(readLinkFragment()).toBeNull()
  })
})

describe('the limit is announced, not guessed', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('fits what browsers and mail clients accept', () => {
    expect(MAX_LINK_LENGTH).toBeLessThanOrEqual(16_000)
    expect(MAX_LINK_LENGTH).toBeGreaterThan(2_000)
  })
})
