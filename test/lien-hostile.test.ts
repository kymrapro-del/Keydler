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

describe('un lien hostile', () => {
  it('refuse une charge qui se décompresse en une masse énorme', async () => {
    // Un « zip bomb » : une charge SOUS la borne d'entrée, au ratio maximal de
    // gzip. Le lien étant ouvert par la victime, borner l'entrée ne protège de
    // rien — c'est la sortie qu'il faut borner.
    const énorme = JSON.stringify({ id: 'bomb', title: 'x'.repeat(6_000_000), version: 1 })
    const packed = `z${toBase64Url(await gzip(énorme))}`
    expect(packed.length).toBeLessThan(MAX_LINK_LENGTH)

    await expect(unpackTask(packed)).rejects.toThrow()
  })

  it('refuse une charge dont le JSON est valide mais démesuré', async () => {
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

describe('une charge démesurée est refusée avant même d’être lue', () => {
  it('refuse un lien plus long que ce que l’on sait produire, même valide', async () => {
    // Un cahier PARFAITEMENT valide, simplement trop long. Sans la borne
    // d'entrée il serait accepté : c'est ce qui isole cette garde-là.
    const valide = JSON.stringify({
      ...buildCoreTask(),
      title: 'x'.repeat(20_000),
    })
    const packed = `p${toBase64Url(new TextEncoder().encode(valide))}`
    expect(packed.length).toBeGreaterThan(MAX_LINK_LENGTH)

    await expect(unpackTask(packed)).rejects.toThrow()
  })

  it('accepte le même cahier une fois sous la borne', async () => {
    const valide = JSON.stringify(buildCoreTask())
    const packed = `p${toBase64Url(new TextEncoder().encode(valide))}`
    expect(packed.length).toBeLessThan(MAX_LINK_LENGTH)

    expect((await unpackTask(packed)).title).toBe(buildCoreTask().title)
  })
})

describe('un cahier reçu ne porte pas un journal sans fin', () => {
  it('applique la même borne qu’à l’écriture', () => {
    const gonflé = {
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

    const propre = normalizeTask(gonflé as never)!
    expect(propre.audit.length).toBe(MAX_AUDIT_ENTRIES)
    // Ce sont les plus récentes qui survivent, comme à l'écriture.
    expect(propre.audit.at(-1)!.detail).toBe(`entry ${MAX_AUDIT_ENTRIES * 3 - 1}`)
  })
})

describe('l’histoire d’un élément quand le journal a été élagué', () => {
  it('ne laisse pas croire qu’elle est complète', () => {
    let task = buildCoreTask()
    const rule = task.constraints[0]
    task = setConstraintActive(task, rule.id, false)

    for (let i = 0; i < MAX_AUDIT_ENTRIES + 20; i++) {
      task = logStep(task, { action: `step ${i}`, result: 'x', basedOnVersion: null }, 'agent')
    }

    // La levée est tombée hors du journal borné.
    expect(historyOf(task, rule.id)).toHaveLength(0)
    expect(task.audit.some((e) => e.operation === 'audit_trimmed')).toBe(true)
  })
})

describe('la garde anti-répétition', () => {
  it('ne bloque pas une règle rendue à l’état de proposition puis reposée', () => {
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
