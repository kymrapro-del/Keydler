import { beforeEach, describe, expect, it } from 'vitest'
import { createTask } from '../src/domain/task'
import { MAX_MUTATION_RECORDS, SCHEMA_VERSION } from '../src/domain/types'
import { getDb } from '../src/persistence/db'
import { FutureSchemaError, normalizeTask } from '../src/persistence/normalize'
import { escapeHtml } from '../src/ui/escape'
import { listTasks, loadTask, saveTask } from '../src/persistence/taskRepository'

/**
 * Lecture d'enregistrements écrits par une autre version du code.
 *
 * Le schéma a déjà bougé une fois pendant le développement. Un cahier écrit
 * hier ne doit pas faire planter la page aujourd'hui : la donnée est là, elle
 * est simplement incomplète.
 */

async function clear() {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('tasks').clear(), tx.objectStore('meta').clear(), tx.done])
}

/** Écrit un enregistrement brut, sans passer par le dépôt. */
async function écrireBrut(record: unknown) {
  const db = await getDb()
  await db.put('tasks', record as never)
}

beforeEach(clear)

describe('normalisation à la lecture', () => {
  it('survit à un enregistrement sans journal ni tableaux', async () => {
    await écrireBrut({ id: 'ancien', title: 'Cahier d’hier', version: 7, updatedAt: 1 })

    const task = await loadTask('ancien')
    expect(task).toBeDefined()
    expect(task!.version).toBe(7)
    expect(task!.audit).toEqual([])
    expect(task!.steps).toEqual([])
    expect(task!.constraints).toEqual([])
    expect(task!.rejected).toEqual([])
    expect(task!.decisions).toEqual([])
  })

  it('tient une contrainte à l’état illisible pour ACTIVE', () => {
    const task = normalizeTask({
      id: 'x',
      version: 1,
      constraints: [{ id: 'c1', rule: 'Ne pas toucher au schéma' }],
    } as never)

    // En cas de doute on garde la règle : la lever en silence serait la pire
    // des issues pour un produit qui existe pour imposer des interdits.
    expect(task!.constraints[0].active).toBe(true)
  })

  it('ramène un degré de preuve inconnu à « affirmé »', () => {
    const task = normalizeTask({
      id: 'x',
      version: 1,
      steps: [{ id: 's1', action: 'a', result: 'b', confidence: 'totalement_prouvé' }],
    } as never)

    expect(task!.steps[0].confidence).toBe('claimed')
  })

  it('écarte une preuve dont la nature est inconnue', () => {
    const task = normalizeTask({
      id: 'x',
      version: 1,
      steps: [
        { id: 's1', action: 'a', result: 'b', evidence: { kind: 'télépathie', content: 'x' } },
      ],
    } as never)

    expect(task!.steps[0].evidence).toBeNull()
  })

  it('conserve un identifiant tel quel : c’est la clé primaire', async () => {
    // Le réduire à la lecture faisait qu'un enregistrement ne correspondait
    // plus à sa propre clé : `saveTask` cherchait alors une clé inexistante,
    // sautait la comparaison de version sans erreur, et forkait un second
    // enregistrement. L'échappement est l'affaire du rendu, pas de la lecture.
    const bizarre = 'x" onload="alert(1)'
    await écrireBrut({ id: bizarre, title: 'Cahier', version: 3, updatedAt: 1 })

    const relu = await loadTask(bizarre)
    expect(relu?.id).toBe(bizarre)
    // Et il reste retrouvable par sa clé, ce qui est tout l'enjeu.
    expect(relu?.version).toBe(3)
  })

  it('neutralise un identifiant hostile au rendu, pas au stockage', () => {
    const task = normalizeTask({
      id: 'x" onload="alert(1)',
      version: 1,
      steps: [{ id: 's1"><script>', action: 'a', result: 'b' }],
    } as never)

    // Intacts en mémoire…
    expect(task!.steps[0].id).toBe('s1"><script>')
    // …et inoffensifs une fois interpolés dans un attribut.
    expect(escapeHtml(task!.steps[0].id)).not.toContain('"')
    expect(escapeHtml(task!.steps[0].id)).not.toContain('<')
  })

  it('refuse un enregistrement écrit par une version plus récente', async () => {
    await écrireBrut({ id: 'futur', title: 'X', version: 1, schemaVersion: SCHEMA_VERSION + 1 })

    // Mieux vaut un message clair qu'un cahier tronqué par un code qui ne
    // comprend pas ce qu'il lit.
    await expect(loadTask('futur')).rejects.toBeInstanceOf(FutureSchemaError)
  })

  it('n’emporte pas toute la liste pour un enregistrement illisible', async () => {
    const sain = createTask({ title: 'Sain', next: 'Continuer' })
    await saveTask(sain)
    await écrireBrut({ id: 'futur', title: 'X', version: 1, schemaVersion: SCHEMA_VERSION + 1 })

    const tasks = await listTasks()
    expect(tasks.map((t) => t.title)).toEqual(['Sain'])
  })

  it('répare décisions, rejets et journal d’un enregistrement mutilé', () => {
    // Ces trois tableaux n'étaient couverts par aucun cas : ce sont pourtant
    // eux qui portent le « pourquoi » et les interdits, donc l'essentiel.
    const task = normalizeTask({
      id: 'x',
      version: 2,
      decisions: [{ id: 'd1', choice: 'Approche C' }, null],
      rejected: [{ id: 'r1', approach: 'JWT B', source: 'human' }, null],
      audit: [{ id: 'a1', operation: 'log_step', outcome: 'refused', repeated: 3 }, { id: 'a2' }],
    } as never)

    // L'entrée nulle est écartée, pas relayée : le reste du cahier est sauvé.
    expect(task!.decisions).toHaveLength(1)
    expect(task!.decisions[0]).toMatchObject({
      choice: 'Approche C',
      rationale: '',
      source: 'agent',
    })
    expect(task!.rejected).toHaveLength(1)
    expect(task!.rejected[0]).toMatchObject({ approach: 'JWT B', reason: '', source: 'human' })
    expect(task!.audit[0]).toMatchObject({ outcome: 'refused', repeated: 3 })
    // Une issue illisible est tenue pour appliquée, pas pour un refus inventé,
    // et une source illisible retombe sur « agent » : jamais sur « human »,
    // qui conférerait à tort l'autorité humaine à une conjecture.
    expect(task!.audit[1].outcome).toBe('applied')
    expect(task!.audit[1].actor).toBe('agent')
    expect(task!.audit[1].repeated).toBeUndefined()
  })

  it('conserve intact un cahier normal', async () => {
    const original = createTask({ title: 'Normal', next: 'Suite' })
    await saveTask(original)

    const relu = await loadTask(original.id)
    expect(relu).toMatchObject({
      id: original.id,
      title: 'Normal',
      version: original.version,
      next: 'Suite',
      status: 'active',
    })
    expect(relu!.audit).toHaveLength(original.audit.length)
  })
})

