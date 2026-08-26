import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { buildMeasureTask } from '../src/demo/measures'
import { buildDemoTask } from '../src/demo/seed'
import { renderTaskState } from '../src/domain/render'
import { acceptedRejections, proposedRejections } from '../src/domain/task'
import { completeTask } from '../src/domain/task'
import { getDb } from '../src/persistence/db'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { resetCalls } from '../src/webmcp/witness'
import { __resetRegistration, registerTools } from '../src/webmcp/register'
import { installModelContext, removeModelContext } from './helpers'

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

/**
 * Laisse une action humaine aboutir, puis force un rendu.
 *
 * Une action passe par la file d'écriture du magasin puis par IndexedDB : un
 * seul tour de boucle ne suffit pas, et attendre trop peu faisait échouer des
 * cas pour une raison qui n'avait rien à voir avec ce qu'ils testaient.
 */
async function rendu(tours = 4) {
  for (let i = 0; i < tours; i++) await new Promise((r) => setTimeout(r, 0))
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

describe('commandes de supervision', () => {
  beforeEach(async () => {
    await store.openPreparedTask(buildDemoTask())
    await rendu()
  })

  it('lève puis rétablit une contrainte, en incrémentant chaque fois', async () => {
    const avant = store.currentTask()!.version
    const bouton = root.querySelector<HTMLButtonElement>('[data-toggle]')!
    const règle = bouton.closest('li')!.querySelector('.regle__texte')!.textContent!.trim()

    bouton.click()
    await rendu()
    expect(store.currentTask()!.version).toBe(avant + 1)
    // Une règle levée disparaît de ce que l'agent relit : c'est tout l'effet.
    expect(renderTaskState(store.currentTask()!)).not.toContain(règle)

    root.querySelector<HTMLButtonElement>('[data-toggle]')!.click()
    await rendu()
    expect(store.currentTask()!.version).toBe(avant + 2)
    expect(renderTaskState(store.currentTask()!)).toContain(règle)
  })

  it('valide une preuve, seul chemin vers « vérifié humain »', async () => {
    const avant = store.currentTask()!.steps.filter((s) => s.confidence === 'human_verified').length
    root.querySelector<HTMLButtonElement>('[data-verify]')!.click()
    await rendu()

    const après = store.currentTask()!.steps.filter((s) => s.confidence === 'human_verified')
    expect(après).toHaveLength(avant + 1)
    // Et la preuve validée quitte la file, sinon on la revaliderait sans fin.
    expect(après.at(-1)!.evidence?.verifiedAt).not.toBeNull()
  })

  it('condamne une approche, marquée humaine et rendue à l’agent', async () => {
    const set = (id: string, v: string) => {
      const champ = root.querySelector<HTMLInputElement>(`#${id}`)!
      champ.value = v
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    }
    set('new-rejection', 'Rotation côté client')
    set('new-rejection-reason', 'expose le jeton au navigateur')
    root.querySelector<HTMLFormElement>('#form-rejet')!.requestSubmit()
    await rendu()

    const rejet = store.currentTask()!.rejected.at(-1)!
    expect(rejet.source).toBe('human')
    expect(renderTaskState(store.currentTask()!)).toContain('[human] Rotation côté client')
    // Les deux champs se vident une fois la mutation acceptée, pas avant.
    expect(root.querySelector<HTMLInputElement>('#new-rejection')!.value).toBe('')
    expect(root.querySelector<HTMLInputElement>('#new-rejection-reason')!.value).toBe('')
  })
})

describe('tâche close', () => {
  beforeEach(async () => {
    let task = buildDemoTask()
    task = completeTask(task, { summary: 'Terminé.', basedOnVersion: task.version }, 'agent')
    await store.openPreparedTask(task)
    await rendu()
  })

  it('propose la réouverture et retire les formulaires de saisie', () => {
    expect(root.querySelector('#reopen')).not.toBeNull()
    // Écrire dans un cahier clos n'a pas de sens : les formulaires disparaissent.
    expect(root.querySelector('#form-contrainte')).toBeNull()
    expect(root.querySelector('#form-rejet')).toBeNull()
  })

  it('dit à l’agent que la tâche est close, plutôt que de le laisser échouer', () => {
    const restitué = root.querySelector('pre')!.textContent!
    expect(restitué).toContain('TASK CLOSED')
    expect(restitué).not.toContain('WRITE PROTOCOL')
  })
})

describe('état de la couche WebMCP', () => {
  it('explique quoi activer quand l’API manque, sans paraître cassé', async () => {
    await store.init()
    await rendu()
    // jsdom n'expose pas document.modelContext : c'est le cas du visiteur
    // ordinaire, et le plus important à soigner.
    const texte = root.textContent!
    expect(texte).toContain('chrome://flags/#enable-webmcp-testing')
    expect(texte).toContain('document.modelContext')
  })
})

describe('démontage', () => {
  it('n’écrit plus rien après avoir été démonté', async () => {
    await store.openPreparedTask(buildDemoTask())
    await rendu()
    const avant = root.innerHTML

    démonter()
    // Une frame planifiée juste avant le démontage s'exécutait quand même et
    // écrivait dans une racine devenue nulle.
    await store.mutate((task) => ({ ...task, version: task.version + 1 }))
    await new Promise((r) => setTimeout(r, 20))

    expect(root.innerHTML).toBe(avant)
    // `afterEach` rappelle `démonter` : il doit être sans effet la seconde fois.
    démonter = () => {}
  })
})

describe('suppression d’un cahier', () => {
  beforeEach(async () => {
    await store.openPreparedTask(buildDemoTask())
    await rendu()
  })

  it('ne supprime rien si l’on renonce', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    root.querySelector<HTMLButtonElement>('#supprimer')!.click()
    await rendu()

    expect(store.currentTask()).not.toBeNull()
    // La question doit nommer ce qui disparaît, sinon elle ne vaut rien.
    expect(confirmer.mock.calls[0][0]).toContain('Refactor the authentication module')
    confirmer.mockRestore()
  })

  it('supprime et revient à l’état vide quand il ne reste rien', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    root.querySelector<HTMLButtonElement>('#supprimer')!.click()
    await rendu()

    expect(store.currentTask()).toBeNull()
    expect(root.textContent).toContain('Aucun cahier ouvert')
    confirmer.mockRestore()
  })

  it('rouvre le cahier suivant s’il en reste un', async () => {
    const autre = buildMeasureTask(3)
    await store.openPreparedTask(autre)
    await store.openPreparedTask(buildDemoTask())
    await rendu()

    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    root.querySelector<HTMLButtonElement>('#supprimer')!.click()
    await rendu()

    // Supprimer le cahier ouvert ne doit pas donner l'impression d'avoir tout
    // perdu quand il en reste.
    expect(store.currentTask()?.title).toBe(autre.title)
    confirmer.mockRestore()
  })
})

