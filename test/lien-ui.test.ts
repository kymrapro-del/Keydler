import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoTask } from '../src/demo/seed'
import { FRAGMENT_KEY, packTask } from '../src/export/link'
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

  it('dit ce qu’il vient de copier, et que c’est une copie', async () => {
    root.querySelector<HTMLButtonElement>('#copy-link')!.click()
    await waitUntil(() => !!root.querySelector('.notice--ok'), 'le message')
    __renderNow()

    const message = root.querySelector('.notice--ok')!.textContent!
    expect(message.toLowerCase()).toContain('copy')
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
      c.querySelector('h2')?.textContent?.includes('A shared watch log'),
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
