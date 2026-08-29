import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { FRAGMENT_KEY, packSealedTask, packTask } from '../src/export/link'
import * as store from '../src/store/taskStore'
import { __renderNow, mount } from '../src/ui/bench'
import { clearDatabase, waitUntil } from './helpers'

let root: HTMLElement
let unmount: () => void
let copied: string | null

async function settled(turns = 8) {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0))
  __renderNow()
}

async function open() {
  document.body.innerHTML = '<div id="annonces"></div><div id="app"></div>'
  root = document.querySelector<HTMLElement>('#app')!
  unmount = mount(root)
  await settled()
}

beforeEach(async () => {
  copied = null
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (t: string) => {
        copied = t
        return Promise.resolve()
      },
    },
  })
  localStorage.clear()
  store.__resetStore()
  await clearDatabase()
  await store.init()
  await open()
  await store.openPreparedTask(buildDemoTask())
  await settled()
})

afterEach(() => {
  unmount()
  localStorage.clear()
  history.replaceState(null, '', '/')
})

describe('offrir le cahier dans un lien', () => {
  it('copie une adresse qui porte tout le cahier', async () => {
    root.querySelector<HTMLButtonElement>('#copy-link')!.click()
    await waitUntil(() => copied !== null, 'la copie')
    await settled()

    expect(copied).toContain(`#${FRAGMENT_KEY}`)
    expect(copied!.length).toBeGreaterThan(200)
    // Le fragment ne quitte jamais le navigateur : il n'est pas envoyé au serveur.
    expect(copied!.split('#')[0]).toContain('/t/')
  })

  /**
   * Le lien emporte les preuves telles qu'elles ont été collées, et une sortie
   * de commande peut porter un jeton ou le nom d'une machine interne. Le
   * produit se donne pour règle de dire ce qu'il fait ; il ne le disait pas
   * ici, et pas au bon moment : une fois l'adresse dans le presse-papier, la
   * décision est déjà prise.
   */
  it('prévient de ce qui voyage AVANT le clic, pas après', async () => {
    const zone = root.querySelector('.handoff')!.textContent!.replace(/\s+/g, ' ')

    expect(zone).toContain('pieces of evidence travel with it')
    expect(zone).toContain('token or an internal hostname')
    // Et il rassure sur ce qui ne peut PAS voyager, parce que c'est structurel.
    expect(zone).toContain('Sealed credentials never travel')
  })

  it('se tait quand aucune preuve n’est attachée', async () => {
    // Un avertissement affiché sans raison s'apprend à ne plus être lu.
    const nue = { ...buildDemoTask(), id: 'sans-preuve', steps: [] }
    await store.openPreparedTask(nue)
    await settled()

    const zone = root.querySelector('.handoff')!.textContent!.replace(/\s+/g, ' ')
    expect(zone).not.toContain('evidence travel')
    expect(zone).not.toContain('internal hostname')
    // Le bouton, lui, reste offert.
    expect(root.querySelector('#copy-link')).not.toBeNull()
  })

  it('compte au singulier quand il n’y a qu’une preuve', async () => {
    const demo = buildDemoTask()
    const une = {
      ...demo,
      id: 'une-preuve',
      steps: demo.steps.filter((s) => s.evidence !== null).slice(0, 1),
    }
    await store.openPreparedTask(une)
    await settled()

    const zone = root.querySelector('.handoff')!.textContent!.replace(/\s+/g, ' ')
    expect(zone).toContain('One piece of evidence travels with it')
  })

  it('dit ce qu’il vient de copier, et que c’est une copie', async () => {
    root.querySelector<HTMLButtonElement>('#copy-link')!.click()
    await waitUntil(() => !!root.querySelector('.notice--ok'), 'le message')
    __renderNow()

    const message = root.querySelector('.notice--ok')!.textContent!
    expect(message.toLowerCase()).toContain('copy')
    // Et il nomme ce qui est parti avec, pas seulement « le cahier ».
    expect(message).toContain('evidence included')
  })
})