describe('supervision des propositions', () => {
  beforeEach(async () => {
    await store.openPreparedTask(buildDemoTask())
    await rendu()
  })

  it('montre la preuve sous le bouton qui la valide', () => {
    const ligne = root.querySelector('[data-verify]')!.closest('li')!
    const preuve = ligne.querySelector('pre')

    // Sans cela, « vérifié par un humain » ne veut rien dire de plus que
    // « quelqu'un a cliqué à côté d'un titre » : la file n'affichait que
    // l'action, et le clic attestait d'un texte que personne n'avait lu.
    expect(preuve).not.toBeNull()
    const étape = store
      .currentTask()!
      .steps.find(
        (st) => st.id === root.querySelector<HTMLButtonElement>('[data-verify]')!.dataset.verify,
      )!
    expect(preuve!.textContent).toBe(étape.evidence!.content)
  })

  it('valide en produisant le contenu affiché, pas l’identifiant seul', async () => {
    const bouton = root.querySelector<HTMLButtonElement>('[data-verify]')!
    const id = bouton.dataset.verify!
    bouton.click()
    await rendu()

    const étape = store.currentTask()!.steps.find((st) => st.id === id)!
    expect(étape.confidence).toBe('human_verified')
    expect(étape.evidence!.verifiedAt).not.toBeNull()
  })

  it('range les propositions d’agent à part, hors des approches condamnées', () => {
    const titres = [...root.querySelectorAll('h2')].map((h) => h.textContent ?? '')
    expect(titres.some((t) => t.includes('Proposé par un agent'))).toBe(true)

    const enAttente = proposedRejections(store.currentTask()!)[0]
    const condamnées = root.querySelectorAll('.regles')[1]
    expect(condamnées.textContent).not.toContain(enAttente.approach)
  })

  it('endosse une proposition d’un clic, et la rend alors opposable', async () => {
    const enAttente = proposedRejections(store.currentTask()!)[0]
    const bouton = root.querySelector<HTMLButtonElement>(`[data-accept="${enAttente.id}"]`)!
    bouton.click()
    await rendu()

    const après = store.currentTask()!
    expect(acceptedRejections(après).map((r) => r.id)).toContain(enAttente.id)
    expect(renderTaskState(après)).toContain('REJECTED — do not retry')
    expect(après.audit.at(-1)).toMatchObject({ operation: 'accept_rejection', actor: 'human' })
  })

  it('écarte une proposition sans l’effacer, et elle cesse d’être proposée', async () => {
    const enAttente = proposedRejections(store.currentTask()!)[0]
    root.querySelector<HTMLButtonElement>(`[data-decline="${enAttente.id}"]`)!.click()
    await rendu()

    const après = store.currentTask()!
    expect(proposedRejections(après)).toHaveLength(0)
    expect(acceptedRejections(après).map((r) => r.id)).not.toContain(enAttente.id)
    // Conservée : savoir qu'une proposition a été refusée vaut mieux que la
    // voir reproposée à l'identique.
    expect(après.rejected.map((r) => r.id)).toContain(enAttente.id)
  })

  it('montre les outils relus par getTools() et la politique de retrait retenue', async () => {
    const fake = installModelContext()
    __resetRegistration()
    await registerTools()
    await rendu()

    const panneau = root.querySelector('.status--ok')!
    expect(panneau.textContent).toContain('log_step')

    // `getTools()` relit la table du navigateur — utile, parce que c'est une
    // source distincte de la carte que la page tient. Mais la spécification
    // en fait l'API des agents DANS LA PAGE ; l'agent du navigateur passe par
    // un mécanisme interne. Présenter cette liste comme « ce que voit
    // l'agent » ferait passer une relecture locale pour une preuve de
    // découverte côté ChatGPT, qui n'a jamais été observée ici.
    expect(panneau.textContent).toContain('Outils enregistrés, relus par')
    expect(panneau.textContent).not.toContain('Découverts par')
    expect(panneau.textContent).not.toMatch(/ce que (voit|verra) l/i)

    // La politique de retrait est affichée, avec ce sur quoi elle se fonde :
    // elle repose sur un reniflage de version, et change ce que l'agent voit.
    expect(panneau.textContent).toContain('une fois posés, le restent')
    expect(panneau.textContent).toContain('Chromium version unknown')
    expect(fake.names()).toContain('log_step')

    __resetRegistration()
    removeModelContext()
  })
})

