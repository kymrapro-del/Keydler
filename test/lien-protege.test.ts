import { describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import {
  isSealedLink,
  MAX_LINK_LENGTH,
  packSealedTask,
  packTask,
  unpackTask,
  unsealTask,
  UnreadableLinkError,
} from '../src/export/link'
import { WrongPassphraseError } from '../src/persistence/vault'

const PHRASE = 'la phrase que je t’ai dite au téléphone'

// A URL fragment is a bearer capability: checking an identity would need a
// server, demanding knowledge of a secret does not. That is NOT the same thing,
// and these tests say which of the two is held.
describe('un lien qu’une phrase de passe protège', () => {
  it('se rouvre avec la bonne phrase, et rend le cahier intact', async () => {
    const task = buildDemoTask()
    const packed = await packSealedTask(task, PHRASE)

    expect(isSealedLink(packed)).toBe(true)
    const relu = await unsealTask(packed, PHRASE)
    expect(relu.id).toBe(task.id)
    expect(relu.title).toBe(task.title)
    expect(relu.steps.map((s) => s.action)).toEqual(task.steps.map((s) => s.action))
    expect(relu.constraints.map((c) => c.rule)).toEqual(task.constraints.map((c) => c.rule))
  })

  it('refuse une phrase fausse, et le dit comme une phrase fausse', async () => {
    // Not "this link is unreadable": someone who has just typed a passphrase
    // has to know that the passphrase is at fault, not the link.
    const packed = await packSealedTask(buildDemoTask(), PHRASE)
    await expect(unsealTask(packed, 'pas la bonne phrase du tout')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    )
  })

  it('ne laisse rien de lisible dans le lien', async () => {
    const task = buildDemoTask()
    const packed = await packSealedTask(task, PHRASE)

    // The title, a rule and a step: nothing must show through, neither in the
    // clear nor as base64 of the clear.
    for (const secret of [task.title, task.constraints[0].rule, task.steps[0].action, task.id]) {
      expect(packed, secret).not.toContain(secret)
      expect(packed, `${secret} (base64)`).not.toContain(
        btoa(secret).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      )
    }
  })

  it('produit un lien différent à chaque fois, sur le même cahier', async () => {
    // Salt and IV drawn at random: two identical links would reveal that they
    // carry the same log, to anyone who saw both go by.
    const task = buildDemoTask()
    const plain = await packSealedTask(task, PHRASE)
    const deux = await packSealedTask(task, PHRASE)
    expect(plain).not.toBe(deux)
  })

  it('reste sous la borne de longueur, et le dit s’il la dépasse', async () => {
    const packed = await packSealedTask(buildDemoTask(), PHRASE)
    expect(packed.length).toBeLessThanOrEqual(MAX_LINK_LENGTH)

    // We need content that does NOT compress: 60,000 "x" fit in a few hundred
    // bytes once gzipped, and would pass the bound.
    const bruit = Array.from(
      { length: 4000 },
      (_, i) => `${i}-${Math.abs(Math.sin(i) * 1e15).toString(36)}`,
    ).join(' ')
    const huge = { ...buildDemoTask(), title: bruit }
    await expect(packSealedTask(huge, PHRASE)).rejects.toThrow(/Export this task/)
  })

  it('refuse une phrase vide plutôt que de sceller avec rien', async () => {
    await expect(packSealedTask(buildDemoTask(), '   ')).rejects.toThrow()
  })
})

describe('les deux sortes de liens ne se confondent pas', () => {
  it('reconnaît un lien ordinaire comme non protégé', async () => {
    const packed = await packTask(buildDemoTask())
    expect(isSealedLink(packed)).toBe(false)
    expect((await unpackTask(packed)).title).toBe(buildDemoTask().title)
  })

  it('refuse de desceller un lien qui n’est pas scellé', async () => {
    const packed = await packTask(buildDemoTask())
    await expect(unsealTask(packed, PHRASE)).rejects.toBeInstanceOf(UnreadableLinkError)
  })

  it('refuse d’ouvrir un lien scellé par le chemin ordinaire', async () => {
    // Without this the recipient would see "unreadable link" where they should
    // be asked for a passphrase.
    const packed = await packSealedTask(buildDemoTask(), PHRASE)
    await expect(unpackTask(packed)).rejects.toBeInstanceOf(UnreadableLinkError)
  })

  it('refuse un lien scellé tronqué ou bricolé', async () => {
    const packed = await packSealedTask(buildDemoTask(), PHRASE)
    await expect(unsealTask(packed.slice(0, packed.length - 40), PHRASE)).rejects.toThrow()
    await expect(unsealTask('s' + 'A'.repeat(200), PHRASE)).rejects.toBeInstanceOf(
      UnreadableLinkError,
    )
  })
})
