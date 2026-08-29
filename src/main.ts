import './webmcp'

import './tokens.css'
import './style.css'
import { redirectToCanonical } from './canonical'
import { buildMeasureTask } from './demo/measures'
import * as store from './store/taskStore'
import { mount } from './ui/bench'
import { currentTaskIdFromLocation } from './webmcp/location'

// Avant tout le reste : sur la mauvaise origine, rien de ce qui suit ne doit
// s'exécuter. Monter la page y créerait une base de données parallèle que
// personne ne retrouvera jamais.
if (redirectToCanonical()) {
  throw new Error('redirection vers l’origine canonique')
}

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('#app introuvable')

const lié = currentTaskIdFromLocation()

mount(root)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}

void (async () => {
  await store.init(lié ?? undefined)

  const n = Number(new URLSearchParams(location.search).get('mesure'))
  if (!n) return

  const voulue = buildMeasureTask(n)
  if (store.currentTask()?.title === voulue.title) return
  await store.openPreparedTask(voulue)
})()