describe('migration du schéma v1', () => {
  /** Un enregistrement tel que la version précédente l'écrivait. */
  function v1(): Record<string, unknown> {
    return {
      id: 'ancien-1',
      title: 'Tâche d’avant',
      version: 4,
      status: 'active',
      schemaVersion: 1,
      constraints: [
        { id: 'c1', rule: 'Règle humaine', source: 'human', addedAtVersion: 2, active: true },
        { id: 'c2', rule: 'Règle d’agent', source: 'agent', addedAtVersion: 3, active: true },
      ],
      rejected: [
        { id: 'r1', approach: 'A', reason: 'r', source: 'human', addedAtVersion: 2 },
        { id: 'r2', approach: 'B', reason: 'r', source: 'agent', addedAtVersion: 3 },
      ],
      steps: [
        {
          id: 's1',
          action: 'Lancé les tests',
          result: 'ok',
          confidence: 'machine_verified',
          evidence: { kind: 'test_report', content: '183 passed', verifiedAt: null },
        },
      ],
      decisions: [],
      audit: [],
    }
  }

  it('rend à l’humain une autorité qu’on lui avait prise', () => {
    const task = normalizeTask(v1() as never)!

    // Ce qu'un humain avait écrit était déjà autoritaire ; ce qu'un agent avait
    // écrit ne l'a jamais été légitimement. Le relire comme une proposition
    // rend une décision à celui qui aurait dû la prendre.
    expect(task.constraints[0].standing).toBe('accepted')
    expect(task.constraints[1].standing).toBe('proposed')
    expect(task.rejected[0].standing).toBe('accepted')
    expect(task.rejected[1].standing).toBe('proposed')
  })

  it('rebaptise « machine_verified » sans inventer un clic humain', () => {
    const task = normalizeTask(v1() as never)!

    // L'enregistrement décrivait une preuve jointe et non lue : c'est
    // exactement « evidence ». Le monter en « human_verified » inventerait une
    // validation qui n'a jamais eu lieu ; le rétrograder en « claimed »
    // effacerait une preuve qui, elle, existe bel et bien.
    expect(task.steps[0].confidence).toBe('evidence')
    expect(task.steps[0].evidence?.content).toBe('183 passed')
    expect(task.steps[0].evidence?.verifiedAt).toBeNull()
  })

  it('donne une mémoire de mutations vide plutôt que de planter dessus', () => {
    const task = normalizeTask(v1() as never)!
    // Un cahier d'avant repart sans garantie d'idempotence : c'est le
    // comportement d'avant, pas une régression.
    expect(task.mutations).toEqual([])
  })

  it('reborne et nettoie une mémoire de mutations douteuse', () => {
    const stored = {
      ...v1(),
      schemaVersion: 3,
      mutations: [
        { id: '', operation: 'log_step', version: 2, fingerprint: 'f', result: 'x', at: 1 },
        ...Array.from({ length: MAX_MUTATION_RECORDS + 20 }, (_, i) => ({
          id: `m${i}`,
          operation: 'log_step',
          version: i,
          fingerprint: `f${i}`,
          result: 'ok',
          at: i,
        })),
      ],
    }
    const task = normalizeTask(stored as never)!
    expect(task.mutations.length).toBe(MAX_MUTATION_RECORDS)
    expect(task.mutations.every((m) => m.id !== '')).toBe(true)
  })

  it('écarte une mutation v2, dont l’intention n’est pas vérifiable', () => {
    const stored = {
      ...v1(),
      schemaVersion: 2,
      mutations: [
        { id: 'm-avec', operation: 'log_step', version: 2, fingerprint: 'f', result: 'ok', at: 1 },
        { id: 'm-sans', operation: 'log_step', version: 3, result: 'ok', at: 2 },
      ],
    }
    const task = normalizeTask(stored as never)!

    // L'empreinte est arrivée en v3 : sans elle, on ne peut pas comparer
    // l'intention d'un réessai à celle de l'appel d'origine. La conserver
    // reviendrait à garder, pour les cahiers déjà sur disque, le défaut même
    // qu'elle corrige — rendre la réponse du premier appel à un second travail.
    expect(task.mutations.map((m) => m.id)).toEqual(['m-avec'])
  })

  it('refuse toujours un enregistrement plus récent que le code qui le lit', () => {
    expect(() => normalizeTask({ ...v1(), schemaVersion: 99 } as never)).toThrow(FutureSchemaError)
  })
})
