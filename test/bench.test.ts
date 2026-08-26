import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { getDb } from '../src/persistence/db'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { resetCalls } from '../src/webmcp/witness'

/**
 * La vue du banc d'essai.
 *
 * Ces cas existent parce que huit des quinze constats de la revue vivaient dans
 * ce code, et qu'aucun test ne l'atteignait — ce qui est précisément pourquoi
 * ils avaient tous passé la CI. Chacun ci-dessous verrouille l'un d'eux.
 */

let root: HTMLElement
let démonter: () => void

async function viderBase() {
  const db = await getDb()
  const tx = db.transaction(['tasks', 'meta'], 'readwrite')
  await Promise.all([tx.objectStore('tasks').clear(), tx.objectStore('meta').clear(), tx.done])
}

/** Laisse passer les micro-tâches ET la frame que `scheduleRender` attend. */
async function rendu() {
  await new Promise((r) => setTimeout(r, 0))
  __renderNow()
}

beforeEach(async () => {
  store.__resetStore()
  resetCalls()
  await viderBase()
  document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
  root = document.querySelector<HTMLElement>('#app')!
  démonter = mount(root)
})

afterEach(() => démonter())

describe('état vide', () => {
  it('n’émet pas de lien d’évitement sans ancre où aller', async () => {
    await rendu()
    // Le lien était rendu inconditionnellement alors que son ancre vit dans la
    // supervision, absente tant qu'aucun cahier n'est ouvert : le premier arrêt
    // de tabulation du premier écran ne menait nulle part.
    expect(root.querySelector('.skip-link')).toBeNull()
    expect(root.querySelector('#supervision-ancre')).toBeNull()
  })

  it('ne laisse pas fuir la restitution destinée à l’agent', async () => {
    // Sans cet `init`, on observerait l'état de CHARGEMENT en croyant observer
    // l'état vide — deux écrans différents.
    await store.init()
    await rendu()
    expect(root.textContent).not.toContain('NO ACTIVE TASK')
    expect(root.textContent).toContain('Aucun cahier ouvert')
  })
})

describe('avec un cahier', () => {
  beforeEach(async () => {
    await store.openPreparedTask(buildDemoTask())
    await rendu()
  })

  it('émet le lien d’évitement et son ancre ensemble', () => {
    expect(root.querySelector('.skip-link')).not.toBeNull()
    expect(root.querySelector('#supervision-ancre')).not.toBeNull()
  })

  it('n’impose pas de validation native au champ du motif', () => {
    // `required` faisait bloquer la soumission par le navigateur, si bien que le
    // domaine n'arbitrait jamais et que son message restait inatteignable.
    const motif = root.querySelector<HTMLInputElement>('#new-rejection-reason')!
    expect(motif.required).toBe(false)
    expect(root.querySelector<HTMLFormElement>('#form-rejet')!.noValidate).toBe(true)
    expect(root.querySelector<HTMLFormElement>('#form-contrainte')!.noValidate).toBe(true)
  })

  it('propose de valider les preuves LES PLUS ANCIENNES d’abord', () => {
    // Prendre les plus récentes rendait les anciennes inatteignables tant que
    // les nouvelles n'étaient pas traitées, alors que le clic humain est le seul
    // chemin vers « human_verified ».
    const première = root.querySelector('[data-verify]')!.closest('li')!
    // La file exclut à juste titre ce qu'un humain a déjà validé : la plus
    // ancienne EN ATTENTE, donc, pas la plus ancienne tout court.
    const attendue = store
      .currentTask()!
      .steps.find((s) => s.evidence !== null && s.confidence !== 'human_verified')!
    expect(première.textContent).toContain(attendue.action)
  })

  it('conserve la saisie quand le domaine refuse la règle', async () => {
    const champ = root.querySelector<HTMLInputElement>('#new-constraint')!
    const trop = 'R'.repeat(2500)
    champ.value = trop
    champ.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector<HTMLFormElement>('#form-contrainte')!.requestSubmit()

    await rendu()
    // Vidé avant la mutation, un texte refusé pour longueur disparaissait et ne
    // pouvait plus être raccourci.
    expect(root.querySelector<HTMLInputElement>('#new-constraint')!.value).toHaveLength(2500)
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('dépasse 2000')
  })

  it('parle français quand une action humaine échoue', async () => {
    const champ = root.querySelector<HTMLInputElement>('#new-rejection')!
    champ.value = 'Approche X'
    champ.dispatchEvent(new Event('input', { bubbles: true }))
    root.querySelector<HTMLFormElement>('#form-rejet')!.requestSubmit()

    await rendu()
    const alerte = root.querySelector('[role="alert"]')!.textContent!
    expect(alerte).toContain('le motif ne peut pas être vide')
    // Aucun message d'agent ne doit atteindre l'écran d'une personne.
    expect(alerte).not.toContain('resume_task')
    expect(alerte).not.toContain('INVALID INPUT')
  })

  it('efface le reproche sans détruire le champ en cours de frappe', async () => {
    const motif = root.querySelector<HTMLInputElement>('#new-rejection-reason')!
    root.querySelector<HTMLFormElement>('#form-rejet')!.requestSubmit()
    await rendu()
    expect(root.querySelector('[role="alert"]')).not.toBeNull()

    const avant = root.querySelector('#new-rejection-reason')
    motif.value = 'x'
    motif.dispatchEvent(new Event('input', { bubbles: true }))

    // Le nœud doit être le MÊME : un rendu complet interromprait une
    // composition et viderait la pile d'annulation du navigateur.
    expect(root.querySelector('#new-rejection-reason')).toBe(avant)
    expect(root.querySelector('[role="alert"]')).toBeNull()
  })

  it('annonce dans une région qui survit au rendu', async () => {
    const région = document.querySelector('#annonces')!
    expect(région.textContent).toContain(`Version ${store.currentTask()!.version}`)
    // La région vit hors de la racine remplacée : sinon elle serait du DOM neuf
    // à chaque mise à jour, donc muette pour une aide technique.
    expect(root.contains(région)).toBe(false)
  })
})