describe('l’adresse et la vue', () => {
  const chemin = () => location.pathname

  afterEach(() => history.replaceState(null, '', '/'))

  it('n’efface pas /t/:id au premier rendu, avant que le lien soit établi', async () => {
    history.replaceState(null, '', '/t/abc123')
    démonter()
    démonter = mount(root)

    // Le premier rendu est SYNCHRONE et précède la lecture du chemin par le
    // point d'entrée. L'écraser ici renvoyait la page sur « le dernier cahier
    // touché » — précisément ce que le lien par adresse existe pour supprimer.
    expect(chemin()).toBe('/t/abc123')
  })

  it('aligne l’adresse sur le cahier ouvert', async () => {
    const task = await store.openPreparedTask(buildDemoTask())
    await rendu()
    expect(chemin()).toBe(`/t/${task.id}`)
  })

  it('revient à la racine quand plus aucun cahier n’est ouvert', async () => {
    await store.openPreparedTask(buildDemoTask())
    await rendu()
    await store.deleteCurrentTask()
    await rendu()
    expect(chemin()).toBe('/')
  })

  it('garde l’adresse d’un cahier disparu, et le dit au lieu d’en ouvrir un autre', async () => {
    await store.openPreparedTask(buildDemoTask())
    store.__resetStore()
    démonter()
    await store.init('jamais-existe')
    history.replaceState(null, '', '/t/jamais-existe')
    démonter = mount(root)
    await rendu()

    expect(chemin()).toBe('/t/jamais-existe')
    expect(root.textContent).toContain("Ce cahier n'existe pas sur cet appareil")
    // Le cahier de démonstration EXISTE encore : ne pas l'ouvrir est le fond
    // du sujet.
    expect(root.textContent).not.toContain('Refactor the authentication module')
  })
})
