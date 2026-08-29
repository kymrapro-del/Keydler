import { describe, expect, it } from 'vitest'
import { buildCoreTask } from '../src/demo/seed'
import { MAX_LINK_LENGTH, unpackTask } from '../src/export/link'
import { historyOf } from '../src/domain/trail'
import { addConstraint, logStep, setConstraintActive } from '../src/domain/task'
import { MAX_AUDIT_ENTRIES } from '../src/domain/types'
import { normalizeTask } from '../src/persistence/normalize'

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function gzip(text: string): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
  const gz = new CompressionStream('gzip') as unknown as {
    readable: ReadableStream<Uint8Array>
    writable: WritableStream<unknown>
  }
  void source.pipeTo(gz.writable as WritableStream<Uint8Array>)
  const out = gz.readable
  const chunks: Uint8Array[] = []
  const reader = out.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const merged = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    merged.set(c, at)
    at += c.length
  }
  return merged
}

describe('a hostile link', () => {
  it('refuses a payload that decompresses into an enormous mass', async () => {
    // A "zip bomb": a payload under the input bound, at gzip's maximum ratio.
    // Since the link is opened by the victim, bounding the input protects
    // nothing: it is the output that has to be bounded.
    const huge = JSON.stringify({ id: 'bomb', title: 'x'.repeat(6_000_000), version: 1 })
    const packed = `z${toBase64Url(await gzip(huge))}`
    expect(packed.length).toBeLessThan(MAX_LINK_LENGTH)

    await expect(unpackTask(packed)).rejects.toThrow()
  })

  it('refuses a payload whose JSON is valid but oversized', async () => {
    const listes = JSON.stringify({
      id: 'flood',
      title: 'Flood',
      version: 1,
      steps: Array.from({ length: 60_000 }, () => ({ id: 's', action: 'a', result: 'b' })),
    })
    const packed = `z${toBase64Url(await gzip(listes))}`
    expect(packed.length).toBeLessThan(MAX_LINK_LENGTH)

    await expect(unpackTask(packed)).rejects.toThrow()
  })
})

describe('an oversized payload is refused before it is even read', () => {
  it('refuses a link longer than anything it can produce, valid or not', async () => {
    // A perfectly valid task, simply too long. Without the input bound it would
    // be accepted: that is what isolates this particular guard.
    const valide = JSON.stringify({
      ...buildCoreTask(),
      title: 'x'.repeat(20_000),
    })
    const packed = `p${toBase64Url(new TextEncoder().encode(valide))}`
    expect(packed.length).toBeGreaterThan(MAX_LINK_LENGTH)

    await expect(unpackTask(packed)).rejects.toThrow()
  })

  it('accepts the same log once it is under the bound', async () => {
    const valide = JSON.stringify(buildCoreTask())
    const packed = `p${toBase64Url(new TextEncoder().encode(valide))}`
    expect(packed.length).toBeLessThan(MAX_LINK_LENGTH)

    expect((await unpackTask(packed)).title).toBe(buildCoreTask().title)
  })
})

describe('a received log carries no endless audit trail', () => {
  it('applies the same bound as on write', () => {
    const inflated = {
      ...buildCoreTask(),
      audit: Array.from({ length: MAX_AUDIT_ENTRIES * 3 }, (_, i) => ({
        id: `e${i}`,
        operation: 'log_step',
        actor: 'agent',
        versionBefore: i,
        versionAfter: i + 1,
        basedOnVersion: null,
        outcome: 'applied',
        detail: `entry ${i}`,
        at: i,
      })),
    }

    const propre = normalizeTask(inflated as never)!
    expect(propre.audit.length).toBe(MAX_AUDIT_ENTRIES)
    // It is the most recent ones that survive, as on write.
    expect(propre.audit.at(-1)!.detail).toBe(`entry ${MAX_AUDIT_ENTRIES * 3 - 1}`)
  })
})

describe('the history of one item when the audit trail has been trimmed', () => {
  it('does not let it look complete', () => {
    let task = buildCoreTask()
    const rule = task.constraints[0]
    task = setConstraintActive(task, rule.id, false)

    for (let i = 0; i < MAX_AUDIT_ENTRIES + 20; i++) {
      task = logStep(task, { action: `step ${i}`, result: 'x', basedOnVersion: null }, 'agent')
    }

    // The lifting fell out of the bounded log.
    const trail = historyOf(task, rule.id)
    expect(trail.entries).toHaveLength(0)
    // And it says so, rather than letting it look like nothing happened.
    expect(trail.mayBeIncomplete).toBe(true)
    expect(task.audit.some((e) => e.operation === 'audit_trimmed')).toBe(true)
  })
})

describe('the anti-repeat guard', () => {
  it('does not block a rule returned to the proposed state and then added again', () => {
    const task = buildCoreTask()
    const declined = {
      ...task,
      constraints: task.constraints.map((c, i) =>
        i === 0 ? { ...c, standing: 'declined' as const, active: false } : c,
      ),
    }
    expect(() =>
      addConstraint(declined, { rule: task.constraints[0].rule, basedOnVersion: null }, 'human'),
    ).not.toThrow()
  })
})
