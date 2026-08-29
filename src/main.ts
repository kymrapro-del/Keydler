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
    // `updateViaCache: 'none'` fait ignorer le cache HTTP à la vérification de
    // mise à jour, sans dépendre d'un en-tête qu'on ne contrôle pas. Mesuré en
    // production : `public/_headers` demande `no-cache` sur `/sw.js` et Cloudflare
    // sert `max-age=14400` (quatre heures), le worker étant seul mis en cache de
    // bord (`cf-cache-status: REVALIDATED` contre `DYNAMIC`). Un visiteur qui
    // revenait gardait l'ancien worker, et avec lui l'ancienne application.
    void navigator.serviceWorker
      .register('/sw.js', { updateViaCache: 'none' })
      .catch(() => undefined)
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
