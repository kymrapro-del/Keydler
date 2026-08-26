import { beforeEach, describe, expect, it } from 'vitest'
import { createTask } from '../src/domain/task'
import { SCHEMA_VERSION } from '../src/domain/types'
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
