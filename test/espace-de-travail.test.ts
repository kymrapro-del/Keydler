import { beforeEach, describe, expect, it } from 'vitest'
import { isWorkspacePath, WORKSPACE_PATH } from '../src/webmcp/location'
import { __renderNow, mount } from '../src/ui/bench'
import * as store from '../src/store/taskStore'
import { clearDatabase } from './helpers'

// `/workspace` est ce qu'un bouton « Sign in » doit atteindre sur un produit sans compte ni
// serveur. La liste des cahiers, l'export et l'import existaient déjà, mais repliés à l'intérieur
// d'un cahier ouvert : qui arrive d'une page d'accueil n'en a aucun, et ne voyait donc rien.
describe('l’adresse de l’espace de travail', () => {
  it('reconnaît la sienne, avec ou sans barre finale', () => {
    expect(isWorkspacePath(WORKSPACE_PATH)).toBe(true)
    expect(isWorkspacePath(`${WORKSPACE_PATH}/`)).toBe(true)
  })

  it('ne reconnaît rien d’autre', () => {
    // `/workspaces` ou `/workspace-2` ne doivent pas ouvrir cette vue : ce
    // sont des adresses différentes, et les confondre volerait leur page à
    // d'éventuelles routes futures.
    for (const autre of ['/', '/t/abc', '/workspaces', '/workspace-2', '/Workspace', '']) {
      expect(isWorkspacePath(autre), autre).toBe(false)
    }
  })
})

describe('la porte d’entrée depuis l’accueil', () => {
  it('est un lien, pas un bouton', async () => {
    // Un contrôle qui change l'adresse doit être un <a href> : clic-milieu,
    // Ctrl+clic et lecteurs d'écran en dépendent. C'est aussi le seul chemin
    // d'exploration qu'un moteur trouve sur ce site, qui n'a aucune autre ancre.
    localStorage.clear()
    store.__resetStore()
    await clearDatabase()
    document.body.innerHTML = '<div id="app"></div>'
    const racine = document.querySelector<HTMLElement>('#app')!
    history.replaceState(null, '', '/')

    const démonter = mount(racine)
    await store.init()
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()

    const porte = racine.querySelector('#go-workspace')
    expect(porte?.tagName).toBe('A')
    expect(porte?.getAttribute('href')).toBe(WORKSPACE_PATH)
    démonter()
  })
})

