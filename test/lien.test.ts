import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { addConstraint, logStep } from '../src/domain/task'
import {
  MAX_LINK_LENGTH,
  MAX_UNPACKED_LINK_BYTES,
  TooLargeForLinkError,
  UnreadableLinkError,
  packTask,
  readLinkFragment,
  unpackTask,
} from '../src/export/link'
import type { TaskState } from '../src/domain/types'

describe('un cahier qui tient dans un lien', () => {
  it('fait l’aller-retour sans rien perdre', async () => {
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

  it('ne produit que des caractères sûrs dans une adresse', async () => {
    const packed = await packTask(buildDemoTask())
    expect(packed).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('refuse un cahier trop gros plutôt que de produire un lien cassé', async () => {
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

    // Un lien tronqué par un client de messagerie est pire qu'un refus clair.
    await expect(packTask(big)).rejects.toBeInstanceOf(TooLargeForLinkError)
    await expect(packTask(big)).rejects.toThrow(/export/i)
  })

  it('reste sous la limite pour un cahier ordinaire', async () => {
    let task = buildDemoTask()
    for (let i = 0; i < 20; i++) {
      task = addConstraint(task, { rule: `Rule number ${i}`, basedOnVersion: null }, 'human')
    }
    expect((await packTask(task)).length).toBeLessThan(MAX_LINK_LENGTH)
  })

  it('refuse un fragment abîmé, sans faire tomber la page', async () => {
    await expect(unpackTask('pas-du-tout-un-cahier')).rejects.toThrow()
    await expect(unpackTask('')).rejects.toThrow()
  })

  it('borne aussi la taille décompressée d’un fragment hostile', async () => {
    if (typeof globalThis.CompressionStream !== 'function') return

    const oversized = {
      ...buildDemoTask(),
      summary: 'x'.repeat(MAX_UNPACKED_LINK_BYTES + 1),
    }
    const compressor = new CompressionStream('gzip')
    const reader = compressor.readable.getReader()
    const reading = (async () => {
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        size += value.byteLength
      }
      const joined = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        joined.set(chunk, offset)
        offset += chunk.byteLength
      }
      return joined
    })()
    const writer = compressor.writable.getWriter()
    await writer.write(new TextEncoder().encode(JSON.stringify(oversized)))
    await writer.close()
    const bytes = await reading
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const packed = `z${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`

    expect(packed.length).toBeLessThan(MAX_LINK_LENGTH)
    await expect(unpackTask(packed)).rejects.toBeInstanceOf(UnreadableLinkError)
    await expect(packTask(oversized)).rejects.toBeInstanceOf(TooLargeForLinkError)
  })

  it('refuse un fragment qui décode vers autre chose qu’un cahier', async () => {
    const notATask = await packTask({ nope: true } as unknown as TaskState)
    await expect(unpackTask(notATask)).rejects.toThrow()
  })

  it('marche sans CompressionStream, en se contentant d’être plus long', async () => {
    const real = globalThis.CompressionStream
    // @ts-expect-error on retire volontairement l'API pour éprouver le repli
    delete globalThis.CompressionStream

    try {
      const task = buildDemoTask()
      const packed = await packTask(task)
      expect((await unpackTask(packed)).title).toBe(task.title)
    } finally {
      globalThis.CompressionStream = real
    }
  })

  it('compresse réellement quand l’API est là', async () => {
    if (typeof globalThis.CompressionStream !== 'function') return

    const task = buildDemoTask()
    const withCompression = await packTask(task)

    const real = globalThis.CompressionStream
    // @ts-expect-error repli volontaire pour comparer
    delete globalThis.CompressionStream
    const without = await packTask(task)
    globalThis.CompressionStream = real

    expect(withCompression.length).toBeLessThan(without.length)
  })
})

describe('ce qu’un lien ne porte jamais', () => {
  it('ne contient aucune valeur d’identifiant, puisque le cahier n’en tient pas', async () => {
    const packed = await packTask(buildDemoTask())
    const decoded = JSON.stringify(await unpackTask(packed))
    for (const mot of ['ciphertext', 'passphrase', 'sealed', 'secrets']) {
      expect(decoded, mot).not.toContain(mot)
    }
  })
})

describe('lire le fragment d’une adresse', () => {
  const original = window.location.hash

  afterEach(() => {
    history.replaceState(null, '', original || '/')
  })

  it('ne trouve rien sur une adresse ordinaire', () => {
    history.replaceState(null, '', '/t/abc')
    expect(readLinkFragment()).toBeNull()
  })

  it('trouve la charge quand elle est là', () => {
    history.replaceState(null, '', '/t/abc#log=AbC-_123')
    expect(readLinkFragment()).toBe('AbC-_123')
  })

  it('ignore un fragment qui n’est pas le nôtre', () => {
    history.replaceState(null, '', '/t/abc#section-2')
    expect(readLinkFragment()).toBeNull()
  })

  it('refuse une charge aux caractères douteux plutôt que de la décoder', () => {
    history.replaceState(null, '', '/t/abc#log=<script>')
    expect(readLinkFragment()).toBeNull()
  })

  it('ignore un fragment qui dépasse la taille annoncée', () => {
    history.replaceState(null, '', `/t/abc#log=p${'a'.repeat(MAX_LINK_LENGTH)}`)
    expect(readLinkFragment()).toBeNull()
  })
})

describe('la limite est annoncée, pas devinée', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('tient dans ce que les navigateurs et les messageries acceptent', () => {
    expect(MAX_LINK_LENGTH).toBeLessThanOrEqual(16_000)
    expect(MAX_LINK_LENGTH).toBeGreaterThan(2_000)
  })
})