describe('recevoir un cahier par un lien', () => {
  async function arriveWith(packed: string) {
    unmount()
    store.__resetStore()
    await clearDatabase()
    // Comme main.ts : l'adresse est lue AVANT l'ouverture du magasin, donc le
    // cahier est bien lié à un identifiant absent de cet appareil.
    history.replaceState(null, '', `/t/notonthisdevice#${FRAGMENT_KEY}${packed}`)
    await store.init('notonthisdevice')
    await open()
  }

  const offer = () =>
    [...root.querySelectorAll('.card')].find((c) =>
      c.querySelector('h2')?.textContent?.includes('A shared log'),
    )

  it('propose, et n’importe rien tout seul', async () => {
    const packed = await packTask(buildDemoTask())
    await arriveWith(packed)

    expect(offer()).toBeDefined()
    expect(offer()!.textContent).toContain('Refactor the authentication module')
    // Rien n'a été écrit : ouvrir un lien n'est pas consentir à l'écrire.
    expect(await store.allTasks()).toHaveLength(0)
  })

  it('ne contredit pas l’offre par un bandeau « cette tâche n’existe pas »', async () => {
    await arriveWith(await packTask(buildDemoTask()))

    // L'adresse pointe bien vers une tâche absente — mais le lien porte
    // justement de quoi la créer. Dire les deux à la fois affole pour rien.
    expect(root.textContent).not.toContain('does not exist on this device')
    expect(offer()).toBeDefined()
  })

  it('dit à nouveau la tâche absente si l’on refuse le lien', async () => {
    await arriveWith(await packTask(buildDemoTask()))
    root.querySelector<HTMLButtonElement>('#decline-link')!.click()
    await settled()

    expect(root.textContent).toContain('does not exist on this device')
  })

  it('annonce que ce sera une copie, sans lien avec l’original', async () => {
    await arriveWith(await packTask(buildDemoTask()))
    expect(offer()!.textContent!.toLowerCase()).toContain('copy')
  })

  it('importe sur demande, et ouvre le cahier reçu', async () => {
    const source = buildDemoTask()
    await arriveWith(await packTask(source))

    root.querySelector<HTMLButtonElement>('#accept-link')!.click()
    await waitUntil(() => store.currentTask() !== null, 'le cahier importé', 3000)
    await settled()

    expect(store.currentTask()!.title).toBe(source.title)
    expect(store.currentTask()!.steps.length).toBe(source.steps.length)
    expect(offer()).toBeUndefined()
    // L'adresse ne garde pas la charge : recharger ne reproposerait pas.
    expect(location.hash).toBe('')
  })

  it('se refuse d’un clic, et laisse la page vide comme avant', async () => {
    await arriveWith(await packTask(buildDemoTask()))

    root.querySelector<HTMLButtonElement>('#decline-link')!.click()
    await settled()

    expect(offer()).toBeUndefined()
    expect(await store.allTasks()).toHaveLength(0)
    expect(location.hash).toBe('')
  })

  it('dit qu’un lien est illisible plutôt que de laisser croire à une page cassée', async () => {
    await arriveWith('zdefinitivementpasuncahier')
    await waitUntil(() => !!root.querySelector('.notice--error'), 'le message d’erreur', 3000)
    __renderNow()

    expect(root.querySelector('.notice--error')!.textContent).toMatch(/link/i)
    expect(offer()).toBeUndefined()
  })
})

describe('le lien protégé, depuis l’écran', () => {
  async function arriveWith(packed: string) {
    unmount()
    store.__resetStore()
    await clearDatabase()
    history.replaceState(null, '', `/t/notonthisdevice#${FRAGMENT_KEY}${packed}`)
    await store.init('notonthisdevice')
    await open()
  }

  function type(id: string, value: string) {
    const champ = root.querySelector<HTMLInputElement>(`#${id}`)!
    champ.value = value
    champ.dispatchEvent(new Event('input', { bubbles: true }))
  }

  it('copie un lien scellé, et le dit sans promettre plus que ça', async () => {
    const bouton = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Copy a protected link',
    )!
    expect(bouton).toBeTruthy()

    const vrai = window.prompt
    window.prompt = () => 'la phrase du téléphone'
    bouton.click()
    await waitUntil(() => copied !== null, 'la copie')
    window.prompt = vrai
    await settled()

    expect(copied).toContain(`#${FRAGMENT_KEY}s`)
    // Rien du cahier ne transparaît dans l'adresse.
    expect(copied).not.toContain(store.currentTask()!.title.replace(/ /g, ''))
    expect(root.querySelector('.notice--ok')?.textContent).toContain('unreadable')
  })

  it('n’annonce pas ce qu’il ne fait pas', async () => {
    // La phrase ne vérifie pas une identité — elle vérifie la connaissance
    // d'un secret. L'écran doit le dire, et dire pourquoi.
    const zone = root.querySelector('.handoff')!.textContent!.replace(/\s+/g, ' ')
    expect(zone).toContain('Nobody can tell who opens a link')
    expect(zone).toContain('would need a server')
  })

  it('ne dit rien du cahier tant que la phrase n’est pas donnée', async () => {
    const packed = await packSealedTask(store.currentTask()!, 'la phrase du téléphone')
    const titre = store.currentTask()!.title
    await arriveWith(packed)

    const texte = root.textContent!.replace(/\s+/g, ' ')
    expect(texte).toContain('A protected log')
    expect(texte).not.toContain(titre)
    expect(root.querySelector('#sealed-passphrase')).not.toBeNull()
  })

  it('ouvre avec la bonne phrase, et propose la copie comme d’habitude', async () => {
    const packed = await packSealedTask(store.currentTask()!, 'la phrase du téléphone')
    const titre = store.currentTask()!.title
    await arriveWith(packed)

    type('sealed-passphrase', 'la phrase du téléphone')
    root.querySelector<HTMLFormElement>('#form-sealed')!.requestSubmit()
    await waitUntil(() => root.textContent!.includes('A shared log'), 'l’offre')
    __renderNow()

    expect(root.textContent).toContain(titre)
    expect(root.querySelector('#accept-link')).not.toBeNull()
  })

  it('refuse une phrase fausse en disant que le lien, lui, est bon', async () => {
    const packed = await packSealedTask(store.currentTask()!, 'la phrase du téléphone')
    await arriveWith(packed)

    type('sealed-passphrase', 'ce n’est pas la bonne')
    root.querySelector<HTMLFormElement>('#form-sealed')!.requestSubmit()
    await waitUntil(() => !!root.querySelector('.notice--error'), 'le refus')
    __renderNow()

    const message = root.querySelector('.notice--error')!.textContent!
    expect(message).toContain('does not open this link')
    expect(message).toContain('the link itself is fine')
    // Et il reste ouvert : on peut retaper.
    expect(root.querySelector('#sealed-passphrase')).not.toBeNull()
  })
})