describe('la page de l’espace de travail', () => {
  let root: HTMLElement
  let démonter: () => void

  async function attendre(tours = 8) {
    for (let i = 0; i < tours; i++) await new Promise((r) => setTimeout(r, 0))
    __renderNow()
  }

  beforeEach(async () => {
    localStorage.clear()
    store.__resetStore()
    await clearDatabase()
    document.body.innerHTML = '<div id="app"></div>'
    root = document.querySelector<HTMLElement>('#app')!
    history.replaceState(null, '', WORKSPACE_PATH)
  })

  it('s’ouvre quand l’adresse la désigne, sans cahier ouvert', async () => {
    démonter = mount(root)
    await store.init()
    await attendre()

    expect(root.textContent).toContain('Your workspace lives in this browser')
    démonter()
  })

  it('garde son adresse au lieu de se faire renvoyer à la racine', async () => {
    // `reflectAddress` réécrit l'adresse à chaque rendu vers `/t/:id` ou `/`.
    // Sans exception pour cette vue, l'adresse partait à `/` dès le premier
    // rendu et un rechargement ne ramenait plus la page.
    démonter = mount(root)
    await store.init()
    await attendre()

    expect(location.pathname).toBe(WORKSPACE_PATH)
    démonter()
  })

  it('dit qu’il n’y a rien quand l’appareil est vide', async () => {
    démonter = mount(root)
    await store.init()
    await attendre()

    expect(root.textContent).toContain('Nothing is stored here yet')
    démonter()
  })

  it('liste TOUS les cahiers du poste, pas seulement celui qui est ouvert', async () => {
    // `store.init()` sans identifiant rouvre le dernier cahier et `deleteCurrentTask` en rouvre
    // un autre : aucun état n'a des cahiers sans qu'un soit ouvert. Une première version de cette
    // épreuve prétendait le contraire, et une mutation l'a démentie.
    await store.init()
    await store.createAndOpenTask('Refactor the auth module', 'Map the entry points')
    await store.createAndOpenTask('Ship the landing page', 'Replace the sign-in button')
    store.__resetStore()

    history.replaceState(null, '', WORKSPACE_PATH)
    démonter = mount(root)
    await store.init()
    await attendre()
    await attendre()

    expect(root.textContent).toContain('2 logs on this device')
    expect(root.textContent).toContain('Refactor the auth module')
    expect(root.textContent).toContain('Ship the landing page')
    expect(root.textContent).not.toContain('Nothing is stored here yet')
    démonter()
  })

  it('offre l’export et l’import, qui vivaient derrière un cahier ouvert', async () => {
    démonter = mount(root)
    await store.init()
    await attendre()

    expect(root.querySelector('#export-all')).not.toBeNull()
    expect(root.querySelector('#import')).not.toBeNull()
    démonter()
  })

  it('ne promet aucun compte', async () => {
    // Le produit refuse d'écrire « vérifié » à la place d'un humain ; sa
    // propre page ne doit pas suggérer un dos qu'il n'a pas.
    démonter = mount(root)
    await store.init()
    await attendre()

    const texte = root.textContent ?? ''
    expect(texte).toContain('no account and no server')
    for (const mot of ['Sign in', 'Log in', 'Create an account', 'password', 'Sync']) {
      expect(texte, mot).not.toContain(mot)
    }
    démonter()
  })

  it('ne prétend pas que les cahiers sont chiffrés, parce qu’ils ne le sont pas', async () => {
    // Seuls le coffre d'identifiants et les liens scellés sont chiffrés. Les
    // cahiers eux-mêmes sont en clair dans IndexedDB, et quiconque a la main
    // sur la session du navigateur peut les lire. Écrire « encrypted » ici
    // serait la seule vraie fausseté que cette page pourrait porter.
    démonter = mount(root)
    await store.init()
    await attendre()

    const texte = (root.textContent ?? '').toLowerCase()
    for (const mot of ['encrypted', 'encryption', 'end-to-end']) {
      expect(texte, mot).not.toContain(mot)
    }
    démonter()
  })

  it('ne promet la confidentialité que par ce qui est vérifiable', async () => {
    // Une première rédaction disait « nobody else can read it, not even us ».
    // C'est une promesse sur la confiance : nous servons le code, donc nous
    // pourrions le changer. Ce qui est démontrable, c'est qu'il n'y a aucune
    // destination et que la politique de sécurité bloque les autres origines.
    démonter = mount(root)
    await store.init()
    await attendre()

    const texte = root.textContent ?? ''
    expect(texte).toContain('never sent anywhere')
    expect(texte).not.toContain('not even us')
    démonter()
  })

  it('avertit que vider le navigateur efface tout', async () => {
    // Sans serveur, il n'y a pas de sauvegarde ailleurs. Le taire serait la
    // seule promesse fausse que cette page pourrait faire.
    démonter = mount(root)
    await store.init()
    await attendre()

    expect(root.textContent).toContain('deletes every log here')
    démonter()
  })

  it('sort de la vue quand on ouvre un cahier depuis la liste', async () => {
    await store.init()
    const tâche = await store.createAndOpenTask('Refactor the auth module', 'Map the entry points')
    store.__resetStore()

    history.replaceState(null, '', WORKSPACE_PATH)
    démonter = mount(root)
    await store.init()
    await attendre()
    await attendre()

    root.querySelector<HTMLButtonElement>(`[data-open="${tâche.id}"]`)!.click()
    await attendre()
    await attendre()

    expect(root.textContent).not.toContain('Your workspace lives in this browser')
    expect(location.pathname).toBe(`/t/${tâche.id}`)
    démonter()
  })
})
