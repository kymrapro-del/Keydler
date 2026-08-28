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

/**
 * Un lien porte le cahier entier, et personne ne peut savoir qui l'ouvre : un
 * fragment d'URL est une capacité au porteur. Vérifier une identité
 * demanderait un serveur. Ce qui est possible sans serveur, c'est d'exiger la
 * connaissance d'un secret — ce qui n'est PAS la même chose, et ces épreuves
 * disent laquelle des deux est tenue.
 */
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
    // Pas « ce lien est illisible » : quelqu'un qui vient de taper une phrase
    // doit savoir que c'est la phrase qui est en cause, pas le lien.
    const packed = await packSealedTask(buildDemoTask(), PHRASE)
    await expect(unsealTask(packed, 'pas la bonne phrase du tout')).rejects.toBeInstanceOf(
      WrongPassphraseError,
    )
  })

  it('ne laisse rien de lisible dans le lien', async () => {
    const task = buildDemoTask()
    const packed = await packSealedTask(task, PHRASE)

    // Le titre, une règle et une étape : rien ne doit transparaître, ni en
    // clair ni en base64 du clair.
    for (const secret of [task.title, task.constraints[0].rule, task.steps[0].action, task.id]) {
      expect(packed, secret).not.toContain(secret)
      expect(packed, `${secret} (base64)`).not.toContain(
        btoa(secret).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      )
    }
  })

  it('produit un lien différent à chaque fois, sur le même cahier', async () => {
    // Sel et IV tirés au hasard : deux liens identiques révéleraient qu'ils
    // portent le même cahier, à qui les verrait passer tous les deux.
    const task = buildDemoTask()
    const un = await packSealedTask(task, PHRASE)
    const deux = await packSealedTask(task, PHRASE)
    expect(un).not.toBe(deux)
  })

  it('reste sous la borne de longueur, et le dit s’il la dépasse', async () => {
    const packed = await packSealedTask(buildDemoTask(), PHRASE)
    expect(packed.length).toBeLessThanOrEqual(MAX_LINK_LENGTH)

    // Il faut du contenu qui ne se compresse PAS : 60 000 « x » tiennent dans
    // quelques centaines d'octets une fois gzippés, et passeraient la borne.
    const bruit = Array.from(
      { length: 4000 },
      (_, i) => `${i}-${Math.abs(Math.sin(i) * 1e15).toString(36)}`,
    ).join(' ')
    const énorme = { ...buildDemoTask(), title: bruit }
    await expect(packSealedTask(énorme, PHRASE)).rejects.toThrow(/Export this task/)
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
    // Sans quoi le destinataire verrait « lien illisible » là où il faut lui
    // demander une phrase.
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
