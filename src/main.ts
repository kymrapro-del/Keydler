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
    // `updateViaCache: 'none'` force le navigateur à IGNORER son cache HTTP
    // pour ce script lors de la vérification de mise à jour.
    //
    // Sans cela, la fraîcheur du service worker dépend d'un en-tête qu'on ne
    // contrôle pas. Mesuré en production : `public/_headers` demande
    // `no-cache` sur `/sw.js`, et Cloudflare sert `max-age=14400` — quatre
    // heures. La même règle s'applique pourtant bien à `index.html` et au
    // manifeste ; le service worker, lui, est mis en cache de bord par son
    // extension (`cf-cache-status: REVALIDATED` contre `DYNAMIC` pour les
    // autres). Un visiteur qui revient pouvait donc garder l'ancien worker,
    // et avec lui l'ancienne application servie depuis son cache.
    //
    // Cette option-ci est dans notre code : elle tient quel que soit
    // l'hébergeur, et ne demande aucun droit sur la zone.
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
