import './webmcp'

import './tokens.css'
import './style.css'
import { buildMeasureTask } from './demo/measures'
import * as store from './store/taskStore'
import { mount } from './ui/bench'
import { currentTaskIdFromLocation } from './webmcp/location'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('#app introuvable')

const lié = currentTaskIdFromLocation()

mount(root)

void (async () => {
  await store.init(lié ?? undefined)

  const n = Number(new URLSearchParams(location.search).get('mesure'))
  if (!n) return

  const voulue = buildMeasureTask(n)
  if (store.currentTask()?.title === voulue.title) return
  await store.openPreparedTask(voulue)
})()
